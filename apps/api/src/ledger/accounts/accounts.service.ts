import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type Account, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../platform/database/prisma.service';
import {
  type CreateAccountInput,
  DEFAULT_LIQUIDITY,
  type ListAccountsQuery,
  type UpdateAccountInput,
} from './account.schemas';

/**
 * Financial accounts. Every query carries the owner's id, taken by the caller
 * from the verified access token, so no request can reach another user's
 * account (docs/02-requirements/ledger-accounts.md).
 */
@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateAccountInput): Promise<Account> {
    try {
      return await this.prisma.account.create({
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
    } catch (error) {
      throw nameConflictOr(error);
    }
  }

  /** The user's accounts in creation order (ids are time-ordered UUIDv7). */
  list(userId: string, query: ListAccountsQuery): Promise<Account[]> {
    const archived = {
      active: { archivedAt: null },
      archived: { archivedAt: { not: null } },
      all: {},
    }[query.status];
    return this.prisma.account.findMany({ where: { userId, ...archived }, orderBy: { id: 'asc' } });
  }

  /** The user's account, or 404: a foreign account looks exactly like a missing one. */
  async get(userId: string, id: string): Promise<Account> {
    const account = await this.prisma.account.findFirst({ where: { id, userId } });
    if (!account) throw accountNotFound();
    return account;
  }

  /**
   * Changes name, type or isLiquid. One conditional UPDATE matches only the
   * user's active account, so a concurrent archive can never be overwritten
   * with an edit. If nothing matched, an owner-scoped read tells "doesn't
   * exist for you" (404) from "archived" (409).
   */
  async update(userId: string, id: string, patch: UpdateAccountInput): Promise<Account> {
    try {
      return await this.prisma.account.update({
        where: { id, userId, archivedAt: null },
        data: patch,
      });
    } catch (error) {
      if (isRecordNotFound(error)) {
        await this.get(userId, id);
        throw new ConflictException('The account is archived. Restore it before changing it.');
      }
      throw nameConflictOr(error);
    }
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
  async archive(userId: string, id: string): Promise<Account> {
    const account = await this.get(userId, id);
    if (account.archivedAt) return account;
    const now = new Date();
    try {
      return await this.prisma.account.update({
        where: { id, userId, archivedAt: null },
        data: { archivedAt: now > account.createdAt ? now : account.createdAt },
      });
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
  async restore(userId: string, id: string): Promise<Account> {
    try {
      return await this.prisma.account.update({
        where: { id, userId, archivedAt: { not: null } },
        data: { archivedAt: null },
      });
    } catch (error) {
      if (isRecordNotFound(error)) return this.get(userId, id);
      throw nameConflictOr(error);
    }
  }
}

export function accountNotFound(): NotFoundException {
  return new NotFoundException('Account not found.');
}

/** Prisma's P2025: the conditional update matched no row. */
export function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

/**
 * The partial unique index on (user_id, lower(name)) for active accounts is
 * the authority on names, so concurrent requests can't create duplicates.
 */
export function nameConflictOr(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (
      error.meta as
        { driverAdapterError?: { cause?: { constraint?: { index?: string } } } } | undefined
    )?.driverAdapterError?.cause?.constraint?.index === 'accounts_active_name_key'
  ) {
    return new ConflictException('An active account with this name already exists.');
  }
  return error;
}
