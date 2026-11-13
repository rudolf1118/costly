-- System categories: shared by every user, owned by no one (user_id NULL).
-- See docs/02-requirements/ledger-categories.md, Seeding.
--
-- The ids are fixed so a system category has the same id in every database.
-- They are UUIDv7-shaped with a zero timestamp, so they sort before every real
-- UUIDv7 and ordering by id lists them first, in this order. A migration runs
-- once per database, so these rows are inserted exactly once; later changes
-- to the set go into a new migration, never into this one.
--
-- 5 income and 12 expense top-level categories, 19 subcategories.
-- Parents come before their subcategories, which the parent trigger needs.

INSERT INTO "categories" ("id", "parent_id", "name", "kind", "nature") VALUES
    ('00000000-0000-7000-8000-000000000001', NULL, 'Salary', 'income', NULL),
    ('00000000-0000-7000-8000-000000000002', NULL, 'Freelance', 'income', NULL),
    ('00000000-0000-7000-8000-000000000003', NULL, 'Investments', 'income', NULL),
    ('00000000-0000-7000-8000-000000000004', NULL, 'Gifts', 'income', NULL),
    ('00000000-0000-7000-8000-000000000005', NULL, 'Other income', 'income', NULL),
    ('00000000-0000-7000-8000-000000000006', NULL, 'Housing', 'expense', 'essential_fixed'),
    ('00000000-0000-7000-8000-000000000007', '00000000-0000-7000-8000-000000000006', 'Rent', 'expense', 'essential_fixed'),
    ('00000000-0000-7000-8000-000000000008', '00000000-0000-7000-8000-000000000006', 'Utilities', 'expense', 'essential_fixed'),
    ('00000000-0000-7000-8000-000000000009', '00000000-0000-7000-8000-000000000006', 'Internet & phone', 'expense', 'essential_fixed'),
    ('00000000-0000-7000-8000-00000000000a', NULL, 'Food', 'expense', 'essential_variable'),
    ('00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-00000000000a', 'Groceries', 'expense', 'essential_variable'),
    ('00000000-0000-7000-8000-00000000000c', '00000000-0000-7000-8000-00000000000a', 'Restaurants', 'expense', 'discretionary'),
    ('00000000-0000-7000-8000-00000000000d', '00000000-0000-7000-8000-00000000000a', 'Food delivery', 'expense', 'discretionary'),
    ('00000000-0000-7000-8000-00000000000e', NULL, 'Transport', 'expense', 'essential_variable'),
    ('00000000-0000-7000-8000-00000000000f', '00000000-0000-7000-8000-00000000000e', 'Public transport', 'expense', 'essential_variable'),
    ('00000000-0000-7000-8000-000000000010', '00000000-0000-7000-8000-00000000000e', 'Taxi', 'expense', 'discretionary'),
    ('00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-00000000000e', 'Fuel', 'expense', 'essential_variable'),
    ('00000000-0000-7000-8000-000000000012', NULL, 'Health', 'expense', 'essential_variable'),
    ('00000000-0000-7000-8000-000000000013', '00000000-0000-7000-8000-000000000012', 'Pharmacy', 'expense', 'essential_variable'),
    ('00000000-0000-7000-8000-000000000014', '00000000-0000-7000-8000-000000000012', 'Doctors', 'expense', 'essential_variable'),
    ('00000000-0000-7000-8000-000000000015', NULL, 'Loan payments', 'expense', 'essential_fixed'),
    ('00000000-0000-7000-8000-000000000016', NULL, 'Education', 'expense', 'essential_variable'),
    ('00000000-0000-7000-8000-000000000017', '00000000-0000-7000-8000-000000000016', 'Courses', 'expense', 'essential_variable'),
    ('00000000-0000-7000-8000-000000000018', '00000000-0000-7000-8000-000000000016', 'Books', 'expense', 'discretionary'),
    ('00000000-0000-7000-8000-000000000019', NULL, 'Shopping', 'expense', 'discretionary'),
    ('00000000-0000-7000-8000-00000000001a', '00000000-0000-7000-8000-000000000019', 'Clothing', 'expense', 'discretionary'),
    ('00000000-0000-7000-8000-00000000001b', '00000000-0000-7000-8000-000000000019', 'Electronics', 'expense', 'discretionary'),
    ('00000000-0000-7000-8000-00000000001c', '00000000-0000-7000-8000-000000000019', 'Household', 'expense', 'essential_variable'),
    ('00000000-0000-7000-8000-00000000001d', NULL, 'Entertainment', 'expense', 'discretionary'),
    ('00000000-0000-7000-8000-00000000001e', '00000000-0000-7000-8000-00000000001d', 'Streaming', 'expense', 'discretionary'),
    ('00000000-0000-7000-8000-00000000001f', '00000000-0000-7000-8000-00000000001d', 'Events', 'expense', 'discretionary'),
    ('00000000-0000-7000-8000-000000000020', '00000000-0000-7000-8000-00000000001d', 'Hobbies', 'expense', 'discretionary'),
    ('00000000-0000-7000-8000-000000000021', NULL, 'Personal care', 'expense', 'essential_variable'),
    ('00000000-0000-7000-8000-000000000022', NULL, 'Travel', 'expense', 'discretionary'),
    ('00000000-0000-7000-8000-000000000023', NULL, 'Gifts & donations', 'expense', 'discretionary'),
    ('00000000-0000-7000-8000-000000000024', NULL, 'Other expense', 'expense', 'discretionary');
