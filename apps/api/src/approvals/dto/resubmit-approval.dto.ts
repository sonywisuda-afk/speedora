import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ResubmitApprovalDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
