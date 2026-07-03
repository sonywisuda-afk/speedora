import { IsNotEmpty, IsString } from 'class-validator';

export class PublishClipDto {
  @IsString()
  @IsNotEmpty()
  socialAccountId!: string;
}
