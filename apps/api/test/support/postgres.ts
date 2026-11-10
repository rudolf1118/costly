/** PostgreSQL's verdict on a statement it rejected. */
export interface Violation {
  /** SQLSTATE, e.g. 23505 unique, 23514 check, 23502 not null, 23503 foreign key. */
  code: string;
  /** PostgreSQL's message, which names the violated constraint. */
  message: string;
}

/** Runs a statement that must fail and returns PostgreSQL's SQLSTATE and message. */
export async function violation(statement: Promise<unknown>): Promise<Violation> {
  try {
    await statement;
  } catch (error) {
    // Prisma 7 driver adapters pass PostgreSQL's error through unchanged here.
    const cause = (
      error as {
        meta?: {
          driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } };
        };
      }
    ).meta?.driverAdapterError?.cause;
    if (cause?.originalCode) {
      return { code: cause.originalCode, message: cause.originalMessage ?? '' };
    }
    throw error;
  }
  throw new Error('expected the statement to be rejected by PostgreSQL');
}
