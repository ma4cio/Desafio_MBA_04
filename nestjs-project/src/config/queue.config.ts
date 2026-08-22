import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  host: process.env.REDIS_HOST ?? 'redis',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  videoQueueName: process.env.VIDEO_QUEUE_NAME ?? 'video-processing',
  concurrency: Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 1),
  attempts: Number(process.env.VIDEO_PROCESSING_ATTEMPTS ?? 3),
  backoffMs: Number(process.env.VIDEO_PROCESSING_BACKOFF_MS ?? 5000),
}));
