import { Module } from '@nestjs/common';
import { DatabaseModule } from '../platform/database/database.module';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';

/**
 * Identity: who the user is. Registration only for now; login, tokens and the
 * guard that resolves the current user arrive in later tasks.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [RegistrationController],
  providers: [RegistrationService],
})
export class IdentityModule {}
