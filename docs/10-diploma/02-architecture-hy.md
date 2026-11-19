# 02 — Costly․ համակարգի ճարտարապետություն

> Փաստացի կոդ՝ `248edd60e8429934391d8d2d49fd11eaf778aded`, ստուգում՝ 2026-11-19։ «Ապագա» նշումով տարրերը նախագծային որոշումներ են և ընթացիկ runtime-ի մաս չեն։

## Ընդհանուր կառուցվածք

Costly-ն TypeScript monorepo է՝ pnpm workspaces-ով։ Backend-ը NestJS **modular monolith** է․ մեկ application և ընդհանուր PostgreSQL database, ներսում՝ պատասխանատվությունների բաժանում։ Այս ընտրությունը թույլ է տալիս ֆինանսական տվյալների կապակցված փոփոխությունները կատարել մեկ database transaction-ում՝ առանց distributed system-ի լրացուցիչ բարդության։

Ընթացիկ իրական հոսքը հետևյալն է․

```text
Browser: React + Vite
  ├─ TanStack Router / Query, React Hook Form, zod
  └─ packages/shared + packages/design-tokens
                 │ HTTP / JSON
                 ▼
NestJS API: Platform + Identity + Ledger
  ├─ Prisma / parameterized SQL ──► PostgreSQL 18
  └─ rate limiting / health ──────► Redis 8
```

Frontend-ը և API-ն հիմա գործարկվում են host-ում։ Docker Compose-ը բարձրացնում է միայն PostgreSQL-ը և Redis-ը։ «Ամբողջ համակարգը մեկ docker compose հրամանով է աշխատում» պնդումը դեռ ճիշտ չէ։

## Repository-ի քարտեզը

| Ուղի | Իրական պատասխանատվություն |
|---|---|
| `apps/api/src/identity` | Registration, authentication, access-token guard, refresh sessions |
| `apps/api/src/ledger` | Accounts, categories, transactions, ֆինանսական կանոններ |
| `apps/api/src/platform` | Configuration, Prisma, Redis, HTTP errors, validation, logging, health, rate limits |
| `apps/api/prisma` | Schema և SQL migrations, այդ թվում՝ ձեռքով ավելացված constraints/triggers |
| `apps/web/src` | Pages, routing, auth session, UI, accounts և transactions features |
| `packages/shared` | Money codec, API client, response contracts, problem details |
| `packages/design-tokens` | Գույներ, չափումներ, typography և ընդհանուր visual tokens |
| `docs` | Planning, requirements, ADRs, database և diploma materials |

`AppModule`-ը ներմուծում է միայն `PlatformModule`, `IdentityModule`, `LedgerModule`։ `packages/finance-math`, worker runtime և analytics/forecasting modules այս revision-ում չկան։

## Տեխնոլոգիաների դերերը

**NestJS**-ը կազմակերպում է controllers, services, dependency injection և guards։ **Prisma**-ն սպասարկում է persistence-ը և migrations-ը։ Այն կանոնները, որոնք Prisma schema-ն ամբողջությամբ չի արտահայտում, ավելացվում են SQL migration-ում։ Parameterized raw SQL-ն արդեն օգտագործվում է, օրինակ, row locks-ի և account balance aggregation-ի համար։ Սա երկրորդ ORM չէ։

**React + Vite**-ը web client-ն է։ **TanStack Router**-ը կառավարում է routes և URL filters-ը, **TanStack Query**-ն՝ server state-ը, mutations-ից հետո invalidation/refetch-ը։ **React Hook Form** և **zod**-ը աջակցում են input validation-ին։ **Tailwind**, **Radix primitives** և design tokens-ը ձևավորում են UI-ի հիմքը։

**Redis**-ը հիմա կիրառվում է rate limiting-ի և health checks-ի համար։ **BullMQ**-ն ընտրված է ապագա jobs-ի համար, բայց API-ի dependency list-ում և runtime-ում դեռ իրականացված չէ։ Redis-ի առկայությունը չի ապացուցում, որ queues-ն արդեն աշխատում են։

## Տվյալների ընթացիկ մոդելը

| Model / table | Գլխավոր դաշտեր և կապեր |
|---|---|
| `User` / `users` | UUID, unique `citext` email, Argon2id password hash, base currency, timezone |
| `RefreshToken` / `refresh_tokens` | User, token hash, session family, expiry, rotation/revocation timestamps |
| `Account` / `accounts` | Owner, name, type, currency, liquidity, opening balance/date, archive timestamp |
| `Category` / `categories` | Optional owner, optional parent, kind, nature, archive timestamp |
| `Transaction` / `transactions` | Owner, account, category, type, amount, currency, occurred date, description |

