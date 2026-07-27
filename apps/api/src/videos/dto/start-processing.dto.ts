import { Type } from 'class-transformer';
import { IsObject, ValidateNested } from 'class-validator';
import { ProcessingOptionsDto } from '../../processing-presets/dto/processing-options.dto';

// Quality Validation roadmap (Fase 0 design, Phase 1) - the request body
// for POST /videos/:id/start-processing. Unlike UploadVideoDto/
// ImportYoutubeDto's own processingOptions field (optional there, since
// those requests happen before Processing Settings even renders in the new
// flow), this is the point processingOptions is actually collected -
// @IsObject() rejects a missing/non-object value outright rather than
// silently falling through to every default (ProcessingOptionsDto's own
// fields are all individually optional, so `{}` is still legal input and
// means "every default").
export class StartProcessingDto {
  @IsObject()
  @ValidateNested()
  @Type(() => ProcessingOptionsDto)
  processingOptions!: ProcessingOptionsDto;
}
