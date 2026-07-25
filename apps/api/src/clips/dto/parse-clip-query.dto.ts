import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ParseClipQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  query!: string;

  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}
