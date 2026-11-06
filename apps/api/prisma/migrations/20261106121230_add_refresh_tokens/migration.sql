-- Refresh sessions (ADR-0006): one row per refresh credential, grouped into a
-- family per login session. Prisma generated the table, indexes and foreign
-- key. The CHECK constraints and the partial unique index were added by hand
-- because the Prisma schema cannot express them.

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL DEFAULT uuidv7(),
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "rotated_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id"),
    -- A lower-case SHA-256 hex digest, never the token itself.
    CONSTRAINT "refresh_tokens_token_hash_format_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "refresh_tokens_expires_after_creation_check" CHECK ("expires_at" > "created_at")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- At most one usable token per session. Rotation marks the old token rotated
-- before inserting its successor, so the database itself refuses a second
-- successful rotation of the same credential.
CREATE UNIQUE INDEX "refresh_tokens_one_active_per_family"
    ON "refresh_tokens"("family_id")
    WHERE "rotated_at" IS NULL AND "revoked_at" IS NULL;

-- AddForeignKey
-- CASCADE, not the default RESTRICT: a session means nothing without its
-- user, and holds no financial history worth keeping.
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
