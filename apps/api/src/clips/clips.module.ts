import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { SocialModule } from '../social/social.module';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';

@Module({
  // SocialModule: ClipsService.publish() needs SocialAccountsService to
  // validate the target account belongs to the requester before enqueueing
  // a publish-clip job (Fase 6b).
  imports: [QueueModule, SocialModule],
  controllers: [ClipsController],
  providers: [ClipsService],
})
export class ClipsModule {}
