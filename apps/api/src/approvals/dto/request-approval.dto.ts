import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestApprovalDto {
  @IsOptional()
  @IsString()
  clipId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  // If omitted, REVIEW_REQUEST notifies the video's owner instead (see
  // ApprovalService.notify) - validated as a real REVIEWER+ workspace
  // member, never an arbitrary user id.
  @IsOptional()
  @IsString()
  reviewerId?: string;
}
