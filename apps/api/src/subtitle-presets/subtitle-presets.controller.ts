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
import { CreateSubtitlePresetDto } from './dto/create-subtitle-preset.dto';
import { UpdateSubtitlePresetDto } from './dto/update-subtitle-preset.dto';
import { SubtitlePresetsService } from './subtitle-presets.service';

@Controller('subtitle-presets')
@UseGuards(JwtAuthGuard)
export class SubtitlePresetsController {
  constructor(private readonly subtitlePresets: SubtitlePresetsService) {}

  @Post()
  create(@CurrentUser() user: SafeUser, @Body() dto: CreateSubtitlePresetDto) {
    return this.subtitlePresets.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: SafeUser) {
    return this.subtitlePresets.list(user.id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: UpdateSubtitlePresetDto,
  ) {
    return this.subtitlePresets.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.subtitlePresets.remove(user.id, id);
  }
}
