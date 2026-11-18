import {
  Body,
  Controller,
  Delete,
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
import { type TransactionResponse, toTransactionResponse } from './transaction.response';
import {
  type CreateTransactionInput,
  createTransactionSchema,
  type ListTransactionsQuery,
  listTransactionsQuerySchema,
  type TransactionParams,
  transactionParamsSchema,
  type UpdateTransactionInput,
  updateTransactionSchema,
} from './transaction.schemas';
import { TransactionsService } from './transactions.service';

/** The owner is always the authenticated user; requests cannot name one. */
@Controller('transactions')
@UseGuards(AccessTokenGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  /** 201 with the transaction and its Location; 400 for invalid fields; 409 if archived. */
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTransactionSchema)) body: CreateTransactionInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TransactionResponse> {
    const transaction = await this.transactions.create(user.id, body);
    response.location(`/transactions/${transaction.id}`);
    return toTransactionResponse(transaction);
  }

  /** One page, newest first, with optional filters; nextCursor is null on the last page. */
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listTransactionsQuerySchema)) query: ListTransactionsQuery,
  ): Promise<{ items: TransactionResponse[]; nextCursor: string | null }> {
    const page = await this.transactions.list(user.id, query);
    return { items: page.items.map(toTransactionResponse), nextCursor: page.nextCursor };
  }

  /** The transaction, or 404 if it doesn't exist or belongs to someone else. */
  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param(new ZodValidationPipe(transactionParamsSchema)) params: TransactionParams,
  ): Promise<TransactionResponse> {
    return toTransactionResponse(await this.transactions.get(user.id, params.id));
  }

  /** Changes any field. 400 for invalid fields; 404 as above; 409 if archived. */
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param(new ZodValidationPipe(transactionParamsSchema)) params: TransactionParams,
    @Body(new ZodValidationPipe(updateTransactionSchema)) body: UpdateTransactionInput,
  ): Promise<TransactionResponse> {
    return toTransactionResponse(await this.transactions.update(user.id, params.id, body));
  }

  /** Deletes for good. 404 as above; 409 if its account is archived. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param(new ZodValidationPipe(transactionParamsSchema)) params: TransactionParams,
  ): Promise<void> {
    await this.transactions.delete(user.id, params.id);
  }
}
