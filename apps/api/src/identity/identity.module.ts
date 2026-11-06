import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../platform/config/env.schema';
import { DatabaseModule } from '../platform/database/database.module';
import { AccessTokenGuard } from './access-token.guard';
import { AccessTokenService } from './access-token.service';
import { AuthenticationController } from './authentication.controller';
import { AuthenticationService } from './authentication.service';
import { RefreshTokensService } from './refresh-tokens.service';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { TrustedOriginGuard } from './trusted-origin.guard';

/**
 * Identity: who the user is. Registration, login, refresh sessions and the
 * guard other modules use to resolve the current user (ADR-0006).
 */
@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      // Only the key is set here; AccessTokenService passes the algorithm,
      // issuer, audience and lifetime explicitly.
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
      }),
    }),
  ],
  controllers: [RegistrationController, AuthenticationController],
  providers: [
    RegistrationService,
    AuthenticationService,
    AccessTokenService,
    RefreshTokensService,
    AccessTokenGuard,
    TrustedOriginGuard,
  ],
  exports: [AccessTokenService, AccessTokenGuard],
})
export class IdentityModule {}
