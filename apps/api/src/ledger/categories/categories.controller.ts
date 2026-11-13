import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  AccessTokenGuard,
  type AuthenticatedUser,
  CurrentUser,
} from '../../identity/access-token.guard';
import { ZodValidationPipe } from '../../platform/http/zod-validation.pipe';
import { type CategoryResponse, toCategoryResponse } from './category.response';
import {
  type CategoryParams,
  categoryParamsSchema,
  type ListCategoriesQuery,
  listCategoriesQuerySchema,
} from './category.schemas';
import { CategoriesService } from './categories.service';

/** The user is always the authenticated one; requests cannot name an owner. */
@Controller('categories')
@UseGuards(AccessTokenGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** System categories and the user's own: active by default, ?kind and ?status filter. */
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listCategoriesQuerySchema)) query: ListCategoriesQuery,
  ): Promise<{ items: CategoryResponse[] }> {
    const categories = await this.categories.list(user.id, query);
    return { items: categories.map(toCategoryResponse) };
  }

  /** A system category or the user's own, or 404. */
  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param(new ZodValidationPipe(categoryParamsSchema)) params: CategoryParams,
  ): Promise<CategoryResponse> {
    return toCategoryResponse(await this.categories.get(user.id, params.id));
  }
}
