import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CONFIRMATION_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  PASSWORD_RESET_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  MAIL_HOST: Joi.string().default('mailpit'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_FROM: Joi.string().default('"StreamTube" <noreply@streamtube.com>'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('false'),
  S3_ENDPOINT: Joi.string().uri().default('http://minio:9000'),
  S3_PUBLIC_ENDPOINT: Joi.string().uri().default('http://localhost:9000'),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_ACCESS_KEY: Joi.string().default('streamtube'),
  S3_SECRET_KEY: Joi.string().min(16).required(),
  S3_VIDEOS_BUCKET: Joi.string().default('streamtube-videos'),
  S3_THUMBNAILS_BUCKET: Joi.string().default('streamtube-thumbnails'),
  S3_PRESIGNED_URL_EXPIRES_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(3600)
    .default(900),
  REDIS_HOST: Joi.string().default('redis'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  VIDEO_QUEUE_NAME: Joi.string().default('video-processing'),
  VIDEO_WORKER_CONCURRENCY: Joi.number().integer().min(1).max(8).default(1),
  VIDEO_PROCESSING_ATTEMPTS: Joi.number().integer().min(1).max(10).default(3),
  VIDEO_PROCESSING_BACKOFF_MS: Joi.number().integer().min(100).default(5000),
});
