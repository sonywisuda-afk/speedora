import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// APPROVED/REJECTED/NEEDS_REVISION only - PENDING is never a valid decision
// (it's the state a request starts in / returns to on resubmit, not
// something a reviewer picks).
export class DecideApprovalDto {
  @IsIn(['APPROVED', 'REJECTED', 'NEEDS_REVISION'])
  status!: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
