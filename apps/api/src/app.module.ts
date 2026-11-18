import { Module } from '@nestjs/common';
import { AnalyticsModule } from './analytics/analytics.module';
import { IdentityModule } from './identity/identity.module';
import { LedgerModule } from './ledger/ledger.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [PlatformModule, IdentityModule, LedgerModule, AnalyticsModule],
})
export class AppModule {}
