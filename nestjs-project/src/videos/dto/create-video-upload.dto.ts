import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const MAX_VIDEO_SIZE_BYTES = 10 * 1024 * 1024 * 1024;
export const VIDEO_PART_SIZE_BYTES = 64 * 1024 * 1024;
export const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
] as const;

export class CreateVideoUploadDto {
  @ApiProperty({ example: 'Minha apresentação' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 'apresentacao.mp4' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ enum: ALLOWED_VIDEO_MIME_TYPES, example: 'video/mp4' })
  @IsIn(ALLOWED_VIDEO_MIME_TYPES)
  contentType: (typeof ALLOWED_VIDEO_MIME_TYPES)[number];

  @ApiProperty({ maximum: MAX_VIDEO_SIZE_BYTES, example: 104857600 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_SIZE_BYTES)
  sizeBytes: number;
}
