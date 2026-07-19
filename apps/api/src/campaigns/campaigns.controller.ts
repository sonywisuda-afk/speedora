import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { TrendGranularity } from '@speedora/shared';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

// Sprint 6E - same "invalid/missing falls back to a default" posture as
// AnalyticsController's own parseGranularity.
const VALID_GRANULARITIES: TrendGranularity[] = ['daily', 'weekly', 'monthly', 'yearly'];
const DEFAULT_GRANULARITY: TrendGranularity = 'daily';

function parseGranularity(raw: string | undefined): TrendGranularity {
  return raw && (VALID_GRANULARITIES as string[]).includes(raw)
    ? (raw as TrendGranularity)
    : DEFAULT_GRANULARITY;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post('workspaces/:workspaceId/campaigns')
  create(
    @CurrentUser() user: SafeUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.campaigns.create(user.id, workspaceId, dto);
  }

  @Get('workspaces/:workspaceId/campaigns')
  list(@CurrentUser() user: SafeUser, @Param('workspaceId') workspaceId: string) {
    return this.campaigns.listByWorkspace(user.id, workspaceId);
  }

  @Get('campaigns/:id')
  get(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.campaigns.get(user.id, id);
  }

  @Get('campaigns/:id/analytics')
  getAnalytics(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Query('granularity') granularity?: string,
  ) {
    return this.campaigns.getAnalytics(user.id, id, { granularity: parseGranularity(granularity) });
  }

  @Patch('campaigns/:id')
  update(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.campaigns.update(user.id, id, dto);
  }

  @Post('campaigns/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.campaigns.cancel(user.id, id);
  }
}