```text
User 1 ── N Account 1 ── N Transaction N ── 1 Category
User 1 ── N RefreshToken
User 1 ── N սեփական Category
Category 1 ── N child Category     (առավելագույնը 2 մակարդակ)
System Category: user_id = NULL  (ընդհանուր հասանելի դասակարգիչ)
```

System category-ն չի պատկանում մեկ օգտատիրոջ։ Transaction-ը կարող է օգտագործել system կամ սեփական category, բայց չի կարող կապված լինել այլ օգտատիրոջ custom category-ի հետ։ Category-ի `kind`-ը պետք է համընկնի transaction-ի `type`-ի հետ։

## Գումար և ամսաթիվ

Գումարը database-ում `bigint` minor units է։ AMD-ի համար codec-ը օգտագործում է երկու տասնորդական նիշ՝ `18,500.50 AMD ↔ 1850050` minor units։ JSON-ում այն decimal string է՝ `"1850050"`, քանի որ սովորական JSON number/JavaScript number-ը մեծ ամբողջ թվերի համար կարող է կորցնել ճշտությունը։ Browser-ը parse/format է անում `bigint`-ով։

Գործարքի `amount`-ը դրական է՝ `1..999999999999999` minor units։ Նշանը ստացվում է `income` կամ `expense` տեսակից։ Opening balance-ը կարող է լինել բացասական։ Account balance-ը չի պահվում առանձին սյունակում․ այն ստացվում է opening balance-ից և ledger-ից։

`occurred_on` և `opening_date` դաշտերը PostgreSQL `DATE` են, իսկ տեխնիկական timestamps-ը՝ `TIMESTAMPTZ`։ API-ն ընդունում է `YYYY-MM-DD`։ Վերին սահմանի ստուգումը կիրառում է «այսօրվա ամենաուշ ամսաթիվը»՝ UTC+14, որպեսզի տարբեր timezone-ների օգտատերերի այսօրվա ամսաթիվը չմերժվի։ Սա դեռ անհատական timezone-ով analytics engine չէ։

## Գործարքի ստեղծման end-to-end հոսքը

1. User-ը UI-ում ընտրում է active account և համապատասխան category, գրում գումարն ու ամսաթիվը։
2. Web form-ը կատարում է նախնական validation և գումարը փոխակերպում exact minor-unit string-ի։
3. HTTP request-ը հասնում է `POST /transactions`։ `AccessTokenGuard`-ը հաստատում է identity-ն։
4. `ZodValidationPipe`-ը ստուգում է request-ի կառուցվածքը։ `userId`-ը և `currency`-ն body-ից չեն ընդունվում։
5. Service-ը բացում է database transaction, owner-ով գտնում և `FOR SHARE`-ով կողպում է հաշիվն ու նշանակվող կատեգորիան։
6. Ստուգվում են active վիճակը, type/kind համապատասխանությունը և opening date-ը։ Ստեղծվում է row, ապա կատարվում commit։
7. Database-ի foreign keys, CHECK-երը և trigger-ը պաշտպանում են իրենց վերապահված invariants-ը։
8. API-ն վերադարձնում է `201`, նոր transaction-ը և `Location` header։ UI-ն թարմացնում է transaction և account queries-ը։ Հաջորդ account read-ը վերահաշվարկում է մնացորդը։

Client validation-ը UX-ի համար է։ Իրավասության և տվյալների ճշտության վերջնական հսկողությունը backend-ում ու database-ում է։

## Consistency և concurrency

| Կանոն | Պաշտպանության շերտ |
|---|---|
| Գումարը դրական է և թույլատրելի միջակայքում | API validation և SQL CHECK |
| Account-ը նույն owner-ին է պատկանում, currency-ն նույնն է | Composite FK `(account_id, user_id, currency)` |
| Category-ն հասանելի է owner-ին և ճիշտ kind ունի | Service validation և `transactions_rules` trigger |
| Transaction-ը account opening date-ից շուտ չէ | Service validation և trigger |
| Archived account-ը read-only է | Service և transaction-ի ներսում row locks |
| Նշանակվող category-ն active է | Service և row locks |
| User-ի transaction-ի owner-ը չի փոխվում | Trigger |

Archive-ը row update է և սպասում է `FOR SHARE` lock-ին։ Այդպիսով active-check-ի և insert-ի միջև archive չի կարող աննկատ միջամտել։ Update/delete-ը transaction row-ի վրա կիրառում է `FOR UPDATE`։ Նախկինում նշանակված, հետո archived category-ն կարող է մնալ transaction-ի վրա, բայց նոր նշանակվող category-ն պետք է active լինի։

Բոլոր կանոնները միայն database-ում չեն․ օրինակ՝ active վիճակի ստուգումը application rule է։ Database-ին ուղղակի հասանելիությամբ ցանկացած գրառում API-ի ամբողջ business policy-ն ավտոմատ չի ժառանգում։

