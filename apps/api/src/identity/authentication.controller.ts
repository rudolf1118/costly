import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Env } from '../platform/config/env.schema';
import { ZodValidationPipe } from '../platform/http/zod-validation.pipe';
import {
  AccessTokenGuard,
  type AuthenticatedUser,
  challengeBearer,
  CurrentUser,
} from './access-token.guard';
import { AuthenticationService, type SessionTokens } from './authentication.service';
import { type LoginInput, loginSchema } from './login.schema';
import { setRefreshCookie } from './refresh-cookie';
import { TrustedOriginGuard } from './trusted-origin.guard';
import type { UserProfile } from './user-profile';

/** The access token goes in the body; the refresh token only in its cookie. */
export interface AccessTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

@Controller('auth')
export class AuthenticationController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly authentication: AuthenticationService,
    config: ConfigService<Env, true>,
  ) {
    this.secureCookies = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  /** 200 with an access token and the refresh cookie; 401 for any wrong credential. */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TrustedOriginGuard)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponse> {
    return this.respond(await this.authentication.login(body.email, body.password), response);
  }

  /** The authenticated user's profile. */
  @Get('me')
  @UseGuards(AccessTokenGuard)
  async me(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserProfile> {
    try {
      return await this.authentication.profile(user.id);
    } catch (error) {
      // A valid token for an account that no longer exists is still a failed Bearer authentication.
      if (error instanceof UnauthorizedException) challengeBearer(response);
      throw error;
    }
  }

  private respond(session: SessionTokens, response: Response): AccessTokenResponse {
    setRefreshCookie(
      response,
      session.refresh.token,
      session.refresh.expiresAt,
      this.secureCookies,
    );
    // Tokens must not be stored by any cache along the way.
    response.setHeader('Cache-Control', 'no-store');
    return { accessToken: session.accessToken, tokenType: 'Bearer', expiresIn: session.expiresIn };
  }
}
