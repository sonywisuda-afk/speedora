import { IsString, MinLength } from 'class-validator';

export class MoveProjectDto {
  @IsString()
  @MinLength(1)
  targetWorkspaceId!: string;
}
