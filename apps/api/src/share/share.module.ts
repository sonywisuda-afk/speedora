import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';

@Module({
  imports: [WorkspaceModule],
  controllers: [ShareController],
  providers: [ShareService],
})
export class ShareModule {}
