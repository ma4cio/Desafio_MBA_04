import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  DeleteObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { execFile } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { User } from '../src/users/entities/user.entity';
import { MAX_VIDEO_SIZE_BYTES } from '../src/videos/dto/create-video-upload.dto';
import { Video } from '../src/videos/entities/video.entity';

const execFileAsync = promisify(execFile);

jest.setTimeout(60_000);

describe('Videos upload API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let accessToken: string;
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://minio:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'streamtube',
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await dataSource.query('DELETE FROM "refresh_tokens"');
    await dataSource.query('DELETE FROM "verification_tokens"');
    await dataSource.query('DELETE FROM "channels"');
    await dataSource.query('DELETE FROM "users"');
    const user = await dataSource.getRepository(User).save({
      email: 'video-owner@example.com',
      password: 'hash',
      is_confirmed: true,
    });
    await dataSource.getRepository(Channel).save({
      name: 'Owner',
      nickname: 'video_owner',
      user_id: user.id,
    });
    accessToken = await app.get(JwtService).signAsync({
      sub: user.id,
      email: user.email,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('uploads, processes, streams, downloads and serves a thumbnail', async () => {
    const fixture = `/tmp/streamtube-e2e-${Date.now()}.mp4`;
    await execFileAsync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=25',
      '-t',
      '1',
      '-c:v',
      'mpeg4',
      '-pix_fmt',
      'yuv420p',
      '-y',
      fixture,
    ]);
    const fixtureSize = (await stat(fixture)).size;
    const created = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'E2E video',
        filename: 'video.mp4',
        contentType: 'video/mp4',
        sizeBytes: fixtureSize,
      })
      .expect(201);

    expect(created.body).toMatchObject({
      status: 'draft',
      totalParts: 1,
      partSizeBytes: 64 * 1024 * 1024,
    });
    expect(created.body.publicId).toMatch(/^[a-f0-9]{32}$/);

    const signed = await request(app.getHttpServer())
      .post(`/videos/${created.body.id}/upload-parts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ partNumbers: [1, 1] })
      .expect(200);
    expect(signed.body).toHaveLength(1);
    expect(signed.body[0]).toMatchObject({ partNumber: 1 });
    expect(signed.body[0].url).toContain('localhost:9000');

    const video = await dataSource.getRepository(Video).findOneByOrFail({
      id: created.body.id,
    });
    const uploadedPart = await s3.send(
      new UploadPartCommand({
        Bucket: process.env.S3_VIDEOS_BUCKET ?? 'streamtube-videos',
        Key: video.source_object_key,
        UploadId: video.multipart_upload_id!,
        PartNumber: 1,
        Body: await readFile(fixture),
      }),
    );
    expect(uploadedPart.ETag).toBeDefined();

    await request(app.getHttpServer())
      .post(`/videos/${created.body.id}/uploads/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ parts: [{ partNumber: 1, eTag: uploadedPart.ETag }] })
      .expect(202)
      .expect(({ body }) => expect(body.status).toBe('processing'));

    let status: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await request(app.getHttpServer())
        .get(`/videos/${created.body.publicId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      status = response.body as Record<string, unknown>;
      if (status.status === 'ready' || status.status === 'error') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(status).toMatchObject({ status: 'ready', durationSeconds: 1 });

    await request(app.getHttpServer())
      .get(`/videos/${created.body.publicId}/stream`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Range', 'bytes=0-99')
      .expect(206)
      .expect('Accept-Ranges', 'bytes')
      .expect('Content-Range', `bytes 0-99/${fixtureSize}`)
      .expect('Content-Length', '100');

    await request(app.getHttpServer())
      .get(`/videos/${created.body.publicId}/thumbnail`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect('Content-Type', /image\/jpeg/);

    await request(app.getHttpServer())
      .get(`/videos/${created.body.publicId}/download`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(
        'Content-Disposition',
        'attachment; filename="video.mp4"; filename*=UTF-8\'\'video.mp4',
      )
      .expect('Content-Length', String(fixtureSize));

    const processed = await dataSource.getRepository(Video).findOneByOrFail({
      id: created.body.id,
    });
    await Promise.all([
      s3.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_VIDEOS_BUCKET ?? 'streamtube-videos',
          Key: processed.source_object_key,
        }),
      ),
      processed.thumbnail_object_key
        ? s3.send(
            new DeleteObjectCommand({
              Bucket:
                process.env.S3_THUMBNAILS_BUCKET ?? 'streamtube-thumbnails',
              Key: processed.thumbnail_object_key,
            }),
          )
        : Promise.resolve(),
    ]);
    await rm(fixture, { force: true });
  });

  it('rejects declarations above 10 GiB before contacting storage', async () => {
    await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Too large',
        filename: 'video.mp4',
        contentType: 'video/mp4',
        sizeBytes: MAX_VIDEO_SIZE_BYTES + 1,
      })
      .expect(400);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post('/videos/uploads')
      .send({
        title: 'Unauthorized',
        filename: 'video.mp4',
        contentType: 'video/mp4',
        sizeBytes: 1,
      })
      .expect(401);
  });
});
