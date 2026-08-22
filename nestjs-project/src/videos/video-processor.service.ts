import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Worker } from 'bullmq';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import queueConfig from '../config/queue.config';
import { Video, VideoStatus } from './entities/video.entity';
import { PROCESS_VIDEO_JOB, ProcessVideoJobData } from './video-queue.service';
import { VideoStorageService } from './video-storage.service';

interface FfprobeOutput {
  format?: {
    duration?: string;
    format_name?: string;
    bit_rate?: string;
  };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
  }>;
}

@Injectable()
export class VideoProcessorService implements OnModuleDestroy {
  private readonly worker: Worker<ProcessVideoJobData>;

  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly storage: VideoStorageService,
    @Inject(queueConfig.KEY)
    config: ConfigType<typeof queueConfig>,
  ) {
    this.worker = new Worker<ProcessVideoJobData>(
      config.videoQueueName,
      (job) => this.process(job),
      {
        concurrency: config.concurrency,
        connection: {
          host: config.host,
          port: config.port,
          password: config.password,
          maxRetriesPerRequest: null,
        },
      },
    );
    this.worker.on('error', (error) => {
      console.error('Video worker connection error', error);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }

  private async process(job: Job<ProcessVideoJobData>): Promise<void> {
    if (job.name !== PROCESS_VIDEO_JOB) return;
    const video = await this.videos.findOne({
      where: { id: job.data.videoId },
    });
    if (!video) throw new Error(`Video ${job.data.videoId} does not exist`);
    if (video.status === VideoStatus.READY) return;

    video.status = VideoStatus.PROCESSING;
    video.processing_error = null;
    await this.videos.save(video);

    const workDir = await mkdtemp(join(tmpdir(), 'streamtube-video-'));
    const sourcePath = join(workDir, 'source');
    const thumbnailPath = join(workDir, 'thumbnail.jpg');
    try {
      await this.storage.downloadVideo(video.source_object_key, sourcePath);
      const probePath = join(workDir, 'metadata.json');
      await this.run('ffprobe', [
        '-v',
        'error',
        '-show_format',
        '-show_streams',
        '-of',
        'json',
        '-o',
        probePath,
        sourcePath,
      ]);
      const probe = JSON.parse(
        await readFile(probePath, 'utf8'),
      ) as FfprobeOutput;
      const duration = Number(probe.format?.duration ?? 0);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('FFprobe did not return a valid duration');
      }

      const frameAt = Math.min(Math.max(duration * 0.1, 0.1), 10);
      await this.run('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        frameAt.toFixed(3),
        '-i',
        sourcePath,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-2',
        '-q:v',
        '3',
        '-y',
        thumbnailPath,
      ]);

      const thumbnailKey = `channels/${video.channel_id}/videos/${video.id}/thumbnail.jpg`;
      await this.storage.uploadThumbnail(thumbnailKey, thumbnailPath);
      const videoStream = probe.streams?.find(
        (stream) => stream.codec_type === 'video',
      );
      const audioStream = probe.streams?.find(
        (stream) => stream.codec_type === 'audio',
      );
      video.duration_seconds = Math.max(1, Math.round(duration));
      video.thumbnail_object_key = thumbnailKey;
      video.metadata = {
        format: probe.format?.format_name ?? null,
        bitRate: this.numericOrNull(probe.format?.bit_rate),
        videoCodec: videoStream?.codec_name ?? null,
        audioCodec: audioStream?.codec_name ?? null,
        width: videoStream?.width ?? null,
        height: videoStream?.height ?? null,
        frameRate: videoStream?.avg_frame_rate ?? null,
      };
      video.processing_error = null;
      video.status = VideoStatus.READY;
      await this.videos.save(video);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts =
        typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
      video.processing_error = message.slice(0, 4000);
      video.status =
        job.attemptsMade + 1 >= attempts
          ? VideoStatus.ERROR
          : VideoStatus.PROCESSING;
      await this.videos.save(video);
      throw error;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private numericOrNull(value?: string): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private run(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 8000) stderr += chunk;
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve();
        else
          reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
      });
    });
  }
}
