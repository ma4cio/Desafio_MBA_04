import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';
import { InvalidRangeException } from './video.exceptions';

export interface StoredObjectHead {
  size: number;
  contentType?: string;
}

export interface StoredObjectStream {
  body: Readable;
  contentLength: number;
  totalLength: number;
  contentType: string;
  contentRange?: string;
  statusCode: 200 | 206;
}

@Injectable()
export class VideoStorageService {
  private readonly client: S3Client;
  private readonly signingClient: S3Client;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {
    const common = {
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    };
    this.client = new S3Client({ ...common, endpoint: config.endpoint });
    this.signingClient = new S3Client({
      ...common,
      endpoint: config.publicEndpoint,
    });
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.videosBucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!result.UploadId)
      throw new Error('Storage did not return an upload ID');
    return result.UploadId;
  }

  async signUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    return getSignedUrl(
      this.signingClient,
      new UploadPartCommand({
        Bucket: this.config.videosBucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: this.config.presignedUrlExpiresSeconds },
    );
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; eTag: string }>,
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.videosBucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.eTag,
          })),
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.config.videosBucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async headVideo(key: string): Promise<StoredObjectHead> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.videosBucket, Key: key }),
    );
    return {
      size: result.ContentLength ?? 0,
      contentType: result.ContentType,
    };
  }

  async deleteVideo(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.videosBucket, Key: key }),
    );
  }

  async downloadVideo(key: string, destination: string): Promise<void> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.videosBucket, Key: key }),
    );
    const body = result.Body as Readable | undefined;
    if (!body) throw new Error('Storage returned an empty object body');
    const { pipeline } = await import('node:stream/promises');
    const { createWriteStream } = await import('node:fs');
    await pipeline(body, createWriteStream(destination, { flags: 'wx' }));
  }

  async uploadThumbnail(key: string, sourcePath: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.thumbnailsBucket,
        Key: key,
        Body: createReadStream(sourcePath),
        ContentType: 'image/jpeg',
      }),
    );
  }

  async getThumbnail(key: string): Promise<StoredObjectStream> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.thumbnailsBucket,
        Key: key,
      }),
    );
    const body = result.Body as Readable | undefined;
    if (!body) throw new Error('Storage returned an empty thumbnail body');
    const size = result.ContentLength ?? 0;
    return {
      body,
      contentLength: size,
      totalLength: size,
      contentType: result.ContentType ?? 'image/jpeg',
      statusCode: 200,
    };
  }

  async getVideo(
    key: string,
    rangeHeader?: string,
  ): Promise<StoredObjectStream> {
    const head = await this.headVideo(key);
    const range = rangeHeader
      ? this.parseRange(rangeHeader, head.size)
      : undefined;
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.videosBucket,
        Key: key,
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }),
    );
    const body = result.Body as Readable | undefined;
    if (!body) throw new Error('Storage returned an empty object body');
    const contentLength = range
      ? range.end - range.start + 1
      : (result.ContentLength ?? head.size);
    return {
      body,
      contentLength,
      totalLength: head.size,
      contentType:
        result.ContentType ?? head.contentType ?? 'application/octet-stream',
      contentRange: range
        ? `bytes ${range.start}-${range.end}/${head.size}`
        : undefined,
      statusCode: range ? 206 : 200,
    };
  }

  private parseRange(
    value: string,
    size: number,
  ): { start: number; end: number } {
    const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
    if (!match || size <= 0 || (!match[1] && !match[2])) {
      throw new InvalidRangeException();
    }

    let start: number;
    let end: number;
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        throw new InvalidRangeException();
      }
      start = Math.max(size - suffixLength, 0);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : size - 1;
    }

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= size ||
      end < start
    ) {
      throw new InvalidRangeException();
    }
    return { start, end: Math.min(end, size - 1) };
  }
}
