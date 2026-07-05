import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService],
  // VideosModule (Fase premium transcription) needs consumeCredit()/
  // getAvailability() when a video is created with transcriptionProvider
  // OPENAI.
  exports: [PaymentsService],
})
export class PaymentsModule {}
