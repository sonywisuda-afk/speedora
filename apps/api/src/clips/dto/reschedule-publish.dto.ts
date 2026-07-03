import { IsISO8601 } from 'class-validator';

export class ReschedulePublishDto {
  @IsISO8601()
  scheduledAt!: string;
}
