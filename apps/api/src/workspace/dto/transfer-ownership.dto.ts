import { IsString, MinLength } from 'class-validator';

export class TransferOwnershipDto {
  @IsString()
  @MinLength(1)
  newOwnerUserId!: string;
}
