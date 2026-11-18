import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { DatabaseModule } from '../platform/database/database.module';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';

/**
 * Analytics: facts computed from the ledger with raw SQL (ADR-0003). In
 * Chapter 1 that is the dashboard's monthly summary; baselines, trends and
 * the recompute marker arrive in Chapter 2. It reads the ledger's tables and
 * never writes them; it depends on identity only for AccessTokenGuard
 * (ADR-0001: dependencies point one way).
 */
@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class AnalyticsModule {}
