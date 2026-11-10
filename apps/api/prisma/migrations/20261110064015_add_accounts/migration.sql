-- Financial accounts, the first ledger table (docs/02-requirements/ledger-accounts.md).
-- Prisma generated the enum, table, index and foreign key. The CHECK constraints
-- and the partial unique index on active names were added by hand because the
-- Prisma schema cannot express them. There is deliberately no balance column:
-- balances are derived from opening_balance and the ledger.

-- CreateEnum
CREATE TYPE "account_type" AS ENUM ('checking', 'cash', 'savings', 'credit_card');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "account_type" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "is_liquid" BOOLEAN NOT NULL,
    "opening_balance" BIGINT NOT NULL,
    "opening_date" DATE NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id"),
    -- Trimmed, 1-64 characters, no control characters.
    CONSTRAINT "accounts_name_check"
        CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 64 AND "name" !~ '[[:cntrl:]]'),
    -- ISO 4217 shape. Which currencies are allowed (AMD in v1) is an application rule.
    CONSTRAINT "accounts_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    -- Minor units (ADR-0002). The bound is below 2^53; see the requirements document.
    CONSTRAINT "accounts_opening_balance_range_check"
        CHECK ("opening_balance" BETWEEN -999999999999999 AND 999999999999999),
    CONSTRAINT "accounts_opening_date_check" CHECK ("opening_date" >= DATE '1900-01-01'),
    CONSTRAINT "accounts_archived_after_creation_check"
        CHECK ("archived_at" IS NULL OR "archived_at" >= "created_at")
);

-- CreateIndex
-- Listing a user's accounts in creation order (ids are time-ordered UUIDv7).
CREATE INDEX "accounts_user_id_id_idx" ON "accounts"("user_id", "id");

-- A name is unique among a user's active accounts, ignoring case. Archived
-- accounts don't hold on to their names.
CREATE UNIQUE INDEX "accounts_active_name_key"
    ON "accounts"("user_id", lower("name"))
    WHERE "archived_at" IS NULL;

-- AddForeignKey
-- RESTRICT (the default): accounts carry financial history, so a user who owns
-- accounts cannot be deleted by accident.
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
