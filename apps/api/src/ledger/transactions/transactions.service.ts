import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CategoryKind,
  Prisma,
  type Transaction,
  type TransactionType,
} from '../../generated/prisma/client';
import { PrismaService } from '../../platform/database/prisma.service';
import { RequestValidationException } from '../../platform/http/zod-validation.pipe';
import { fromDateColumn, toDateColumn } from '../calendar-date';
import {
  type CreateTransactionInput,
  encodeCursor,
  type ListTransactionsQuery,
  type UpdateTransactionInput,
} from './transaction.schemas';

/** The columns the account checks read, from a locking raw query. */
interface LockedAccount {
  id: string;
  currency: string;
  opening_date: Date;
  archived_at: Date | null;
}

/** The columns the category checks read, from a locking raw query. */
interface LockedCategory {
  id: string;
  kind: CategoryKind;
  archived_at: Date | null;
}

/** The columns an edit needs from the transaction it locks. */
interface LockedTransaction {
  id: string;
  account_id: string;
  category_id: string;
  type: TransactionType;
  occurred_on: Date;
}

export interface TransactionPage {
  items: Transaction[];
  nextCursor: string | null;
}

/**
 * Income and expense transactions (docs/02-requirements/ledger-transactions.md).
 *
 * Every query carries the owner's id from the access token. Writes run in one
 * database transaction that locks the account, and a category being assigned,
 * FOR SHARE: an archive updates that row, so it waits for the write to commit
 * (or the write sees the archive). No balance is stored, so no write ever
 * reads, changes and writes back a balance.
 */
@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateTransactionInput): Promise<Transaction> {
    return this.prisma.$transaction(async (tx) => {
      const account = await lockAccount(tx, userId, input.accountId);
      const category = await lockCategory(tx, userId, input.categoryId);
      checkCategoryKind(category, input.type);
      checkAfterOpening(account, input.occurredOn);
      refuseArchivedAccount(account);
      refuseArchivedCategory(category);
      return tx.transaction.create({
        data: {
          userId,
          accountId: account.id,
          categoryId: category.id,
          type: input.type,
          amount: input.amount,
          currency: account.currency,
          occurredOn: toDateColumn(input.occurredOn),
          description: input.description ?? null,
        },
      });
    });
  }

  /**
   * One page of the user's transactions, newest first: by occurred_on, then
   * id, both descending. The id is unique, so the order is total, and the
   * next page starts strictly after the last row (keyset pagination): rows
   * added or deleted meanwhile never make another row repeat or disappear.
   */
  async list(userId: string, query: ListTransactionsQuery): Promise<TransactionPage> {
    const after = query.cursor
      ? {
          OR: [
            { occurredOn: { lt: toDateColumn(query.cursor.occurredOn) } },
            { occurredOn: toDateColumn(query.cursor.occurredOn), id: { lt: query.cursor.id } },
          ],
        }
      : {};
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        accountId: query.accountId,
        categoryId: query.categoryId,
        type: query.type,
        occurredOn: {
          gte: query.from ? toDateColumn(query.from) : undefined,
          lte: query.to ? toDateColumn(query.to) : undefined,
        },
        ...after,
      },
      orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
      // One more than a page tells whether there is a next one.
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ occurredOn: fromDateColumn(last.occurredOn), id: last.id })
          : null,
    };
  }

  /** The user's transaction, or 404: a foreign transaction looks exactly like a missing one. */
  async get(userId: string, id: string): Promise<Transaction> {
    const transaction = await this.prisma.transaction.findFirst({ where: { id, userId } });
    if (!transaction) throw transactionNotFound();
    return transaction;
  }

  /**
   * Changes any field. The transaction is locked FOR UPDATE first, so two
   * edits of it run one after the other. Its account must be active, and so
   * must the account it moves to. A category being assigned must be active;
   * one it already has stays valid even if archived since.
   */
  async update(userId: string, id: string, patch: UpdateTransactionInput): Promise<Transaction> {
    return this.prisma.$transaction(async (tx) => {
      const current = await lockTransaction(tx, userId, id);

      const account = await lockAccount(tx, userId, current.account_id, { owned: true });
      refuseArchivedAccount(account);
      let target = account;
      if (patch.accountId !== undefined && patch.accountId !== current.account_id) {
        target = await lockAccount(tx, userId, patch.accountId);
      }

      const type = patch.type ?? current.type;
      const categoryChanges =
        patch.categoryId !== undefined && patch.categoryId !== current.category_id;
      // A category's kind never changes, so the current one needs no lock.
      const category = categoryChanges
        ? await lockCategory(tx, userId, patch.categoryId!)
        : await readCategory(tx, current.category_id);
      checkCategoryKind(category, type);
      checkAfterOpening(target, patch.occurredOn ?? fromDateColumn(current.occurred_on));
      refuseArchivedAccount(target);
      if (categoryChanges) refuseArchivedCategory(category);

      return tx.transaction.update({
        where: { id: current.id },
        data: {
          type,
          accountId: target.id,
          categoryId: category.id,
          currency: target.currency,
          amount: patch.amount,
          occurredOn: patch.occurredOn ? toDateColumn(patch.occurredOn) : undefined,
          description: patch.description,
        },
      });
    });
  }

  /**
   * Deletes the transaction for good (technical design: the user's own ledger
   * is hard-deleted). Its account must be active: archived accounts are
   * read-only. The account row is locked FOR SHARE in the same statement.
   */
  async delete(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string; archived_at: Date | null }[]>`
        SELECT t.id, a.archived_at
        FROM transactions t JOIN accounts a ON a.id = t.account_id
        WHERE t.id = ${id}::uuid AND t.user_id = ${userId}::uuid
        FOR UPDATE OF t FOR SHARE OF a`;
      if (!row) throw transactionNotFound();
      if (row.archived_at) throw archivedAccountConflict();
      await tx.transaction.delete({ where: { id: row.id } });
    });
  }
}

