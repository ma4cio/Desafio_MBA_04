import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CompleteVideoUploadDto } from './dto/complete-video-upload.dto';
import { CreateVideoUploadDto } from './dto/create-video-upload.dto';
import { SignUploadPartsDto } from './dto/sign-upload-parts.dto';
import { StoredObjectStream } from './video-storage.service';
import { VideosService } from './videos.service';

@ApiTags('videos')
@ApiBearerAuth()
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('uploads')
  @ApiOperation({ summary: 'Create a draft and initiate multipart upload' })
  @ApiResponse({ status: 201, description: 'Multipart upload initiated' })
  createUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoUploadDto,
  ) {
    return this.videosService.createUpload(user.sub, dto);
  }

  @Post(':id/upload-parts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create presigned URLs for a batch of parts' })
  signUploadParts(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignUploadPartsDto,
  ) {
    return this.videosService.signParts(user.sub, id, dto);
  }

  @Post(':id/uploads/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Complete upload and enqueue video processing' })
  completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteVideoUploadDto,
  ) {
    return this.videosService.completeUpload(user.sub, id, dto);
  }

  @Delete(':id/uploads')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Abort an incomplete multipart upload' })
  abortUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.videosService.abortUpload(user.sub, id);
  }

  @Get(':publicId')
  @ApiOperation({ summary: 'Get processing status and video metadata' })
  async getVideo(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    const video = await this.videosService.getVideo(user.sub, publicId);
    return {
      id: video.id,
      publicId: video.public_id,
      title: video.title,
      status: video.status,
      durationSeconds: video.duration_seconds,
      metadata: video.metadata,
      createdAt: video.created_at,
      updatedAt: video.updated_at,
    };
  }

  @Get(':publicId/stream')
  @ApiOperation({ summary: 'Stream a ready video with HTTP byte ranges' })
  async stream(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const stored = await this.videosService.streamVideo(
      user.sub,
      publicId,
      request.headers.range,
    );
    this.pipeStoredObject(response, stored);
  }

  @Get(':publicId/download')
  @ApiOperation({ summary: 'Download a ready video' })
  async download(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ): Promise<void> {
    const { stream, filename } = await this.videosService.downloadVideo(
      user.sub,
      publicId,
    );
    const asciiFilename = filename.replace(/[^\x20-\x7e]/g, '_');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    this.pipeStoredObject(response, stream);
  }

  @Get(':publicId/thumbnail')
  @Header('Cache-Control', 'private, max-age=3600')
  @ApiOperation({ summary: 'Get the generated video thumbnail' })
  async thumbnail(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ): Promise<void> {
    const stored = await this.videosService.getThumbnail(user.sub, publicId);
    this.pipeStoredObject(response, stored);
  }

  private pipeStoredObject(
    response: Response,
    stored: StoredObjectStream,
  ): void {
    response.status(stored.statusCode);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Content-Type', stored.contentType);
    response.setHeader('Content-Length', String(stored.contentLength));
    if (stored.contentRange) {
      response.setHeader('Content-Range', stored.contentRange);
    }
    stored.body.on('error', (error) => response.destroy(error));
    stored.body.pipe(response);
  }
}
