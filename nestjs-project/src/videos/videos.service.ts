import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { CompleteVideoUploadDto } from './dto/complete-video-upload.dto';
import {
  CreateVideoUploadDto,
  VIDEO_PART_SIZE_BYTES,
} from './dto/create-video-upload.dto';
import { SignUploadPartsDto } from './dto/sign-upload-parts.dto';
import { Video, VideoStatus } from './entities/video.entity';
import {
  InvalidMultipartUploadException,
  InvalidVideoStateException,
  UploadedObjectMismatchException,
  VideoNotFoundException,
  VideoNotReadyException,
} from './video.exceptions';
import { VideoQueueService } from './video-queue.service';
import {
  StoredObjectStream,
  VideoStorageService,
} from './video-storage.service';

export interface CreateUploadResult {
  id: string;
  publicId: string;
  status: VideoStatus;
  partSizeBytes: number;
  totalParts: number;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channels: Repository<Channel>,
    private readonly storage: VideoStorageService,
    private readonly queue: VideoQueueService,
  ) {}

  async createUpload(
    userId: string,
    dto: CreateVideoUploadDto,
  ): Promise<CreateUploadResult> {
    const channel = await this.channels.findOne({ where: { user_id: userId } });
    if (!channel) throw new VideoNotFoundException();

    const id = randomUUID();
    const publicId = randomUUID().replaceAll('-', '');
    const extension = this.safeExtension(dto.filename);
    const objectKey = `channels/${channel.id}/videos/${id}/source${extension}`;
    const uploadId = await this.storage.createMultipartUpload(
      objectKey,
      dto.contentType,
    );

    try {
      const video = this.videos.create({
        id,
        channel_id: channel.id,
        title: dto.title.trim(),
        original_filename: dto.filename,
        mime_type: dto.contentType,
        size_bytes: String(dto.sizeBytes),
        status: VideoStatus.DRAFT,
        public_id: publicId,
        source_object_key: objectKey,
        thumbnail_object_key: null,
        multipart_upload_id: uploadId,
        duration_seconds: null,
        metadata: null,
        processing_error: null,
      });
      await this.videos.save(video);
      return {
        id,
        publicId,
        status: VideoStatus.DRAFT,
        partSizeBytes: VIDEO_PART_SIZE_BYTES,
        totalParts: Math.ceil(dto.sizeBytes / VIDEO_PART_SIZE_BYTES),
      };
    } catch (error) {
      await this.storage.abortMultipartUpload(objectKey, uploadId);
      throw error;
    }
  }

  async signParts(
    userId: string,
    videoId: string,
    dto: SignUploadPartsDto,
  ): Promise<Array<{ partNumber: number; url: string }>> {
    const video = await this.findOwnedById(userId, videoId);
    this.assertDraftUpload(video);
    const expectedParts = Math.ceil(
      Number(video.size_bytes) / VIDEO_PART_SIZE_BYTES,
    );
    const uniqueParts = [...new Set(dto.partNumbers)].sort((a, b) => a - b);
    if (uniqueParts.some((part) => part > expectedParts)) {
      throw new InvalidMultipartUploadException(
        'Part number exceeds the declared video size',
      );
    }
    return Promise.all(
      uniqueParts.map(async (partNumber) => ({
        partNumber,
        url: await this.storage.signUploadPart(
          video.source_object_key,
          video.multipart_upload_id!,
          partNumber,
        ),
      })),
    );
  }

  async completeUpload(
    userId: string,
    videoId: string,
    dto: CompleteVideoUploadDto,
  ): Promise<{ id: string; publicId: string; status: VideoStatus }> {
    const video = await this.findOwnedById(userId, videoId);
    this.assertDraftUpload(video);
    const expectedParts = Math.ceil(
      Number(video.size_bytes) / VIDEO_PART_SIZE_BYTES,
    );
    const sorted = [...dto.parts].sort((a, b) => a.partNumber - b.partNumber);
    if (
      sorted.length !== expectedParts ||
      sorted.some((part, index) => part.partNumber !== index + 1)
    ) {
      throw new InvalidMultipartUploadException(
        `Expected ${expectedParts} consecutive uploaded parts`,
      );
    }

    await this.storage.completeMultipartUpload(
      video.source_object_key,
      video.multipart_upload_id!,
      sorted,
    );
    const head = await this.storage.headVideo(video.source_object_key);
    if (
      head.size !== Number(video.size_bytes) ||
      (head.contentType && head.contentType !== video.mime_type)
    ) {
      await this.storage.deleteVideo(video.source_object_key);
      video.status = VideoStatus.ERROR;
      video.processing_error = 'Uploaded object validation failed';
      video.multipart_upload_id = null;
      await this.videos.save(video);
      throw new UploadedObjectMismatchException();
    }

    video.status = VideoStatus.PROCESSING;
    video.multipart_upload_id = null;
    video.processing_error = null;
    await this.videos.save(video);
    try {
      await this.queue.enqueue(video.id);
    } catch (error) {
      video.status = VideoStatus.ERROR;
      video.processing_error = 'Failed to enqueue video processing';
      await this.videos.save(video);
      throw error;
    }
    return { id: video.id, publicId: video.public_id, status: video.status };
  }

  async abortUpload(userId: string, videoId: string): Promise<void> {
    const video = await this.findOwnedById(userId, videoId);
    this.assertDraftUpload(video);
    await this.storage.abortMultipartUpload(
      video.source_object_key,
      video.multipart_upload_id!,
    );
    await this.videos.remove(video);
  }

  async getVideo(userId: string, publicId: string): Promise<Video> {
    return this.findOwnedByPublicId(userId, publicId);
  }

  async streamVideo(
    userId: string,
    publicId: string,
    range?: string,
  ): Promise<StoredObjectStream> {
    const video = await this.findOwnedByPublicId(userId, publicId);
    if (video.status !== VideoStatus.READY) throw new VideoNotReadyException();
    return this.storage.getVideo(video.source_object_key, range);
  }

  async downloadVideo(
    userId: string,
    publicId: string,
  ): Promise<{ stream: StoredObjectStream; filename: string }> {
    const video = await this.findOwnedByPublicId(userId, publicId);
    if (video.status !== VideoStatus.READY) throw new VideoNotReadyException();
    return {
      stream: await this.storage.getVideo(video.source_object_key),
      filename: video.original_filename.replace(/[\r\n"\\]/g, '_'),
    };
  }

  async getThumbnail(
    userId: string,
    publicId: string,
  ): Promise<StoredObjectStream> {
    const video = await this.findOwnedByPublicId(userId, publicId);
    if (video.status !== VideoStatus.READY || !video.thumbnail_object_key) {
      throw new VideoNotReadyException();
    }
    return this.storage.getThumbnail(video.thumbnail_object_key);
  }

  private async findOwnedById(userId: string, id: string): Promise<Video> {
    const video = await this.videos.findOne({
      where: { id, channel: { user_id: userId } },
      relations: { channel: true },
    });
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  private async findOwnedByPublicId(
    userId: string,
    publicId: string,
  ): Promise<Video> {
    const video = await this.videos.findOne({
      where: { public_id: publicId, channel: { user_id: userId } },
      relations: { channel: true },
    });
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  private assertDraftUpload(video: Video): void {
    if (video.status !== VideoStatus.DRAFT || !video.multipart_upload_id) {
      throw new InvalidVideoStateException('Video upload is no longer open');
    }
  }

  private safeExtension(filename: string): string {
    const match = /\.[a-zA-Z0-9]{1,10}$/.exec(filename);
    return match ? match[0].toLowerCase() : '';
  }
}
