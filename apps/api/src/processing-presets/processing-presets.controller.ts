import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateProcessingPresetDto } from './dto/create-processing-preset.dto';
import { UpdateProcessingPresetDto } from './dto/update-processing-preset.dto';
import { ProcessingPresetsService } from './processing-presets.service';

@Controller('processing-presets')
@UseGuards(JwtAuthGuard)
export class ProcessingPresetsController {
  constructor(private readonly processingPresets: ProcessingPresetsService) {}

  @Post()
  create(@CurrentUser() user: SafeUser, @Body() dto: CreateProcessingPresetDto) {
    return this.processingPresets.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: SafeUser) {
    return this.processingPresets.list(user.id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: UpdateProcessingPresetDto,
  ) {
    return this.processingPresets.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.processingPresets.remove(user.id, id);
  }
}