## Ընթերցում և pagination

Transactions-ը դասավորվում են `occurred_on DESC, id DESC`։ Cursor-ը վերջին row-ի ամսաթիվն ու UUID-ն է՝ base64url encoding-ով։ Հաջորդ էջը վերցնում է այդ զույգից փոքր արժեքները։ Default page size-ը 50 է, առավելագույնը՝ 100։

Keyset pagination-ը խուսափում է offset-ի տեղաշարժից, երբ նախկին էջերի տողերն ավելացվում կամ ջնջվում են։ Այն, սակայն, snapshot isolation չի ապահովում առանձին HTTP requests-ի միջև․ concurrent date edit-ը կարող է փոխել row-ի դիրքը։ Cursor encoding-ը encryption կամ authorization չէ․ տվյալների մեկուսացումը ապահովում է ամեն query-ի `userId` պայմանը։

Index-ները սպասարկում են user/date ordering-ը, category/date filter-ը և account/date queries-ը։ Դրանց առկայությունը դեռ performance SLA-ի ապացույց չէ. չափումները նախատեսված են E6-ում։

## Authentication և HTTP պայմանագրեր

Password-ը պահվում է Argon2id hash-ով։ Access token-ը JWT է՝ 15 րոպե lifetime-ով, web client-ում՝ memory-ում։ Refresh credential-ը փոխանցվում է `HttpOnly`, `SameSite=Strict`, `/auth` path-ով cookie-ով, իսկ production-ում՝ նաև `Secure`։ Database-ում պահվում է դրա hash-ը, ոչ սկզբնական token-ը։ Refresh session-ը ունի rotation և առավելագույնը 30 օրվա absolute lifetime։

Logout-ը դադարեցնում է refresh session-ը։ Արդեն տրված access token-ը կարող է գործել մինչև իր 15 րոպեանոց ժամկետի ավարտը, քանի որ ամեն request-ի համար session database lookup չի կատարվում։ Սա գիտակցված սահմանափակում է, ոչ ակնթարթային բոլոր token-ների revocation։

Սխալները ունեն RFC 9457 problem details ձև։ Invalid input-ը՝ `400`, չհաստատված access-ը՝ `401`, անհասանելի transaction-ը՝ `404`, archived resource conflict-ը՝ `409`։ Այլ user-ի transaction-ը և գոյություն չունեցող transaction-ը նույն `404` են տալիս։ Body-ում անհասանելի account/category reference-ը field error է՝ `400`։

## Ապագա ճարտարապետություն

Նախագծով նույն codebase-ը կունենա API և worker runtime roles։ Հետագա modules-ը՝ recurring, import, planning, analytics, forecasting, simulation, insights և optional assistant։ Module boundaries-ը և միակողմանի dependencies-ը ճարտարապետական կանոն են. այստեղ ամբողջ ապագա graph-ի իրականացված կամ ավտոմատ ստուգված լինելու պնդում չկա։

Pure mathematics-ը պետք է տեղափոխվի `packages/finance-math`՝ առանց NestJS/Prisma dependency-ի։ BullMQ jobs-ը կզբաղվեն import-ով, recurring materialization-ով, snapshots-ով և recalculation-ով։ Սովորական CRUD-ը և what-if simulation-ը նախատեսվում են synchronous։ Recompute markers, deduplication և idempotency-ը ապագա իրականացման/փորձարկման պահանջներ են։

## Աղբյուրներ

- [AppModule](../../apps/api/src/app.module.ts), [Prisma schema](../../apps/api/prisma/schema.prisma), [Docker Compose](../../docker-compose.yml)։
- [Transactions service](../../apps/api/src/ledger/transactions/transactions.service.ts), [migration](../../apps/api/prisma/migrations/20261119090000_add_transactions/migration.sql), [accounts service](../../apps/api/src/ledger/accounts/accounts.service.ts)։
- [Web router](../../apps/web/src/app/router.tsx), [money codec](../../packages/shared/src/money.ts), [session constants](../../apps/api/src/identity/auth.constants.ts)։
- [ADR-0001](../03-architecture/adr/0001-modular-monolith.md), [ADR-0002](../03-architecture/adr/0002-money-as-bigint-minor-units.md), [ADR-0003](../03-architecture/adr/0003-prisma-with-raw-sql-for-analytics.md), [ADR-0004](../03-architecture/adr/0004-bullmq-over-rabbitmq.md), [ADR-0010](../03-architecture/adr/0010-web-client-architecture.md)։
- Հաջորդ նյութը՝ [իրականացված հնարավորություններ](03-implemented-features-hy.md)։
