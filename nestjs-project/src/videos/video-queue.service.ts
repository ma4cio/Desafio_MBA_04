import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';

export const PROCESS_VIDEO_JOB = 'process-video';

export interface ProcessVideoJobData {
  videoId: string;
}

@Injectable()
export class VideoQueueService implements OnModuleDestroy {
  private readonly queue: Queue<ProcessVideoJobData>;

  constructor(
    @Inject(queueConfig.KEY)
    private readonly config: ConfigType<typeof queueConfig>,
  ) {
    this.queue = new Queue(config.videoQueueName, {
      connection: {
        host: config.host,
        port: config.port,
        password: config.password,
        maxRetriesPerRequest: null,
      },
      defaultJobOptions: {
        attempts: config.attempts,
        backoff: { type: 'exponential', delay: config.backoffMs },
        removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
      },
    });
  }

  async enqueue(videoId: string): Promise<void> {
    await this.queue.add(
      PROCESS_VIDEO_JOB,
      { videoId },
      { jobId: `video-${videoId}` },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
