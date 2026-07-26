import { Type } from 'class-transformer';
import { IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ProcessingOptionsDto } from './processing-options.dto';

export class CreateProcessingPresetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ValidateNested()
  @Type(() => ProcessingOptionsDto)
  config!: ProcessingOptionsDto;
}
