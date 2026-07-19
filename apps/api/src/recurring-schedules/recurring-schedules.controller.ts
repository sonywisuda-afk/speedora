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
import { CreateRecurringScheduleDto } from './dto/create-recurring-schedule.dto';
import { UpdateRecurringScheduleDto } from './dto/update-recurring-schedule.dto';
import { RecurringSchedulesService } from './recurring-schedules.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class RecurringSchedulesController {
  constructor(private readonly recurringSchedules: RecurringSchedulesService) {}

  @Post('workspaces/:workspaceId/recurring-schedules')
  create(
    @CurrentUser() user: SafeUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateRecurringScheduleDto,
  ) {
    return this.recurringSchedules.create(user.id, workspaceId, dto);
  }

  @Get('workspaces/:workspaceId/recurring-schedules')
  list(@CurrentUser() user: SafeUser, @Param('workspaceId') workspaceId: string) {
    return this.recurringSchedules.listByWorkspace(user.id, workspaceId);
  }

  @Get('recurring-schedules/:id')
  get(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.recurringSchedules.get(user.id, id);
  }

  @Patch('recurring-schedules/:id')
  update(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: UpdateRecurringScheduleDto,
  ) {
    return this.recurringSchedules.update(user.id, id, dto);
  }

  @Delete('recurring-schedules/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.recurringSchedules.remove(user.id, id);
  }
}
