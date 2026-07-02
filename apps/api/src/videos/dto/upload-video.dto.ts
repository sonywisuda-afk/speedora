import { IsNotEmpty, IsString } from 'class-validator';

export class UploadVideoDto {
  @IsString()
  @IsNotEmpty()
  ownerId: string;
}
