import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApprovalsService } from './approvals.service';
import { DecideApprovalDto } from './dto/decide-approval.dto';
import { RequestApprovalDto } from './dto/request-approval.dto';
import { ResubmitApprovalDto } from './dto/resubmit-approval.dto';

// Sprint 5D (Approval). Same "nest create/list under the parent resource,
// everything else under the resource's own id" shape as
// comments.controller.ts.
@Controller()
@UseGuards(JwtAuthGuard)
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Post('videos/:videoId/approvals')
  request(
    @CurrentUser() user: SafeUser,
    @Param('videoId') videoId: string,
    @Body() dto: RequestApprovalDto,
  ) {
    return this.approvalsService.request(user.id, videoId, dto);
  }

  @Get('videos/:videoId/approvals')
  list(@CurrentUser() user: SafeUser, @Param('videoId') videoId: string) {
    return this.approvalsService.listForVideo(user.id, videoId);
  }

  @Post('approvals/:id/decide')
  @HttpCode(200)
  decide(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: DecideApprovalDto) {
    return this.approvalsService.decide(user.id, id, dto);
  }

  @Post('approvals/:id/resubmit')
  @HttpCode(200)
  resubmit(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: ResubmitApprovalDto,
  ) {
    return this.approvalsService.resubmit(user.id, id, dto);
  }
}
