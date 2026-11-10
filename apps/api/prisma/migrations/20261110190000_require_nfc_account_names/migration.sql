-- Account names are compared case-insensitively by accounts_active_name_key,
-- but a composed and a decomposed spelling of the same name ("Café" as
-- U+00E9 or as "e" + U+0301) are different strings to lower(). The API
-- normalizes names to NFC; this keeps any other writer to the same form, so
-- the unique index compares like with like.
ALTER TABLE "accounts"
    ADD CONSTRAINT "accounts_name_nfc_check" CHECK ("name" IS NFC NORMALIZED);
