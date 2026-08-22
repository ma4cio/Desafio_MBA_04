import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { createTestDataSource } from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let repository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource([User, Channel, Video]);
    await dataSource.initialize();
    repository = dataSource.getRepository(Video);
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await dataSource.query('DELETE FROM "channels"');
    await dataSource.query('DELETE FROM "users"');
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('persists ownership, draft state and a unique public URL id', async () => {
    const user = await dataSource.getRepository(User).save({
      email: 'video-entity@example.com',
      password: 'hash',
      is_confirmed: true,
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: 'Channel',
      nickname: 'video_entity',
      user_id: user.id,
    });
    const saved = await repository.save({
      channel_id: channel.id,
      title: 'Integration video',
      original_filename: 'video.mp4',
      mime_type: 'video/mp4',
      size_bytes: '10737418240',
      status: VideoStatus.DRAFT,
      public_id: 'unique-public-id',
      source_object_key: 'channels/channel/video/source.mp4',
      thumbnail_object_key: null,
      multipart_upload_id: 'upload-id',
      duration_seconds: null,
      metadata: null,
      processing_error: null,
    });

    const loaded = await repository.findOneOrFail({
      where: { id: saved.id },
      relations: { channel: true },
    });
    expect(loaded.status).toBe(VideoStatus.DRAFT);
    expect(loaded.size_bytes).toBe('10737418240');
    expect(loaded.channel.user_id).toBe(user.id);
  });

  it('rejects duplicate public URL ids', async () => {
    const user = await dataSource.getRepository(User).save({
      email: 'duplicate@example.com',
      password: 'hash',
      is_confirmed: true,
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: 'Duplicate',
      nickname: 'duplicate',
      user_id: user.id,
    });
    const base = {
      channel_id: channel.id,
      title: 'Video',
      original_filename: 'video.mp4',
      mime_type: 'video/mp4',
      size_bytes: '1',
      status: VideoStatus.DRAFT,
      public_id: 'same-id',
      thumbnail_object_key: null,
      multipart_upload_id: 'upload-id',
      duration_seconds: null,
      metadata: null,
      processing_error: null,
    };
    await repository.save({ ...base, source_object_key: 'source-1' });
    await expect(
      repository.save({ ...base, source_object_key: 'source-2' }),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
  });
});
