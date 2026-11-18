import { z } from 'zod';
import { TransactionType } from '../../generated/prisma/client';
import { positiveMinorUnits } from '../../platform/money/minor-units';
import { calendarDate, pastCalendarDate } from '../calendar-date';

/** docs/02-requirements/ledger-transactions.md */

const DESCRIPTION_MAX = 255;

export const transactionType = z.enum(TransactionType, {
  error: 'Must be one of: income, expense',
});

const accountId = z.uuid({ error: 'Must be an account id (UUID)' });
const categoryId = z.uuid({ error: 'Must be a category id (UUID)' });

/**
 * An optional free-text note on the transaction. NFC-normalized and trimmed
 * like a name, up to 255 code points, no control characters. A blank string
 * means "no description" and becomes null, as the table stores it.
 */
const description = z
  .string()
  .normalize('NFC')
  .trim()
  .refine((text) => [...text].length <= DESCRIPTION_MAX, {
    error: `Must be at most ${DESCRIPTION_MAX} characters`,
  })
  .refine((text) => !/[\p{Cc}\p{Cs}]/u.test(text), {
    error: 'Must not contain control characters or invalid Unicode',
  })
  .transform((text) => (text === '' ? null : text))
  .nullable();

/**
 * The owner comes from the access token and the currency from the account, so
 * neither can be sent: the object is strict and either is a 400.
 */
export const createTransactionSchema = z.strictObject({
  type: transactionType,
  accountId,
  categoryId,
  amount: positiveMinorUnits,
  occurredOn: pastCalendarDate,
  description: description.optional(),
});

export type CreateTransactionInput = z.output<typeof createTransactionSchema>;

/** Every field can change; the result must satisfy the same rules as a new transaction. */
export const updateTransactionSchema = z
  .strictObject({
    type: transactionType.optional(),
    accountId: accountId.optional(),
    categoryId: categoryId.optional(),
    amount: positiveMinorUnits.optional(),
    occurredOn: pastCalendarDate.optional(),
    description: description.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: 'Provide at least one of: type, accountId, categoryId, amount, occurredOn, description',
  });

export type UpdateTransactionInput = z.output<typeof updateTransactionSchema>;

/** Where the previous page ended: the last row's position in the list order. */
export interface PageCursor {
  occurredOn: string;
  id: string;
}

/**
 * Cursors are opaque to clients: base64url of "YYYY-MM-DD.<uuid>". Encoding
 * keeps clients from building or editing them; the API still validates every
 * one it receives, so a forged cursor can only select the user's own rows.
 */
export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(`${cursor.occurredOn}.${cursor.id}`, 'utf8').toString('base64url');
}

const cursorParts = z.tuple([calendarDate, z.uuid()]);

const cursor = z
  .string()
  .max(128, { error: 'Must be a cursor from a previous page', abort: true })
  .transform((value, context): PageCursor => {
    const parts = cursorParts.safeParse(
      Buffer.from(value, 'base64url').toString('utf8').split('.'),
    );
    if (!parts.success) {
      context.addIssue({ code: 'custom', message: 'Must be a cursor from a previous page' });
      return z.NEVER;
    }
    return { occurredOn: parts.data[0], id: parts.data[1] };
  });

export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 100;

const limit = z
  .string()
  .regex(/^[1-9][0-9]{0,2}$/, { error: `Must be a whole number from 1 to ${LIST_LIMIT_MAX}` })
  .transform(Number)
  .refine((value) => value <= LIST_LIMIT_MAX, {
    error: `Must be a whole number from 1 to ${LIST_LIMIT_MAX}`,
  });

/** GET /transactions. Query values arrive as strings; every one is optional. */
export const listTransactionsQuerySchema = z
  .strictObject({
    accountId: accountId.optional(),
    categoryId: categoryId.optional(),
    type: transactionType.optional(),
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    limit: limit.default(LIST_LIMIT_DEFAULT),
    cursor: cursor.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    error: 'Must not be after to',
    path: ['from'],
  });

export type ListTransactionsQuery = z.output<typeof listTransactionsQuerySchema>;

/** The :id route parameter. A malformed id is a 400 and says nothing about any transaction. */
export const transactionParamsSchema = z.strictObject({
  id: z.uuid({ error: 'Must be a transaction id (UUID)' }),
});

export type TransactionParams = z.output<typeof transactionParamsSchema>;
