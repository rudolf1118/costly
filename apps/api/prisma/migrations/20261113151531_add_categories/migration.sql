-- Categories (docs/02-requirements/ledger-categories.md). Prisma generated the
-- enums, table, indexes and foreign keys. The CHECKs, the unique index on active
-- names and the trigger that enforces the parent rules were added by hand,
-- because the Prisma schema cannot express them.

-- CreateEnum
CREATE TYPE "category_kind" AS ENUM ('income', 'expense');

-- CreateEnum
CREATE TYPE "category_nature" AS ENUM ('essential_fixed', 'essential_variable', 'discretionary');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "kind" "category_kind" NOT NULL,
    "nature" "category_nature",
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
    -- The same name rules as accounts: trimmed, 1-64 characters, no control
    -- characters, Unicode NFC (so the unique index compares like with like).
    CONSTRAINT "categories_name_check"
        CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 64 AND "name" !~ '[[:cntrl:]]'),
    CONSTRAINT "categories_name_nfc_check" CHECK ("name" IS NFC NORMALIZED),
    -- Expense categories have a nature; income categories never do.
    CONSTRAINT "categories_nature_check" CHECK (("kind" = 'expense') = ("nature" IS NOT NULL)),
    CONSTRAINT "categories_not_own_parent_check" CHECK ("parent_id" <> "id"),
    CONSTRAINT "categories_archived_after_creation_check"
        CHECK ("archived_at" IS NULL OR "archived_at" >= "created_at")
);

-- CreateIndex
-- Listing a user's categories in creation order (ids are time-ordered UUIDv7).
CREATE INDEX "categories_user_id_id_idx" ON "categories"("user_id", "id");

-- CreateIndex
-- Finding a category's subcategories, e.g. before archiving it.
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- Among active categories, a name is unique per owner, parent and kind,
-- ignoring case. NULLS NOT DISTINCT makes the system (user_id NULL) one owner
-- and the top level (parent_id NULL) one parent; with plain NULLs neither
-- would be unique. Archived categories don't hold on to their names.
CREATE UNIQUE INDEX "categories_active_name_key"
    ON "categories"("user_id", "parent_id", "kind", lower("name")) NULLS NOT DISTINCT
    WHERE "archived_at" IS NULL;

-- AddForeignKey
-- RESTRICT: categories will carry transaction history.
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules that span two rows, which a CHECK cannot express:
--   * depth <= 2: a parent must itself be top-level;
--   * a subcategory has its parent's kind;
--   * a parent is a system category or has the subcategory's owner, and a
--     system subcategory has a system parent;
--   * owner, parent and kind never change, so a transaction's classification
--     can't shift under it, and the checks above stay true once made.
-- Whether the parent is active is an application rule: it needs row locks
-- (see the requirements document, Concurrency).
CREATE FUNCTION "categories_enforce_parent_rules"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    parent RECORD;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.user_id IS DISTINCT FROM OLD.user_id
           OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
           OR NEW.kind <> OLD.kind THEN
            RAISE EXCEPTION 'a category''s owner, parent and kind cannot change'
                USING ERRCODE = 'check_violation', CONSTRAINT = 'categories_immutable_check';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT p.user_id, p.parent_id, p.kind INTO parent FROM categories p WHERE p.id = NEW.parent_id;
    IF NOT FOUND THEN
        RETURN NEW; -- categories_parent_id_fkey reports it
    END IF;
    IF parent.parent_id IS NOT NULL THEN
        RAISE EXCEPTION 'a category''s parent must be a top-level category'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'categories_depth_check';
    END IF;
    IF parent.kind <> NEW.kind THEN
        RAISE EXCEPTION 'a category must have its parent''s kind'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'categories_parent_kind_check';
    END IF;
    IF parent.user_id IS NOT NULL AND parent.user_id IS DISTINCT FROM NEW.user_id THEN
        RAISE EXCEPTION 'a category''s parent must be a system category or have the same owner'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'categories_parent_owner_check';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "categories_parent_rules"
    BEFORE INSERT OR UPDATE OF "user_id", "parent_id", "kind" ON "categories"
    FOR EACH ROW EXECUTE FUNCTION "categories_enforce_parent_rules"();
