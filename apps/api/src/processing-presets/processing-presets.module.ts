import { Module } from '@nestjs/common';
import { ProcessingPresetsController } from './processing-presets.controller';
import { ProcessingPresetsService } from './processing-presets.service';

@Module({
  controllers: [ProcessingPresetsController],
  providers: [ProcessingPresetsService],
})
export class ProcessingPresetsModule {}
