import { IsString, MinLength } from 'class-validator';
import { BulkProjectIdsDto } from './bulk-project-ids.dto';

export class BulkMoveProjectDto extends BulkProjectIdsDto {
  @IsString()
  @MinLength(1)
  targetWorkspaceId!: string;
}
