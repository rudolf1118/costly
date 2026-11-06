import { Module } from '@nestjs/common';
import { IdentityModule } from './identity/identity.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [PlatformModule, IdentityModule],
})
export class AppModule {}
