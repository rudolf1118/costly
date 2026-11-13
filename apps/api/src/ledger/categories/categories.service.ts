import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Category, type CategoryKind, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../platform/database/prisma.service';
import { RequestValidationException } from '../../platform/http/zod-validation.pipe';
import { isRecordNotFound, isUniqueViolation } from '../prisma-errors';
import {
  type CreateCategoryInput,
  INCOME_HAS_NO_NATURE,
  type ListCategoriesQuery,
  type UpdateCategoryInput,
} from './category.schemas';

/** The columns the parent and lifecycle checks read, from a locking raw query. */
interface LockedCategory {
  id: string;
  user_id: string | null;
  parent_id: string | null;
  kind: CategoryKind;
  archived_at: Date | null;
  created_at: Date;
}

/**
 * Categories: the shared system categories (user_id NULL) and each user's
 * own. A user sees both and can change only their own; another user's
 * category looks exactly like a missing one
 * (docs/02-requirements/ledger-categories.md).
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * System categories first, in seed order, then the user's own in creation
   * order: system ids are UUIDv7-shaped with a zero timestamp.
   */
  list(userId: string, query: ListCategoriesQuery): Promise<Category[]> {
    const archived = {
      active: { archivedAt: null },
      archived: { archivedAt: { not: null } },
      all: {},
    }[query.status];
    return this.prisma.category.findMany({
      where: { OR: [{ userId: null }, { userId }], kind: query.kind, ...archived },
      orderBy: { id: 'asc' },
    });
  }

  /** A system category or the user's own, else 404. */
  async get(userId: string, id: string): Promise<Category> {
    const category = await this.prisma.category.findFirst({
      where: { id, OR: [{ userId: null }, { userId }] },
    });
    if (!category) throw categoryNotFound();
    return category;
  }

  /**
   * A top-level category is inserted directly. A subcategory is inserted in
   * a transaction that first locks its parent FOR SHARE and checks it: the
   * parent can't be archived (which locks it FOR UPDATE) until this commits.
   * The trigger on the table enforces the same depth, kind and owner rules.
   */
  async create(userId: string, input: CreateCategoryInput): Promise<Category> {
    const data = {
      userId,
      name: input.name,
      kind: input.kind,
      nature: input.nature ?? null,
      parentId: input.parentId ?? null,
    };
    try {
      if (!data.parentId) return await this.prisma.category.create({ data });
      const parentId = data.parentId;
      return await this.prisma.$transaction(async (tx) => {
        const parent = await lockCategory(tx, parentId, { visibleTo: userId, mode: 'FOR SHARE' });
        if (!parent) {
          throw fieldError('parentId', 'Must be one of your categories or a system category');
        }
        if (parent.parent_id) throw fieldError('parentId', 'Must be a top-level category');
        if (parent.kind !== data.kind) {
          throw fieldError('kind', `Must match the parent category's kind (${parent.kind})`);
        }
        if (parent.archived_at) throw new ConflictException('The parent category is archived.');
        return tx.category.create({ data });
      });
    } catch (error) {
      throw nameConflictOr(error);
    }
  }

  /**
   * Renames or changes the nature of the user's own active category. The
   * kind can't change, so reading it first is safe; the conditional UPDATE
   * then matches only while the category is still active.
   */
  async update(userId: string, id: string, patch: UpdateCategoryInput): Promise<Category> {
    const category = await this.getOwn(userId, id);
    if (category.archivedAt) throw archivedConflict();
    if (patch.nature !== undefined && category.kind === 'income') {
      throw fieldError('nature', INCOME_HAS_NO_NATURE);
    }
    try {
      return await this.prisma.category.update({
        where: { id, userId, archivedAt: null },
        data: patch,
      });
    } catch (error) {
      // Archived by a concurrent request since the read.
      if (isRecordNotFound(error)) throw archivedConflict();
      throw nameConflictOr(error);
    }
  }

  /** The user's own category: 404 if not visible, 403 if it's a system category. */
  private async getOwn(userId: string, id: string): Promise<Category> {
    const category = await this.get(userId, id);
    if (category.userId === null) throw systemCategoryForbidden();
    return category;
  }
}

/**
 * Reads and row-locks one category inside a transaction. With visibleTo, only
 * a system category or that user's own matches; with ownedBy, only that
 * user's own. The lock mode is one of two constants, never input.
 */
async function lockCategory(
  tx: Prisma.TransactionClient,
  id: string,
  scope: { visibleTo: string; mode: 'FOR SHARE' } | { ownedBy: string; mode: 'FOR UPDATE' },
): Promise<LockedCategory | undefined> {
  const owner =
    'visibleTo' in scope
      ? Prisma.sql`(user_id IS NULL OR user_id = ${scope.visibleTo}::uuid)`
      : Prisma.sql`user_id = ${scope.ownedBy}::uuid`;
  const rows = await tx.$queryRaw<LockedCategory[]>`
    SELECT id, user_id, parent_id, kind::text AS kind, archived_at, created_at
    FROM categories
    WHERE id = ${id}::uuid AND ${owner}
    ${Prisma.raw(scope.mode)}`;
  return rows[0];
}

export function categoryNotFound(): NotFoundException {
  return new NotFoundException('Category not found.');
}

function systemCategoryForbidden(): ForbiddenException {
  return new ForbiddenException("System categories can't be changed.");
}

function archivedConflict(): ConflictException {
  return new ConflictException('The category is archived. Restore it before changing it.');
}

/** A 400 on one field, in the same shape as a failed request validation. */
function fieldError(path: string, message: string): RequestValidationException {
  return new RequestValidationException([{ path, message }]);
}

/**
 * The partial unique index on active (user_id, parent_id, kind, lower(name))
 * is the authority on names, so concurrent requests can't create duplicates.
 */
function nameConflictOr(error: unknown): unknown {
  return isUniqueViolation(error, 'categories_active_name_key')
    ? new ConflictException('An active category with this name already exists here.')
    : error;
}
