import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { DatabaseModule } from '../platform/database/database.module';
import { AccountsController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { TransactionsController } from './transactions/transactions.controller';
import { TransactionsService } from './transactions/transactions.service';

/**
 * Ledger: where money lives and how it moves. Accounts, categories and income
 * and expense transactions; transfers and merchants arrive in later tasks. It depends on
 * identity only for AccessTokenGuard (ADR-0001: dependencies point one way).
 */
@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [AccountsController, CategoriesController, TransactionsController],
  providers: [AccountsService, CategoriesService, TransactionsService],
})
export class LedgerModule {}
