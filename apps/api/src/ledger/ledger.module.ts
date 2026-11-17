import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { DatabaseModule } from '../platform/database/database.module';
import { AccountsController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';

/**
 * Ledger: where money lives and how it moves. Accounts and categories for
 * now; transactions, transfers and merchants arrive in later tasks. It depends on
 * identity only for AccessTokenGuard (ADR-0001: dependencies point one way).
 */
@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [AccountsController, CategoriesController],
  providers: [AccountsService, CategoriesService],
})
export class LedgerModule {}
