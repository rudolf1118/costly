-- First Costly migration: the users table (identity).
-- Prisma generated the table and the unique index. The extension and the CHECK
-- constraints were added by hand because the Prisma schema cannot express them.

-- Case-insensitive text for e-mail addresses. Prisma maps @db.Citext to this type
-- but does not create the extension, so a fresh database needs it here.
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "base_currency" CHAR(3) NOT NULL DEFAULT 'AMD',
    "timezone" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    -- One "@" with something on both sides, no whitespace anywhere, and at most
    -- 254 characters (the longest address SMTP accepts). Full validation is the
    -- application's job; this only keeps obviously broken values out.
    CONSTRAINT "users_email_format_check"
        CHECK ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND char_length("email") <= 254),
    CONSTRAINT "users_password_hash_not_empty_check" CHECK ("password_hash" <> ''),
    -- An ISO 4217 code: three upper-case letters.
    CONSTRAINT "users_base_currency_format_check" CHECK ("base_currency" ~ '^[A-Z]{3}$'),
    -- The IANA name itself is validated by the application; PostgreSQL cannot
    -- check it against pg_timezone_names inside a CHECK constraint.
    CONSTRAINT "users_timezone_not_empty_check" CHECK ("timezone" <> '')
);

-- CreateIndex
-- citext makes this unique index case-insensitive: Anna@Example.com and
-- anna@example.com cannot both exist.
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
