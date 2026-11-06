import { Body, Controller, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../platform/http/zod-validation.pipe';
import { type RegisterInput, registerSchema } from './registration.schema';
import { type RegisteredUser, RegistrationService } from './registration.service';

@Controller('auth')
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  /** 201 with the new account; 400 for an invalid body; 409 if the email is taken. */
  @Post('register')
  register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
  ): Promise<RegisteredUser> {
    return this.registration.register(body);
  }
}
