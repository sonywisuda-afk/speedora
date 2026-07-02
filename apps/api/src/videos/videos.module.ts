import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [StorageModule],
  controllers: [VideosController],
  providers: [VideosService],
})
export class VideosModule {}
