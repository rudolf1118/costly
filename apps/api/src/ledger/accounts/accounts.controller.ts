import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  AccessTokenGuard,
  type AuthenticatedUser,
  CurrentUser,
} from '../../identity/access-token.guard';
import { ZodValidationPipe } from '../../platform/http/zod-validation.pipe';
import { type AccountResponse, toAccountResponse } from './account.response';
import {
  type CreateAccountInput,
  createAccountSchema,
  type ListAccountsQuery,
  listAccountsQuerySchema,
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
}
