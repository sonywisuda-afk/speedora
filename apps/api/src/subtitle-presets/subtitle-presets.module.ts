import { Module } from '@nestjs/common';
import { SubtitlePresetsController } from './subtitle-presets.controller';
import { SubtitlePresetsService } from './subtitle-presets.service';

@Module({
  controllers: [SubtitlePresetsController],
  providers: [SubtitlePresetsService],
})
export class SubtitlePresetsModule {}
