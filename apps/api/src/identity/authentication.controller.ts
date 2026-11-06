import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Env } from '../platform/config/env.schema';
import { ZodValidationPipe } from '../platform/http/zod-validation.pipe';
import { RateLimitGuard, RateLimitPerIp } from '../platform/rate-limit/rate-limit.guard';
import {
  AccessTokenGuard,
  type AuthenticatedUser,
  challengeBearer,
  CurrentUser,
} from './access-token.guard';
import { AuthenticationService, type SessionTokens } from './authentication.service';
import { LOGIN_PER_IP, REFRESH_PER_IP } from './auth-rate-limits';
import { type LoginInput, loginSchema } from './login.schema';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';
import { invalidRefreshSession } from './refresh-tokens.service';
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
  // Origin first: a cross-site page must not use up the victim's IP budget.
  @UseGuards(TrustedOriginGuard, RateLimitGuard)
  @RateLimitPerIp(LOGIN_PER_IP)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponse> {
    return this.respond(await this.authentication.login(body.email, body.password), response);
  }

  /**
   * Rotates the refresh cookie and returns a new access token. 401 for a
   * missing, unknown, expired, revoked or reused refresh token; a reused one
   * also ends its session (ADR-0006). The cookie is cleared on any 401. A 409
   * (a concurrent request already rotated it) leaves the cookie alone: the
   * browser already holds the successor, and clearing it would lose the session.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TrustedOriginGuard, RateLimitGuard)
  @RateLimitPerIp(REFRESH_PER_IP)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponse> {
    try {
      const token = readRefreshCookie(request);
      if (!token) throw invalidRefreshSession();
      return this.respond(await this.authentication.refresh(token), response);
    } catch (error) {
      if (error instanceof UnauthorizedException) clearRefreshCookie(response, this.secureCookies);
      throw error;
    }
  }

  /**
   * Ends the session of the refresh cookie and clears it. Needs no access
   * token, so it works after the access token has expired. Always 204,
   * whether or not there was a session to end.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(TrustedOriginGuard)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = readRefreshCookie(request);
    if (token) await this.authentication.logout(token);
    clearRefreshCookie(response, this.secureCookies);
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
