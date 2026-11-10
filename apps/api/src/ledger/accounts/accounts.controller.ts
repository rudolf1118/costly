import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AccessTokenGuard,
  type AuthenticatedUser,
  CurrentUser,
} from '../../identity/access-token.guard';
import { ZodValidationPipe } from '../../platform/http/zod-validation.pipe';
import { type AccountResponse, toAccountResponse } from './account.response';
import {
  type AccountParams,
  accountParamsSchema,
  type CreateAccountInput,
  createAccountSchema,
  type ListAccountsQuery,
  listAccountsQuerySchema,
  type UpdateAccountInput,
  updateAccountSchema,
} from './account.schemas';
import { AccountsService } from './accounts.service';

/** The owner is always the authenticated user; requests cannot name one. */
@Controller('accounts')
@UseGuards(AccessTokenGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  /** 201 with the account and its Location; 400 for an invalid body; 409 if the name is taken. */
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createAccountSchema)) body: CreateAccountInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccountResponse> {
    const account = await this.accounts.create(user.id, body);
    response.location(`/accounts/${account.id}`);
    return toAccountResponse(account);
  }

  /** The user's accounts: active ones by default, or ?status=archived|all. */
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listAccountsQuerySchema)) query: ListAccountsQuery,
  ): Promise<{ items: AccountResponse[] }> {
    const accounts = await this.accounts.list(user.id, query);
    return { items: accounts.map(toAccountResponse) };
  }

  /** The account, or 404 if it doesn't exist or belongs to someone else. */
  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param(new ZodValidationPipe(accountParamsSchema)) params: AccountParams,
  ): Promise<AccountResponse> {
    return toAccountResponse(await this.accounts.get(user.id, params.id));
  }

  /** Changes name, type or isLiquid. 404 as above; 409 if archived or the name is taken. */
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param(new ZodValidationPipe(accountParamsSchema)) params: AccountParams,
    @Body(new ZodValidationPipe(updateAccountSchema)) body: UpdateAccountInput,
  ): Promise<AccountResponse> {
    return toAccountResponse(await this.accounts.update(user.id, params.id, body));
  }

  /** Archives the account; repeating it changes nothing. 404 as above. */
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param(new ZodValidationPipe(accountParamsSchema)) params: AccountParams,
  ): Promise<AccountResponse> {
    return toAccountResponse(await this.accounts.archive(user.id, params.id));
  }

  /** Makes an archived account active again. 404 as above; 409 if the name is taken. */
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param(new ZodValidationPipe(accountParamsSchema)) params: AccountParams,
  ): Promise<AccountResponse> {
    return toAccountResponse(await this.accounts.restore(user.id, params.id));
  }
}
