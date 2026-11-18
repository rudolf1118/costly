-- Income and expense transactions (docs/02-requirements/ledger-transactions.md).
-- Prisma generated the enum, table, indexes, the unique key on accounts and the
-- foreign keys. The CHECKs and the trigger that enforces the rules spanning two
-- tables were added by hand, because the Prisma schema cannot express them.
-- There is deliberately no balance column anywhere: a balance is a sum over
-- these rows.

-- CreateEnum
-- Transfers add 'transfer_out' and 'transfer_in' when they arrive.
CREATE TYPE "transaction_type" AS ENUM ('income', 'expense');

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "type" "transaction_type" NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "occurred_on" DATE NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id"),
    -- Minor units (ADR-0002), always positive: the type gives the direction.
    -- The upper bound is the accounts' bound, below 2^53.
    CONSTRAINT "transactions_amount_range_check" CHECK ("amount" BETWEEN 1 AND 999999999999999),
    CONSTRAINT "transactions_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "transactions_occurred_on_check" CHECK ("occurred_on" >= DATE '1900-01-01'),
    -- Optional; when present, trimmed, 1-255 characters, NFC, no control characters.
    CONSTRAINT "transactions_description_check"
        CHECK ("description" IS NULL OR (
            "description" = btrim("description")
            AND char_length("description") BETWEEN 1 AND 255
            AND "description" !~ '[[:cntrl:]]'
            AND "description" IS NFC NORMALIZED))
);

-- CreateIndex
-- The list, newest first ((occurred_on, id) is the pagination key), and every
-- analytics date range.
CREATE INDEX "transactions_user_id_occurred_on_id_idx" ON "transactions"("user_id", "occurred_on" DESC, "id" DESC);

-- CreateIndex
-- Category analytics and the category filter.
CREATE INDEX "transactions_user_id_category_id_occurred_on_idx" ON "transactions"("user_id", "category_id", "occurred_on");

-- CreateIndex
-- Balances and the account filter.
CREATE INDEX "transactions_account_id_occurred_on_idx" ON "transactions"("account_id", "occurred_on");

-- CreateIndex
-- The target of the composite foreign key below. id alone is already unique;
-- this key exists so a transaction can reference its account together with
-- the account's owner and currency.
CREATE UNIQUE INDEX "accounts_id_user_id_currency_key" ON "accounts"("id", "user_id", "currency");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- One key, two guarantees: the account belongs to the transaction's owner, and
-- the transaction has the account's currency. RESTRICT on update as well:
-- an account's owner and currency never change.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_user_id_currency_fkey" FOREIGN KEY ("account_id", "user_id", "currency") REFERENCES "accounts"("id", "user_id", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
-- RESTRICT: categories are archived, never deleted, while transactions use them.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules that span two tables, which a CHECK cannot express:
--   * the category is a system category or the transaction owner's own;
--   * the category's kind equals the transaction's type;
--   * the transaction is not dated before its account's opening date;
--   * the owner never changes.
-- A category's owner and kind and an account's opening date never change
-- (categories_parent_rules and the API), so checking on this side is enough.
-- Whether the account and category are active is an application rule: it
-- needs row locks (see the requirements document, Concurrency).
CREATE FUNCTION "transactions_enforce_rules"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    category RECORD;
    opened DATE;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'a transaction''s owner cannot change'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'transactions_owner_immutable_check';
    END IF;

    SELECT c.user_id, c.kind INTO category FROM categories c WHERE c.id = NEW.category_id;
    IF FOUND THEN -- otherwise transactions_category_id_fkey reports it
        IF category.user_id IS NOT NULL AND category.user_id IS DISTINCT FROM NEW.user_id THEN
            RAISE EXCEPTION 'a transaction''s category must be a system category or its owner''s'
                USING ERRCODE = 'check_violation', CONSTRAINT = 'transactions_category_owner_check';
        END IF;
        IF category.kind::text <> NEW.type::text THEN
            RAISE EXCEPTION 'a transaction''s category must be of its type'
                USING ERRCODE = 'check_violation', CONSTRAINT = 'transactions_category_kind_check';
        END IF;
    END IF;

    SELECT a.opening_date INTO opened FROM accounts a WHERE a.id = NEW.account_id;
    IF FOUND AND NEW.occurred_on < opened THEN -- otherwise the foreign key reports it
        RAISE EXCEPTION 'a transaction cannot predate its account''s opening date'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'transactions_after_opening_check';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "transactions_rules"
    BEFORE INSERT OR UPDATE OF "user_id", "account_id", "category_id", "type", "occurred_on" ON "transactions"
    FOR EACH ROW EXECUTE FUNCTION "transactions_enforce_rules"();
