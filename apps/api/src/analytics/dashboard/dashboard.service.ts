import { Injectable } from '@nestjs/common';
import { type AccountType, Prisma, type TransactionType } from '../../generated/prisma/client';
import { PrismaService } from '../../platform/database/prisma.service';
import { type MonthRange, monthRange } from './month';

/** How many of the month's transactions the summary lists. */
export const RECENT_TRANSACTIONS = 8;

/** The base currency of every account and amount in v1 (ADR-0002). */
const CURRENCY = 'AMD';

export interface MonthTotals {
  income: bigint;
  expense: bigint;
  /** income − expense; may be negative. */
  net: bigint;
}

export interface DashboardSummary extends MonthTotals {
  month: string;
  currency: string;
  transactionCount: number;
  previous: MonthTotals;
  balance: {
    /** The active accounts' balance at the end of the month. */
    total: bigint;
    /** The same at the end of the previous month; null if none of them was open then. */
    previousMonthEnd: bigint | null;
    /** Active accounts that were open by the end of the month. */
    accountCount: number;
  };
  history: { month: string; income: bigint; expense: bigint }[];
  categories: {
    categoryId: string;
    name: string;
    parentName: string | null;
    amount: bigint;
    transactionCount: number;
  }[];
  daily: { date: string; income: bigint; expense: bigint }[];
  recentTransactions: {
    id: string;
    type: TransactionType;
    amount: bigint;
    currency: string;
    occurredOn: string;
    description: string | null;
    account: { id: string; name: string };
    category: { id: string; name: string; parentName: string | null };
  }[];
  accounts: {
    id: string;
    name: string;
    type: AccountType;
    currency: string;
    isLiquid: boolean;
    /** The current balance, as GET /accounts returns it. */
    balance: bigint;
  }[];
}

type Tx = Prisma.TransactionClient;

