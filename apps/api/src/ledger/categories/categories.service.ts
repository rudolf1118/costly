import { Injectable, NotFoundException } from '@nestjs/common';
import type { Category } from '../../generated/prisma/client';
import { PrismaService } from '../../platform/database/prisma.service';
import type { ListCategoriesQuery } from './category.schemas';

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
}

export function categoryNotFound(): NotFoundException {
  return new NotFoundException('Category not found.');
}
