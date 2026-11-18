import { z } from 'zod';
import { minorUnits } from '../../platform/money/minor-units';
import { pastCalendarDate } from '../calendar-date';
import { displayName } from '../display-name';
import { AccountType } from '../../generated/prisma/client';

/** checking, cash and credit_card count as money available to spend; savings doesn't. */
export const DEFAULT_LIQUIDITY: Record<AccountType, boolean> = {
  checking: true,
  cash: true,
  savings: false,
  credit_card: true,
};

const accountType = z.enum(AccountType, {
  error: 'Must be one of: checking, cash, savings, credit_card',
});

/** docs/02-requirements/ledger-accounts.md */
export const createAccountSchema = z.strictObject({
  name: displayName,
  type: accountType,
  // v1 has a single currency (ADR-0002); the field exists so clients don't change later.
  currency: z.literal('AMD', { error: 'Only AMD is supported' }).default('AMD'),
  isLiquid: z.boolean().optional(),
  openingBalance: minorUnits,
  openingDate: pastCalendarDate,
});

export type CreateAccountInput = z.output<typeof createAccountSchema>;

export const listAccountsQuerySchema = z.strictObject({
  status: z.enum(['active', 'archived', 'all']).default('active'),
});

export type ListAccountsQuery = z.output<typeof listAccountsQuerySchema>;

/** The :id route parameter. A malformed id is a 400 and says nothing about any account. */
export const accountParamsSchema = z.strictObject({
  id: z.uuid({ error: 'Must be an account id (UUID)' }),
});

export type AccountParams = z.output<typeof accountParamsSchema>;

/**
 * The editable fields. Strict, so an attempt to change the opening balance,
 * opening date, currency, owner or archive state is a 400, never ignored.
 */
export const updateAccountSchema = z
  .strictObject({
    name: displayName.optional(),
    type: accountType.optional(),
    isLiquid: z.boolean().optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: 'Provide at least one of: name, type, isLiquid',
  });

export type UpdateAccountInput = z.output<typeof updateAccountSchema>;
