import { Module } from '@nestjs/common';
import { IdentityModule } from './identity/identity.module';
import { LedgerModule } from './ledger/ledger.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [PlatformModule, IdentityModule, LedgerModule],
})
export class AppModule {}
