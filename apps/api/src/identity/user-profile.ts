import type { Prisma } from '../generated/prisma/client';

/** The fields of a user the API may return: never credentials. */
export const userProfileFields = {
  id: true,
  email: true,
  baseCurrency: true,
  timezone: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type UserProfile = Prisma.UserGetPayload<{ select: typeof userProfileFields }>;
