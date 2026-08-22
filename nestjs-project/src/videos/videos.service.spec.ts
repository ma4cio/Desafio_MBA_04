import { Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import {
  MAX_VIDEO_SIZE_BYTES,
  VIDEO_PART_SIZE_BYTES,
} from './dto/create-video-upload.dto';
import { Video, VideoStatus } from './entities/video.entity';
import { InvalidMultipartUploadException } from './video.exceptions';
import { VideoQueueService } from './video-queue.service';
import { VideoStorageService } from './video-storage.service';
import { VideosService } from './videos.service';

interface RepositoryMock {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  remove: jest.Mock;
}

describe('VideosService', () => {
  const channel = { id: 'channel-id', user_id: 'user-id' } as Channel;
  let video: Video;
  let videos: RepositoryMock;
  let channels: RepositoryMock;
  let storage: jest.Mocked<
    Pick<
      VideoStorageService,
      | 'createMultipartUpload'
      | 'abortMultipartUpload'
      | 'signUploadPart'
      | 'completeMultipartUpload'
      | 'headVideo'
      | 'deleteVideo'
    >
  >;
  let queue: jest.Mocked<Pick<VideoQueueService, 'enqueue'>>;
  let service: VideosService;

  beforeEach(() => {
    video = {
      id: '4d65ef5e-6b92-45cf-a1af-cb891fb9ccf6',
      channel_id: channel.id,
      title: 'Video',
      original_filename: 'video.mp4',
      mime_type: 'video/mp4',
      size_bytes: String(VIDEO_PART_SIZE_BYTES + 1),
      status: VideoStatus.DRAFT,
      public_id: 'public-id',
      source_object_key: 'source-key',
      thumbnail_object_key: null,
      multipart_upload_id: 'upload-id',
      duration_seconds: null,
      metadata: null,
      processing_error: null,
      created_at: new Date(),
      updated_at: new Date(),
      channel,
    };
    videos = {
      findOne: jest.fn().mockResolvedValue(video),
      create: jest.fn((value) => value as Video),
      save: jest.fn((value) => Promise.resolve(value as Video)),
      remove: jest.fn((value) => Promise.resolve(value)),
    };
    channels = {
      findOne: jest.fn().mockResolvedValue(channel),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
    };
    storage = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-id'),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      signUploadPart: jest.fn().mockResolvedValue('http://signed-url'),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      headVideo: jest.fn().mockResolvedValue({
        size: Number(video.size_bytes),
        contentType: video.mime_type,
      }),
      deleteVideo: jest.fn().mockResolvedValue(undefined),
    };
    queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    service = new VideosService(
      videos as unknown as Repository<Video>,
      channels as unknown as Repository<Channel>,
      storage as unknown as VideoStorageService,
      queue as unknown as VideoQueueService,
    );
  });

  it('pre-registers a 10 GiB upload as draft without receiving file bytes', async () => {
    const result = await service.createUpload('user-id', {
      title: 'Large video',
      filename: 'large.mp4',
      contentType: 'video/mp4',
      sizeBytes: MAX_VIDEO_SIZE_BYTES,
    });

    expect(result.status).toBe(VideoStatus.DRAFT);
    expect(result.partSizeBytes).toBe(VIDEO_PART_SIZE_BYTES);
    expect(result.totalParts).toBe(160);
    expect(storage.createMultipartUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^channels\/channel-id\/videos\/.+\/source\.mp4$/),
      'video/mp4',
    );
    expect(videos.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: VideoStatus.DRAFT,
        size_bytes: String(MAX_VIDEO_SIZE_BYTES),
      }),
    );
  });

  it('requires all multipart parts in consecutive order before completion', async () => {
    await expect(
      service.completeUpload('user-id', video.id, {
        parts: [{ partNumber: 1, eTag: 'etag-1' }],
      }),
    ).rejects.toBeInstanceOf(InvalidMultipartUploadException);
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
  });

  it('validates storage, changes status and enqueues processing', async () => {
    const result = await service.completeUpload('user-id', video.id, {
      parts: [
        { partNumber: 2, eTag: 'etag-2' },
        { partNumber: 1, eTag: 'etag-1' },
      ],
    });

    expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
      video.source_object_key,
      'upload-id',
      [
        { partNumber: 1, eTag: 'etag-1' },
        { partNumber: 2, eTag: 'etag-2' },
      ],
    );
    expect(queue.enqueue).toHaveBeenCalledWith(video.id);
    expect(result.status).toBe(VideoStatus.PROCESSING);
  });
});
