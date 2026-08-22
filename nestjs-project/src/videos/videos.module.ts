import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { Video } from './entities/video.entity';
import { VideoQueueService } from './video-queue.service';
import { VideoStorageService } from './video-storage.service';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [TypeOrmModule.forFeature([Video, Channel])],
  controllers: [VideosController],
  providers: [VideosService, VideoStorageService, VideoQueueService],
  exports: [TypeOrmModule, VideoStorageService],
})
export class VideosModule {}
