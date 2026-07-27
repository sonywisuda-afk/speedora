import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ProcessingOptionsDto } from './processing-options.dto';

export class UpdateProcessingPresetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProcessingOptionsDto)
  config?: ProcessingOptionsDto;
}