export function transactionNotFound(): NotFoundException {
  return new NotFoundException('Transaction not found.');
}

/** A 400 on one field, in the same shape as a failed request validation. */
function fieldError(path: string, message: string): RequestValidationException {
  return new RequestValidationException([{ path, message }]);
}

function archivedAccountConflict(): ConflictException {
  return new ConflictException(
    'The account is archived. Restore it before changing its transactions.',
  );
}

/**
 * Locks the user's account FOR SHARE. One the user can't see is a 400 on
 * accountId, the same for a missing and a foreign account; with owned, the
 * account is known to be theirs (it holds their transaction).
 */
async function lockAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
  { owned = false }: { owned?: boolean } = {},
): Promise<LockedAccount> {
  const [account] = await tx.$queryRaw<LockedAccount[]>`
    SELECT id, currency, opening_date, archived_at
    FROM accounts
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
    FOR SHARE`;
  if (!account) {
    if (owned) throw new Error(`transaction account ${id} is not the owner's`);
    throw fieldError('accountId', 'Must be one of your accounts');
  }
  return account;
}

/**
 * Locks a category the user can see (a system one or their own) FOR SHARE.
 * Any other is a 400 on categoryId, the same for missing and foreign.
 */
async function lockCategory(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
): Promise<LockedCategory> {
  const [category] = await tx.$queryRaw<LockedCategory[]>`
    SELECT id, kind::text AS kind, archived_at
    FROM categories
    WHERE id = ${id}::uuid AND (user_id IS NULL OR user_id = ${userId}::uuid)
    FOR SHARE`;
  if (!category)
    throw fieldError('categoryId', 'Must be one of your categories or a system category');
  return category;
}

/** The category a transaction already has. The foreign key guarantees it exists. */
async function readCategory(tx: Prisma.TransactionClient, id: string): Promise<LockedCategory> {
  const category = await tx.category.findUniqueOrThrow({ where: { id } });
  return { id: category.id, kind: category.kind, archived_at: category.archivedAt };
}

async function lockTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
): Promise<LockedTransaction> {
  const [transaction] = await tx.$queryRaw<LockedTransaction[]>`
    SELECT id, account_id, category_id, type::text AS type, occurred_on
    FROM transactions
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
    FOR UPDATE`;
  if (!transaction) throw transactionNotFound();
  return transaction;
}

function checkCategoryKind(category: LockedCategory, type: TransactionType): void {
  if (category.kind !== type) {
    throw fieldError('categoryId', `Must be an ${type} category`);
  }
}

function checkAfterOpening(account: LockedAccount, occurredOn: string): void {
  const opened = fromDateColumn(account.opening_date);
  if (occurredOn < opened) {
    throw fieldError('occurredOn', `Must not be before the account's opening date (${opened})`);
  }
}

function refuseArchivedAccount(account: LockedAccount): void {
  if (account.archived_at) throw archivedAccountConflict();
}

function refuseArchivedCategory(category: LockedCategory): void {
  if (category.archived_at) {
    throw new ConflictException('The category is archived. Choose an active category.');
  }
}
