import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '../platform/http/zod-validation.pipe';
import { RateLimitGuard, RateLimitPerIp } from '../platform/rate-limit/rate-limit.guard';
import { REGISTER_PER_IP } from './auth-rate-limits';
import { type RegisterInput, registerSchema } from './registration.schema';
import { type RegisteredUser, RegistrationService } from './registration.service';

@Controller('auth')
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  /** 201 with the new account; 400 for an invalid body; 409 if the email is taken. */
  @Post('register')
  // Before validation and hashing: a rejected request costs one Redis call.
  @UseGuards(RateLimitGuard)
  @RateLimitPerIp(REGISTER_PER_IP)
  register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
  ): Promise<RegisteredUser> {
    return this.registration.register(body);
  }
}
