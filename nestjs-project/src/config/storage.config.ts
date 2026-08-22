import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.S3_ENDPOINT ?? 'http://minio:9000',
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  accessKey: process.env.S3_ACCESS_KEY ?? 'streamtube',
  secretKey: process.env.S3_SECRET_KEY!,
  videosBucket: process.env.S3_VIDEOS_BUCKET ?? 'streamtube-videos',
  thumbnailsBucket: process.env.S3_THUMBNAILS_BUCKET ?? 'streamtube-thumbnails',
  presignedUrlExpiresSeconds: Number(
    process.env.S3_PRESIGNED_URL_EXPIRES_SECONDS ?? 900,
  ),
}));
