import { Prisma } from '../generated/prisma/client';

/** Prisma's P2025: a conditional update or delete matched no row. */
export function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

/**
 * Prisma's P2002 raised by the named unique index. Checking the index keeps
 * an unrelated unique violation from being reported as the expected conflict.
 */
export function isUniqueViolation(error: unknown, index: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (
      error.meta as
        { driverAdapterError?: { cause?: { constraint?: { index?: string } } } } | undefined
    )?.driverAdapterError?.cause?.constraint?.index === index
  );
}
