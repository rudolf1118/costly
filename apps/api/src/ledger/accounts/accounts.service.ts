import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Account } from '../../generated/prisma/client';
import { PrismaService } from '../../platform/database/prisma.service';
import { isRecordNotFound, isUniqueViolation } from '../prisma-errors';
import {
  type CreateAccountInput,
  DEFAULT_LIQUIDITY,
  type ListAccountsQuery,
  type UpdateAccountInput,
} from './account.schemas';

/**
 * An account with its current balance: the opening balance plus income minus
 * expenses over all its transactions (docs/02-requirements/ledger-transactions.md).
 */
export type AccountWithBalance = Account & { balance: bigint };

/**
 * Financial accounts. Every query carries the owner's id, taken by the caller
 * from the verified access token, so no request can reach another user's
 * account (docs/02-requirements/ledger-accounts.md).
 *
 * Every account is returned with its balance, computed from the ledger on
 * each read: there is no balance column to drift out of step with it.
 */
@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateAccountInput): Promise<AccountWithBalance> {
    try {
      const account = await this.prisma.account.create({
        data: {
          userId,
          name: input.name,
          type: input.type,
          currency: input.currency,
          isLiquid: input.isLiquid ?? DEFAULT_LIQUIDITY[input.type],
          openingBalance: input.openingBalance,
          openingDate: new Date(`${input.openingDate}T00:00:00Z`),
        },
      });
      // A new account has no transactions yet.
      return { ...account, balance: account.openingBalance };
    } catch (error) {
      throw nameConflictOr(error);
    }
  }

  /** The user's accounts in creation order (ids are time-ordered UUIDv7). */
  async list(userId: string, query: ListAccountsQuery): Promise<AccountWithBalance[]> {
    const archived = {
      active: { archivedAt: null },
      archived: { archivedAt: { not: null } },
      all: {},
    }[query.status];
    const accounts = await this.prisma.account.findMany({
      where: { userId, ...archived },
      orderBy: { id: 'asc' },
    });
    return this.withBalances(userId, accounts);
  }

  /** The user's account, or 404: a foreign account looks exactly like a missing one. */
  async get(userId: string, id: string): Promise<AccountWithBalance> {
    return this.withBalance(userId, await this.find(userId, id));
  }

  /**
   * Changes name, type or isLiquid. One conditional UPDATE matches only the
   * user's active account, so a concurrent archive can never be overwritten
   * with an edit. If nothing matched, an owner-scoped read tells "doesn't
   * exist for you" (404) from "archived" (409).
   */
  async update(userId: string, id: string, patch: UpdateAccountInput): Promise<AccountWithBalance> {
    let account: Account;
    try {
      account = await this.prisma.account.update({
        where: { id, userId, archivedAt: null },
        data: patch,
      });
    } catch (error) {
      if (isRecordNotFound(error)) {
        await this.find(userId, id);
        throw new ConflictException('The account is archived. Restore it before changing it.');
      }
      throw nameConflictOr(error);
    }
    return this.withBalance(userId, account);
  }

  /**
   * Archives the account: kept for history, read-only, listed only on request.
   * Idempotent: an archived account is returned unchanged.
   *
   * archived_at must not precede created_at (a CHECK), but the two can come
   * from different clocks: another API instance, or this host after NTP steps
   * its clock back. So archived_at is the later of now and created_at. The
   * conditional UPDATE still decides the race with a concurrent archive.
   */
  async archive(userId: string, id: string): Promise<AccountWithBalance> {
    const account = await this.find(userId, id);
    if (account.archivedAt) return this.withBalance(userId, account);
    const now = new Date();
    try {
      const archived = await this.prisma.account.update({
        where: { id, userId, archivedAt: null },
        data: { archivedAt: now > account.createdAt ? now : account.createdAt },
      });
      return await this.withBalance(userId, archived);
    } catch (error) {
      // Archived by a concurrent request since the read: return that result.
      if (isRecordNotFound(error)) return this.get(userId, id);
      throw error;
    }
  }

  /**
   * Makes an archived account active again. Idempotent for an active account;
   * 409 if an active account already has its name.
   */
  async restore(userId: string, id: string): Promise<AccountWithBalance> {
    let account: Account;
    try {
      account = await this.prisma.account.update({
        where: { id, userId, archivedAt: { not: null } },
        data: { archivedAt: null },
      });
    } catch (error) {
      if (isRecordNotFound(error)) return this.get(userId, id);
      throw nameConflictOr(error);
    }
    return this.withBalance(userId, account);
  }

  private async find(userId: string, id: string): Promise<Account> {
    const account = await this.prisma.account.findFirst({ where: { id, userId } });
    if (!account) throw accountNotFound();
    return account;
  }

  private async withBalance(userId: string, account: Account): Promise<AccountWithBalance> {
    const [withBalance] = await this.withBalances(userId, [account]);
    return withBalance!;
  }

  /**
   * Adds each account's current balance: opening balance + Σ income − Σ
   * expense over its transactions. PostgreSQL sums the bigint amounts into
   * an exact numeric and the cast back to bigint fails loudly rather than
   * round if it could ever overflow; the addition here is bigint too, so no
   * step goes through a floating-point number. One query for any number of
   * accounts, served by transactions_account_id_occurred_on_idx.
   *
   * The CASE names both types and has no ELSE: transfers, when they arrive,
   * must be added here deliberately rather than fall into either branch.
   */
  private async withBalances(userId: string, accounts: Account[]): Promise<AccountWithBalance[]> {
    if (accounts.length === 0) return [];
    const ids = accounts.map((account) => account.id);
    const rows = await this.prisma.$queryRaw<{ account_id: string; net: bigint }[]>`
      SELECT account_id,
             SUM(CASE type WHEN 'income' THEN amount WHEN 'expense' THEN -amount END)::bigint AS net
      FROM transactions
      WHERE user_id = ${userId}::uuid AND account_id = ANY(${ids}::uuid[])
      GROUP BY account_id`;
    const net = new Map(rows.map((row) => [row.account_id, row.net]));
    return accounts.map((account) => ({
      ...account,
      balance: account.openingBalance + (net.get(account.id) ?? 0n),
    }));
  }
}

export function accountNotFound(): NotFoundException {
  return new NotFoundException('Account not found.');
}

/**
 * The partial unique index on (user_id, lower(name)) for active accounts is
 * the authority on names, so concurrent requests can't create duplicates.
 */
function nameConflictOr(error: unknown): unknown {
  return isUniqueViolation(error, 'accounts_active_name_key')
    ? new ConflictException('An active account with this name already exists.')
    : error;
}
