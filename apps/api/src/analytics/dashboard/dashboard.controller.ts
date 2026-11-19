import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  AccessTokenGuard,
  type AuthenticatedUser,
  CurrentUser,
} from '../../identity/access-token.guard';
import { ZodValidationPipe } from '../../platform/http/zod-validation.pipe';
import { type DashboardSummary, DashboardService } from './dashboard.service';
import { type DashboardQuery, dashboardQuerySchema } from './month';

/** The owner is always the authenticated user; requests cannot name one. */
@Controller('dashboard')
@UseGuards(AccessTokenGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Everything the dashboard shows for one month; 400 for a missing, malformed or future month. */
  @Get('summary')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQuery,
  ): Promise<DashboardSummary> {
    return this.dashboard.summary(user.id, query.month);
  }
}
