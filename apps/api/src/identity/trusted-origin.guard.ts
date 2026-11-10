import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../platform/config/env.schema';

/**
 * CSRF defence for the endpoints that use the refresh cookie, next to
 * SameSite=Strict (ADR-0006). Browsers send Origin on every POST, so a
 * request from any page other than the web client is refused. Requests with
 * no Origin at all come from non-browser clients, which a CSRF attack cannot
 * use, and are let through.
 */
@Injectable()
export class TrustedOriginGuard implements CanActivate {
  private readonly trustedOrigin: string;

  constructor(config: ConfigService<Env, true>) {
    this.trustedOrigin = new URL(config.get('CORS_ORIGIN', { infer: true })).origin;
  }

  canActivate(context: ExecutionContext): boolean {
    const origin = context.switchToHttp().getRequest<Request>().headers.origin;
    if (origin !== undefined && origin !== this.trustedOrigin) {
      throw new ForbiddenException('Requests from this origin are not allowed.');
    }
    return true;
  }
}
