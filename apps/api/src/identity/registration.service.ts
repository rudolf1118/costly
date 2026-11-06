import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../platform/database/prisma.service';
import { hashPassword } from './password';
import type { RegisterInput } from './registration.schema';
import { type UserProfile, userProfileFields } from './user-profile';

/** What registration returns: the account, never its credentials. */
export type RegisteredUser = UserProfile;

@Injectable()
export class RegistrationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates the user in a single INSERT. There is deliberately no "is this
   * email taken?" query first: two concurrent requests would both pass it.
   * The unique index on users.email decides, and its violation becomes a 409.
   */
  async register(input: RegisterInput): Promise<RegisteredUser> {
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          timezone: input.timezone,
          baseCurrency: input.baseCurrency,
        },
        select: userProfileFields,
      });
    } catch (error) {
      if (isDuplicateEmail(error)) {
        throw new ConflictException('An account with this email already exists.');
      }
      throw error;
    }
  }
}

/**
 * Prisma 7 reports a unique violation as P2002 and, through the driver
 * adapter, names the index that was violated.
 */
function isDuplicateEmail(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const meta = error.meta as
    { driverAdapterError?: { cause?: { constraint?: { index?: string } } } } | undefined;
  return meta?.driverAdapterError?.cause?.constraint?.index === 'users_email_key';
}