/**
 * Dashboard v1 (docs/02-requirements/dashboard-v1.md): one month of the
 * user's ledger, aggregated in PostgreSQL (ADR-0003).
 *
 * Every sum is taken over bigint and cast back to bigint, so an overflow
 * would be an error rather than a rounded number; the remaining arithmetic
 * here is bigint too. No query is unbounded in the browser's direction:
 * the client receives totals, never the rows behind them.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The five queries run in one read-only REPEATABLE READ transaction: they
   * all see the same snapshot, so a transaction saved meanwhile can't be in
   * one number and missing from another.
   */
  async summary(userId: string, month: string): Promise<DashboardSummary> {
    const range = monthRange(month);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const history = await monthlyTotals(tx, userId, range);
        const categories = await expenseByCategory(tx, userId, range);
        const daily = await dailyTotals(tx, userId, range);
        const recentTransactions = await recentInMonth(tx, userId, range);
        const accounts = await activeAccounts(tx, userId, range);

        const current = history.at(-1)!;
        const previous = history.at(-2)!;
        const openAtEnd = accounts.filter((account) => account.balanceAtEnd !== null);
        const openAtPreviousEnd = accounts.filter(
          (account) => account.balanceAtPreviousEnd !== null,
        );

        return {
          month,
          currency: CURRENCY,
          ...totals(current),
          transactionCount: current.count,
          previous: totals(previous),
          balance: {
            total: sum(openAtEnd.map((account) => account.balanceAtEnd!)),
            previousMonthEnd:
              openAtPreviousEnd.length > 0
                ? sum(openAtPreviousEnd.map((account) => account.balanceAtPreviousEnd!))
                : null,
            accountCount: openAtEnd.length,
          },
          history: history.map(({ month, income, expense }) => ({ month, income, expense })),
          categories,
          daily,
          recentTransactions,
          accounts: accounts.map(({ id, name, type, currency, isLiquid, balance }) => ({
            id,
            name,
            type,
            currency,
            isLiquid,
            balance,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

function totals(month: { income: bigint; expense: bigint }): MonthTotals {
  return { income: month.income, expense: month.expense, net: month.income - month.expense };
}

function sum(values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

/**
 * Income and expense of each month of the history window, oldest first, the
 * selected month last. Empty months come from generate_series with zeros.
 * Each month joins one range of transactions_user_id_occurred_on_id_idx.
 */
async function monthlyTotals(tx: Tx, userId: string, range: MonthRange) {
  const rows = await tx.$queryRaw<
    { month: string; income: bigint; expense: bigint; count: number }[]
  >`
    SELECT to_char(m.first_day, 'YYYY-MM') AS month,
           COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0)::bigint AS income,
           COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0)::bigint AS expense,
           COUNT(t.id)::int AS count
    FROM generate_series(${range.historyStart}::date, ${range.start}::date, interval '1 month')
         AS m(first_day)
    LEFT JOIN transactions t
      ON t.user_id = ${userId}::uuid
     AND t.occurred_on >= m.first_day::date
     AND t.occurred_on < (m.first_day + interval '1 month')::date
    GROUP BY m.first_day
    ORDER BY m.first_day`;
  return rows;
}

/** The month's expense per category, largest first; ties by name for a stable order. */
async function expenseByCategory(tx: Tx, userId: string, range: MonthRange) {
  const rows = await tx.$queryRaw<
    { id: string; name: string; parent_name: string | null; amount: bigint; count: number }[]
  >`
    SELECT c.id, c.name, p.name AS parent_name,
           SUM(t.amount)::bigint AS amount, COUNT(*)::int AS count
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    LEFT JOIN categories p ON p.id = c.parent_id
    WHERE t.user_id = ${userId}::uuid
      AND t.type = 'expense'
      AND t.occurred_on BETWEEN ${range.start}::date AND ${range.end}::date
    GROUP BY c.id, c.name, p.name
    ORDER BY amount DESC, c.name, c.id`;
  return rows.map((row) => ({
    categoryId: row.id,
    name: row.name,
    parentName: row.parent_name,
    amount: row.amount,
    transactionCount: row.count,
  }));
}

/** Income and expense of every day of the month, zeros included. */
async function dailyTotals(tx: Tx, userId: string, range: MonthRange) {
  return tx.$queryRaw<{ date: string; income: bigint; expense: bigint }[]>`
    SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
           COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0)::bigint AS income,
           COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0)::bigint AS expense
    FROM generate_series(${range.start}::date, ${range.end}::date, interval '1 day') AS d(day)
    LEFT JOIN transactions t
      ON t.user_id = ${userId}::uuid
     AND t.occurred_on = d.day::date
    GROUP BY d.day
    ORDER BY d.day`;
}

/** The month's latest transactions in the order of GET /transactions. */
async function recentInMonth(tx: Tx, userId: string, range: MonthRange) {
  const rows = await tx.$queryRaw<
    {
      id: string;
      type: TransactionType;
      amount: bigint;
      currency: string;
      occurred_on: string;
      description: string | null;
      account_id: string;
      account_name: string;
      category_id: string;
      category_name: string;
      parent_name: string | null;
    }[]
  >`
    SELECT t.id, t.type, t.amount, t.currency,
           to_char(t.occurred_on, 'YYYY-MM-DD') AS occurred_on, t.description,
           a.id AS account_id, a.name AS account_name,
           c.id AS category_id, c.name AS category_name, p.name AS parent_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN categories c ON c.id = t.category_id
    LEFT JOIN categories p ON p.id = c.parent_id
    WHERE t.user_id = ${userId}::uuid
      AND t.occurred_on BETWEEN ${range.start}::date AND ${range.end}::date
    ORDER BY t.occurred_on DESC, t.id DESC
    LIMIT ${RECENT_TRANSACTIONS}`;
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    amount: row.amount,
    currency: row.currency,
    occurredOn: row.occurred_on,
    description: row.description,
    account: { id: row.account_id, name: row.account_name },
    category: { id: row.category_id, name: row.category_name, parentName: row.parent_name },
  }));
}

/**
 * The active accounts with three balances each: now, at the end of the
 * month and at the end of the previous month. A balance at a date is the
 * opening balance plus the signed transactions dated up to it, or NULL if
 * the account was opened later (no transaction can precede the opening
 * date). The CASE names both types and has no ELSE, as in AccountsService:
 * transfers must be added deliberately when they arrive.
 */
async function activeAccounts(tx: Tx, userId: string, range: MonthRange) {
  const rows = await tx.$queryRaw<
    {
      id: string;
      name: string;
      type: AccountType;
      currency: string;
      is_liquid: boolean;
      balance: bigint;
      balance_at_end: bigint | null;
      balance_at_previous_end: bigint | null;
    }[]
  >`
    WITH signed AS (
      SELECT t.account_id, t.occurred_on,
             CASE t.type WHEN 'income' THEN t.amount WHEN 'expense' THEN -t.amount END AS amount
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.user_id = ${userId}::uuid AND a.user_id = ${userId}::uuid AND a.archived_at IS NULL
    )
    SELECT a.id, a.name, a.type, a.currency, a.is_liquid,
           (a.opening_balance + COALESCE(SUM(s.amount), 0))::bigint AS balance,
           CASE WHEN a.opening_date <= ${range.end}::date THEN
             (a.opening_balance
               + COALESCE(SUM(s.amount) FILTER (WHERE s.occurred_on <= ${range.end}::date), 0))::bigint
           END AS balance_at_end,
           CASE WHEN a.opening_date <= ${range.previousEnd}::date THEN
             (a.opening_balance
               + COALESCE(SUM(s.amount) FILTER (WHERE s.occurred_on <= ${range.previousEnd}::date), 0))::bigint
           END AS balance_at_previous_end
    FROM accounts a
    LEFT JOIN signed s ON s.account_id = a.id
    WHERE a.user_id = ${userId}::uuid AND a.archived_at IS NULL
    GROUP BY a.id
    ORDER BY a.id`;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    isLiquid: row.is_liquid,
    balance: row.balance,
    balanceAtEnd: row.balance_at_end,
    balanceAtPreviousEnd: row.balance_at_previous_end,
  }));
}
