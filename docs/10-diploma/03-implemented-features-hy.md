# 03 — Costly․ իրականացված հնարավորություններ և ստուգման ապացույցներ

> Ստուգված՝ 2026-11-19, Asia/Yerevan։ Code snapshot՝ `248edd60e8429934391d8d2d49fd11eaf778aded`։ «Իրականացված» նշանակում է, որ համապատասխան code path-ը առկա է ստուգված `main`-ում։ Դա ինքնին չի նշանակում production deployment կամ այս աշխատանքի ընթացքում նոր runtime test։

## 1. PR-ների հաստատված վիճակը

GitHub-ի բոլոր PR-ների ցանկը ստուգվել է անմիջականորեն։ #1–#14 և #16-ը merged են, #15-ը open է։ Ստորև ամսաթվերը տրված են **Երևանի ժամանակով**, ոչ UTC-ով։

| PR | Բովանդակություն | Վիճակ | Merge-ի ամսաթիվ |
|---|---|---|---|
| [#1](https://github.com/rudolf1118/costly/pull/1) | Prisma infrastructure | Merged | 2026-11-06 |
| [#2](https://github.com/rudolf1118/costly/pull/2) | User model և migration | Merged | 2026-11-06 |
| [#3](https://github.com/rudolf1118/costly/pull/3) | Secure registration | Merged | 2026-11-06 |
| [#4](https://github.com/rudolf1118/costly/pull/4) | Authentication և refresh sessions | Merged | 2026-11-10 |
| [#5](https://github.com/rudolf1118/costly/pull/5) | Financial accounts API | Merged | 2026-11-10 |
| [#6](https://github.com/rudolf1118/costly/pull/6) | Categories API | Merged | 2026-11-17 |
| [#7](https://github.com/rudolf1118/costly/pull/7) | Web architecture ADR | Merged՝ փաստաթուղթ | 2026-11-17 |
| [#8](https://github.com/rudolf1118/costly/pull/8) | Native mobile proposal | Merged՝ փաստաթուղթ, ADR-ը Proposed է | 2026-11-17 |
| [#9](https://github.com/rudolf1118/costly/pull/9) | Shared money codec և problem details | Merged | 2026-11-17 |
| [#10](https://github.com/rudolf1118/costly/pull/10) | Category audit fixes | Merged | 2026-11-17 |
| [#11](https://github.com/rudolf1118/costly/pull/11) | Design tokens, themes, base UI | Merged | 2026-11-17 |
| [#12](https://github.com/rudolf1118/costly/pull/12) | Routing, responsive shell, toasts | Merged | 2026-11-17 |
| [#13](https://github.com/rudolf1118/costly/pull/13) | Web registration, login, sessions | Merged | 2026-11-17 |
| [#14](https://github.com/rudolf1118/costly/pull/14) | Accounts web UI | Merged | 2026-11-18 |
| [#15](https://github.com/rudolf1118/costly/pull/15) | Progress log, running instructions, review demo | **Open, չմիացված** | — |
| [#16](https://github.com/rudolf1118/costly/pull/16) | Transactions MVP և derived balances | **Merged** | **2026-11-19** |

#16-ի `merged_at = 2026-11-18T21:50:02Z`՝ Երևանում նոյեմբերի 19-ի 01:50:02։ Merge SHA՝ `248edd60e8429934391d8d2d49fd11eaf778aded`։ #15-ի ուսումնասիրված head-ը՝ `fa8bde644d1cf87172e1b80ee02fdaf8089b191c`։ Դրա demo-ի՝ «transactions/current balance դեռ չկա» հատվածը հնացել է #16-ից հետո և չի օգտագործվել որպես ընթացիկ վիճակի ապացույց։

## 2. Հնարավորությունների մատրիցա

| Հնարավորություն | Backend / database | Web | Սահմանափակում |
|---|---|---|---|
| Registration և login | Առկա | Առկա | Password recovery կամ email verification այս ստուգված ծավալի մաս չեն |
| Refresh և logout | Rotation, token family, reuse handling, rate limits | Session restore, sign-out | Access token-ը մնում է վավեր մինչև expiry |
| Accounts | Create/list/read/update/archive/restore | Նույն հիմնական հոսքերը | Opening balance/date-ը խմբագրման սովորական դաշտեր չեն |
| Categories | System/custom, երկու մակարդակ, nature, archive/restore | Կարդացվում և ընտրվում են forms-ում | Կառավարման առանձին էջ չկա |
| Income/expense | CRUD, owner isolation, validation | Add/edit/delete և list | Transfer type չկա |
| Filters | Account/category/type/date | URL-ում պահվող filters | Parent category filter-ը children չի ներառում |
| Pagination | Keyset cursor, default 50, max 100 | «Show more» | Առանձին requests-ի միջև snapshot չէ |
| Current account balance | Opening + income − expense | Accounts և account details | Historical balance endpoint կամ ընդհանուր net worth չկա |
| Themes և responsive shell | — | Առկա | Responsive web-ը native mobile չէ |
| Overview / dashboard | Ֆինանսական summary endpoint չկա այս ծավալում | Empty state | Analytics կամ ցուցադրական թվեր չկան |

## 3. Transactions MVP-ի contract-ը

Transaction-ը ունի `type`, `accountId`, `categoryId`, `amount`, `occurredOn` և optional `description`։ Owner-ը ստացվում է authenticated user-ից, currency-ն՝ account-ից։ Դրանք request body-ում ուղարկելը մերժվում է։

```json
{
  "type": "expense",
  "accountId": "<սեփական-active-account-ի-UUID>",
  "categoryId": "<expense-category-ի-UUID>",
  "amount": "1850050",
  "occurredOn": "2026-11-19",
  "description": "Մթերք"
}
```

Սա contract-ի օրինակ է․ placeholder-ները պետք է փոխարինել իրական UUID-ներով։ `"1850050"`-ը նշանակում է **18,500.50 AMD**, ոչ 1,850,050 դրամ։

| Endpoint | Արդյունք |
|---|---|
| `POST /transactions` | `201`, transaction և `Location` header |
| `GET /transactions` | `200`, `{items, nextCursor}` |
| `GET /transactions/:id` | `200`, կամ `404`՝ բացակայող/այլ owner-ի row-ի համար |
| `PATCH /transactions/:id` | `200`, նոր վիճակ․ դատարկ patch-ը չի ընդունվում |
| `DELETE /transactions/:id` | `204`, hard delete |

Filters՝ `accountId`, `categoryId`, `type`, `from`, `to`, ինչպես նաև `limit` և `cursor`։ Date range-ի երկու սահմաններն էլ inclusive են։ `from > to`-ն invalid է։

## 4. Իրականացված invariants

- `amount`-ը դրական integer minor units է՝ `1..999999999999999`։ Zero, negative կամ JSON number input-ը չի ընդունվում։
- Transaction-ը կապված է իր owner-ի և նույն currency-ի account-ի հետ՝ composite foreign key-ով։
- Category-ն system կամ սեփական է և համապատասխանում է income/expense type-ին։
- Date-ը իրական օր է, ոչ շուտ account opening date-ից։ Ապագա ամսաթվի API սահմանը today in UTC+14-ն է։
- Description-ը optional է, առավելագույնը 255 Unicode code points՝ normalization/trim և control-character checks-ով։
- Archived account-ի transaction-ները մնում են ընթեռնելի և հաշվարկվում են balance-ում, բայց create/edit/move/delete գործողությունները արգելված են։
- Archived category-ն չի նշանակվում նորից, բայց արդեն օգտագործվող category-ն կարող է պահպանվել խմբագրման ժամանակ։
- Transaction-ի ջնջումը hard delete է։ Account/category archive-ը պահպանում է պատմությունը․ այս երկու lifecycle-ները տարբեր են։

### Ինչու է balance-ը վստահելի

Մնացորդի երկրորդ, առանձին պահվող պատճեն չկա։ Account read-ի ժամանակ service-ը գումարում է տվյալ account-ի income/expense rows-ը և ավելացնում opening balance-ը։ Edit/delete-ից հետո հաջորդ read-ը արտացոլում է նոր ledger-ը։ PostgreSQL-ի `SUM(bigint)`-ը exact numeric արդյունք է տալիս, որը query-ում cast է արվում `bigint`-ի, իսկ service-ը աշխատում է JavaScript `bigint`-ով։ Չափազանց մեծ aggregate-ի overflow-ը error է, ոչ լուռ rounding։

### Ինչու են պետք locks

Active account-ը ստուգելն ու հետո insert անելը առանց lock-ի կարող է մրցակցել archive-ի հետ։ `FOR SHARE`-ը դրանք կարգավորում է նույն database transaction-ի սահմաններում։ Սա concurrency correctness-ի կոնկրետ լուծում է, ոչ ընդհանուր «ցանկացած race condition բացակայում է» պնդում։

## 5. Թեստերի և CI-ի ապացույցները

[CI workflow](../../.github/workflows/ci.yml)-ը նախատեսում է `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`։ #16-ի head SHA-ի երկու `verify` check-երը ստուգման պահին `completed/success` են․ [run 44403905594](https://github.com/rudolf1118/costly/actions/runs/44403905594/job/135153890871), [run 44403851068](https://github.com/rudolf1118/costly/actions/runs/44403851068/job/135153700954)։

| Կոդի ապացույց | Ինչն է ստուգելու համար նախատեսված |
|---|---|
| [transactions.schema.spec.ts](../../apps/api/test/transactions.schema.spec.ts) | CHECK, foreign key, trigger՝ իրական PostgreSQL-ում |
| [transactions.e2e.spec.ts](../../apps/api/test/transactions.e2e.spec.ts) | CRUD, ownership, validation, filters, pagination, balance և deterministic lock interleavings |
| [accounts.schema.spec.ts](../../apps/api/test/accounts.schema.spec.ts) | Accounts-ի database constraints |
| [refresh-races.e2e.spec.ts](../../apps/api/test/refresh-races.e2e.spec.ts) | Refresh/logout concurrency |
| [shared transactions tests](../../packages/shared/src/transactions.spec.ts) և [accounts tests](../../packages/shared/src/accounts.spec.ts) | Response contracts, money/balance representation |
| [TransactionsPage tests](../../apps/web/src/features/transactions/TransactionsPage.spec.tsx) | List, filters, paging և UI states |
| [TransactionFormDialog tests](../../apps/web/src/features/transactions/TransactionFormDialog.spec.tsx) | Form validation, edit flow և accessibility assertions |

PR #16-ի հեղինակի verification report-ը նշում է API 640, web 211, shared 154, design-tokens 89 թեստ։ Դրանք **PR-ի հաղորդած պատմական թվերն են**, ոչ այս փաստաթղթային աշխատանքի նոր test run-ի հաշվարկը։ Նույն կերպ PR-ում նշված browser smoke test-ը և 375 px ստուգումը նախկին verification-ի հաղորդում են։ Կոդի ու check metadata-ի ուսումնասիրությունը չպետք է ներկայացնել որպես նոր ձեռքով գործարկված demo։

## 6. Ինչը դեռ չկա

**Հաստատված ապագա աշխատանք․** transfers, merchants, recurring rules/materialization, import, dashboard totals, budgets/goals, analytics, anomalies, forecasts, simulations, insights, monthly reports, deterministic persona generator և հետազոտական փորձեր։

**Ապագա տեխնիկական հիմք․** worker role, BullMQ jobs, recompute markers և `packages/finance-math`։

**Optional կամ Proposed․** AI explanations՝ optional, native mobile՝ Proposed ADR, Armenian UI՝ optional։ Ոչ մեկը այս Markdown նյութերով չի համարվում իրականացված։

## 7. Հաջորդ վերանայման ժամանակ ինչպես թարմացնել այս փաստաթուղթը

1. Գրանցել ստուգվող commit SHA-ն և իրական ամսաթիվը։
2. PR state-ից բացի ստուգել `merged_at` և `merge_commit_sha`․ `closed`-ը ինքնին merged չէ։
3. Կարդալ relevant schema/service/routes/tests-ը, ոչ միայն PR title-ը։
4. UI, API և միայն design/documentation մակարդակները տարբերակել։
5. Նոր test run-ի արդյունքը նշել առանձին՝ command, revision և արդյունք։
6. Արդիականացնել demo-ի թվերն ու limitations-ը, եթե behavior-ը փոխվել է։

Հաջորդ նյութերը՝ [մաթեմատիկական մեթոդներ](04-mathematical-methods-hy.md) և [պաշտպանություն](05-defense-preparation-hy.md)։
