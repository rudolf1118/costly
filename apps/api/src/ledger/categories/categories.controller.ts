import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
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
  type CreateCategoryInput,
  createCategorySchema,
  type ListCategoriesQuery,
  listCategoriesQuerySchema,
  type UpdateCategoryInput,
  updateCategorySchema,
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

  /** 201 with the category and its Location; 400 for an invalid body or parent; 409 if the name is taken or the parent archived. */
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategoryInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CategoryResponse> {
    const category = await this.categories.create(user.id, body);
    response.location(`/categories/${category.id}`);
    return toCategoryResponse(category);
  }

  /** Renames or changes the nature. 403 for a system category, 404 as above, 409 if archived or the name is taken. */
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param(new ZodValidationPipe(categoryParamsSchema)) params: CategoryParams,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategoryInput,
  ): Promise<CategoryResponse> {
    return toCategoryResponse(await this.categories.update(user.id, params.id, body));
  }
}
