import { SocialPlatform } from '@speedora/shared';
import { IsEnum } from 'class-validator';

export class CreatePlatformCopyDto {
  @IsEnum(SocialPlatform)
  platform!: SocialPlatform;
}
