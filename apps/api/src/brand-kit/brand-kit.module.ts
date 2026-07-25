import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { BrandKitController } from './brand-kit.controller';
import { BrandKitService } from './brand-kit.service';

@Module({
  // WorkspaceModule: WorkspaceAccessService, for P3g's target resolution.
  imports: [StorageModule, WorkspaceModule],
  controllers: [BrandKitController],
  providers: [BrandKitService],
})
export class BrandKitModule {}
