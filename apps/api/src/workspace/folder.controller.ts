import { Body, Controller, Delete, HttpCode, Param, Patch, UseGuards } from '@nestjs/common';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { FolderService } from './folder.service';

@Controller('folders')
@UseGuards(JwtAuthGuard)
export class FolderController {
  constructor(private readonly folderService: FolderService) {}

  @Patch(':id')
  update(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: UpdateFolderDto) {
    return this.folderService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.folderService.remove(user.id, id);
  }
}
