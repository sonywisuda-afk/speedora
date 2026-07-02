import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';

@Module({
  imports: [QueueModule],
  controllers: [ClipsController],
  providers: [ClipsService],
})
export class ClipsModule {}
