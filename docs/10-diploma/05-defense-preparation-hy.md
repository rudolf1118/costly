# 05 — Costly․ առաջին ստուգման և պաշտպանության նախապատրաստում

> Նյութը համապատասխանում է 2026-11-19-ի `main` revision-ին՝ `248edd60e8429934391d8d2d49fd11eaf778aded`։ Սա **առաջին progress review-ի** նյութ է, ոչ ավարտված ամբողջ դիպլոմի մասին հայտարարություն։ Ցուցադրվող հնարավորությունները սահմանափակվում են իրական financial core-ով։

## 1. Առաջին ստուգման պատրաստ խոսք՝ մոտ 3–4 րոպե

Բարև ձեզ։ Իմ դիպլոմային աշխատանքի թեման է «Անձնական ֆինանսների կառավարման, վերլուծության և կանխատեսման համակարգի մշակում»։ Նախագիծը կոչվում է Costly։

Խնդիրը, որ ցանկանում եմ լուծել, միայն ծախսերի գրանցումը չէ։ Մարդը կարող է իմանալ, թե որքան է ծախսել, բայց չհասկանալ՝ արդյոք իր ընթացիկ վարքագծով կհասնի խնայողության նպատակին, կամ ինչպես կազդի նոր գնումը այդ նպատակի ժամկետի վրա։ Վերջնական համակարգը պետք է կապի ֆինանսական պատմությունը վերլուծության, կանխատեսման և չափելի որոշումների աջակցության հետ։

Առաջին փուլում կենտրոնացել եմ այդ շղթայի հիմքի՝ ճիշտ հաշվառման վրա։ Ներկայում պատրաստ են օգտատիրոջ գրանցումն ու մուտքը, ֆինանսական հաշիվների կառավարումը, կատեգորիաների backend-ը և եկամուտների ու ծախսերի ամբողջական հիմնական հոսքը։ Web client-ում կարող եմ ավելացնել գործարք, ֆիլտրել ցուցակը, խմբագրել կամ ջնջել այն և տեսնել հաշվի փոփոխված մնացորդը։ Transactions MVP-ի PR #16-ը միացվել է հիմնական ճյուղին, և դրա CI ստուգումները հաջող են։

Backend-ի համար ընտրել եմ NestJS modular monolith, տվյալների բազայի համար՝ PostgreSQL և Prisma, frontend-ի համար՝ React։ Monolith-ը թույլ է տալիս պահպանել modules-ի բաժանումը՝ առանց այս ծավալի համար ավելորդ distributed infrastructure-ի։ Redis-ն արդեն օգտագործվում է rate limiting-ի համար, իսկ background worker-ը և BullMQ jobs-ը հետագա քայլեր են։

Ֆինանսական ճշտության համար գումարները պահվում են ամբողջ թվերով՝ minor units-ով։ Օրինակ՝ 18,500.50 դրամը պահվում է 1,850,050 ամբողջ թվով։ API-ն այդ արժեքը փոխանցում է string-ով, որպեսզի client-ը չկորցնի ճշտությունը։ Մնացորդը առանձին սյունակում չեմ պահում․ այն հաշվարկվում է սկզբնական մնացորդից, եկամուտներից և ծախսերից։ Այդ պատճառով transaction-ի ուղղումը կամ ջնջումը արտացոլվում է հաջորդ ընթերցման ժամանակ։

Տվյալների ճշտությունը միայն form validation-ից կախված չէ։ Database-ում կան CHECK constraints, foreign keys և trigger։ Օրինակ՝ transaction-ը չի կարող կապված լինել ուրիշ օգտատիրոջ հաշվին կամ սխալ տեսակի կատեգորիայի հետ։ Concurrent archive-ի և transaction write-ի համար կիրառվում են row locks։ Թեստերում կան իրական PostgreSQL և Redis containers, ինչպես նաև հատուկ concurrency սցենարներ։

Այս պահին չեմ ներկայացնում analytics-ը կամ forecasting-ը որպես պատրաստ հնարավորություն։ Դրանց մեթոդները նախագծված են՝ միջին ու median baseline, anomaly detection, moving average, exponential smoothing և Holt։ Հետագայում դրանք կհամեմատեմ naive baseline-ի հետ rolling-origin backtesting-ով։ Նպատակը կանխատեսման սխալը չափելն է, ոչ նախապես բարձր ճշտություն խոստանալը։

Այսօրվա ցուցադրությամբ կներկայացնեմ registration-ից մինչև income/expense և balance փոփոխություն անցնող իրական հոսքը։ Հաջորդ աշխատանքներն են financial core-ի մնացած մասերը՝ transfers, recurring payments և dashboard, ապա՝ import ու analytics։ Ղեկավարի հետ ցանկանում եմ հատկապես քննարկել domain model-ի սահմանները, concurrency լուծումները և ապագա փորձերի գնահատման չափանիշները։

## 2. Կարճ տարբերակ՝ մոտ 30 վայրկյան

Costly-ն անձնական ֆինանսների կառավարման դիպլոմային նախագիծ է։ Արդեն պատրաստ են authentication-ը, հաշիվները, կատեգորիաների API-ն և income/expense Transactions MVP-ն՝ ընթացիկ մնացորդներով։ Գումարները exact integer minor units են, իսկ տվյալների ճշտությունը պաշտպանվում է API validation-ով և database constraints-ով։ Analytics, forecasting և what-if-ը հաջորդ փուլերի նպատակներն են։ Այսօր ցույց եմ տալիս իրական հաշվառման հոսքը և դրա տեխնիկական հիմնավորումը։

## 3. Demo-ից առաջ պատրաստվելը

Օգտագործել միայն ցուցադրական հաշիվ և կեղծ տվյալներ։ Ստորև հրամանները կատարվում են repository-ի root-ից։ Պահանջվում են Node.js 24+, repository-ի `packageManager`-ին համապատասխան pnpm 12.6.0 և աշխատող Docker։ Եթե Docker CLI-ն PATH-ում չկա, repository-ի աշխատանքային կանոններում նշված տեղը `/Applications/Docker.app/Contents/Resources/bin/docker` է։

### Առաջին տեղային գործարկում

Նախ պատճենել example environment ֆայլերը, եթե անձնական `.env`-եր դեռ չկան․ `cp -n`-ը չի վերագրում գոյություն ունեցող ֆայլը։

```bash
cp -n apps/api/.env.example apps/api/.env
cp -n apps/web/.env.example apps/web/.env
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:deploy
```

Երկու առանձին terminal-ում՝

```bash
pnpm --filter @costly/api dev
```

```bash
pnpm --filter @costly/web dev --port 5173 --strictPort
```

API՝ `http://localhost:3100`, web՝ `http://localhost:5173`։ `strictPort`-ը կանխում է Vite-ի աննկատ անցումը այլ port-ի։ Եթե 5173-ը զբաղված է, ընտրել այլ port և **նույն origin-ը** սահմանել API-ի `CORS_ORIGIN`-ում, ապա վերագործարկել API-ն։ Օրինակ՝ 5174-ի դեպքում `CORS_ORIGIN=http://localhost:5174`։ `VITE_API_URL`-ը պետք է շարունակի ցույց տալ API-ի իրական հասցեն։

```bash
curl -fsS http://localhost:3100/health
curl -fsS http://localhost:3100/health/live
```

Readiness-ում PostgreSQL և Redis-ը պետք է հասանելի լինեն։ Docker Compose-ը միայն infrastructure-ն է բարձրացնում․ API/web հրամանները պարտադիր են։ Գոյություն ունեցող database-ի համար migration-ը կիրառել `pnpm db:deploy`-ով․ demo-ի համար database-ը ջնջելու անհրաժեշտություն չկա։

Բացել երեք tab՝ web client, [PR #16](https://github.com/rudolf1118/costly/pull/16), այս փաստաթուղթը։ Rehearsal-ի համար ընտրել առանձին test user, որպեսզի ցուցադրման թվերը չխառնվեն նախորդ transaction-ներին։ Demo-ի ամսաթիվը պետք է լինի այսօր կամ անցյալում, account opening date-ից ոչ շուտ։

### Թեստերի առանձին ստուգում

Ամբողջ verification-ը՝

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Միայն transactions-ի թեստերը՝

```bash
pnpm --filter @costly/api exec vitest run test/transactions.schema.spec.ts test/transactions.e2e.spec.ts
pnpm --filter @costly/web exec vitest run src/features/transactions
```

API integration tests-ը պահանջում են Docker և ստեղծում են իրենց containers-ը։ Այս հրամանները վերարտադրության ուղեցույց են․ այս փաստաթղթերի հեղինակման ընթացքում նոր application test run չի կատարվել։

## 4. Ցուցադրման սցենար՝ մոտ 7 րոպե

Թվերը նույնն են, ինչ repository-ի Transactions demo-ում, որպեսզի արդյունքը հեշտ լինի ստուգել։ Օգտագործել AMD և երկու active account՝ **Card** ու **Cash**։

| Ժամանակ | Գործողություն | Ինչ ասել / սպասվող արդյունք |
|---|---|---|
| 0:00–0:45 | Գրանցվել կամ մուտք գործել test user-ով | Անձնական ledger, user isolation․ reload-ից հետո session restore |
| 0:45–1:30 | Accounts-ում ստեղծել Card՝ 250,000, Cash՝ 50,000 | Opening date՝ նախորդ ամսվա առաջին օրը․ current balance-ը դեռ հավասար է opening-ին |
| 1:30–2:00 | Income՝ 900,000, Salary, Card | Դրական եկամուտ, Card balance՝ 1,150,000 |
| 2:00–2:45 | Expense՝ 18,500.50, Food → Groceries, Card | Ճշգրիտ տասնորդական գումար․ Card՝ 1,131,499.50 |
| 2:45–3:15 | Expense՝ 4,500, Transport → Taxi, Cash | Cash՝ 45,500, description՝ «Taxi home» |
| 3:15–4:00 | Taxi-ն խմբագրել 5,000, Groceries-ը ջնջել հաստատումով | Cash՝ 45,000, Card՝ 1,150,000 |
| 4:00–4:45 | Ցույց տալ type/account/date filters-ը | Filters-ը URL-ում են․ parent category-ը children-ը ավտոմատ չի ներառում |
| 4:45–5:30 | Փորձել 0 amount և opening-ից վաղ date, ապա cancel | Validation-ը բացատրում է սխալը, invalid transaction չի ստեղծվում |
| 5:30–6:15 | Archive անել Cash-ը, ցույց տալ history-ն, ապա restore | History-ն և balance-ը մնում են, archived account-ի transactions-ը read-only են |
| 6:15–7:00 | Բացել #16 Checks-ը և architecture-ի հակիրճ քարտեզը | Merged MVP + անցած CI․ analytics/forecasting-ը դեռ ապագա են |

### Սպասվող balance-ների ստուգաթերթ

| Քայլ | Card, AMD | Cash, AMD |
|---|---:|---:|
| Հաշիվների ստեղծում | 250,000 | 50,000 |
| Salary | 1,150,000 | 50,000 |
| Groceries | 1,131,499.50 | 50,000 |
| Taxi | 1,131,499.50 | 45,500 |
| Taxi edit | 1,131,499.50 | 45,000 |
| Groceries delete | 1,150,000 | 45,000 |

Այս սցենարի երեք transaction-ները չեն լրացնում default 50-row էջը։ «Show more»-ը ցույց տալ միայն նախապես պատրաստված 50-ից ավելի matching transaction-ներով test account-ում։ Հակառակ դեպքում բացատրել pagination-ը կոդով/թեստով․ չսպասել չերևացող կոճակի և չհայտարարել, որ paging-ը live ցուցադրվել է։

Եթե ժամանակ կա, նեղացնել browser-ը և Settings-ում փոխել theme-ը։ Overview էջը չներկայացնել որպես analytics dashboard․ այն դեռ empty state է։

## 5. Եթե demo-ն խափանվում է

- **API չի բացվում․** ստուգել process-ը և 3100 port-ը, ապա `/health/live`։
- **Readiness error․** ստուգել Docker, PostgreSQL/Redis և environment ports-ը։
- **Login/cookie/CORS error․** համեմատել browser origin-ը `CORS_ORIGIN`-ի հետ, հատկապես եթե Vite-ը նախկինում աշխատել է 5174-ում։
- **Table missing․** ստուգել ճիշտ database URL-ը և կիրառել `pnpm db:deploy`։
- **Անսպասելի գումար․** ստուգել user-ը, account-ը և նախորդ demo rows-ը․ աղյուսակի թվերը ճիշտ են միայն նշված սկզբնական պայմաններում։
- **GitHub կամ ինտերնետ չկա․** ցույց տալ local source-ը, migrations-ը և test files-ը։ Նախապես պահված screenshot-ը ներկայացնել որպես նախորդ run-ի ապացույց, ոչ live result։

Եթե խնդիրը արագ չի լուծվում, ասել՝ «Այս պահին ցուցադրական միջավայրում այս քայլը չաշխատեց։ Ցույց կտամ համապատասխան implementation-ն ու նախկին ստուգման ապացույցը, ապա առանձին կվերարտադրեմ խնդիրը»։ Մի քանի րոպե լուռ debugging-ի փոխարեն շարունակել բովանդակային ներկայացումը։

## 6. Դասախոսի հավանական հարցերը և կարճ պատասխանները

| Հարց | Պատասխան |
|---|---|
| Ի՞նչ է պատրաստ հենց հիմա։ | Authentication, accounts, categories API, income/expense CRUD, filters, pagination և current account balances՝ web հոսքերով։ |
| PR #16-ը միացվա՞ծ է։ | Այո․ merge SHA-ն `248edd60…` է, merge-ը՝ 2026-11-19 01:50 Երևանի ժամանակով։ #15-ը դեռ open է։ |
| Ինչո՞ւ է README-ն ասում, որ transactions-ը հետո են։ | Այդ status հատվածը հնացած է։ Ընթացիկ վիճակը հաստատել եմ կոդով և PR metadata-ով։ |
| Ինչո՞վ է սա տարբերվելու expense tracker-ից։ | Նախատեսված տարբերությունը goals-ի հետ կապվող what-if և quantified recommendations-ն են։ Դրանք դեռ պատրաստ չեմ ներկայացնում։ |
| Որտե՞ղ է մաթեմատիկան այսօր։ | Exact money representation և balance aggregation։ Forecasting-ի հետազոտական մաթեմատիկան պլանավորված է հաջորդ փուլերի համար։ |
| Ինչո՞ւ bigint։ | Minor units-ի գումարումը ամբողջ թվերով ճշգրիտ է։ Float-ը կարող է rounding տալ, իսկ մեծ aggregates-ը գերազանցում են JavaScript safe integer-ը։ |
| Ինչո՞ւ amount-ը string է JSON-ում։ | JSON-ը bigint type չունի, իսկ number-ը կարող է կորցնել ճշտությունը։ String-ը client-ում parse է արվում bigint-ի։ |
| Ինչո՞ւ balance column չկա։ | Այն ledger-ից ստացվող տվյալ է։ Առանձին պատճեն պահելը պահանջում է ամեն write-ի ժամանակ synchronization։ Այժմ read-ի պահին հաշվարկը ավելի պարզ է։ |
| Դա դանդաղ չի՞ լինի։ | Կան համապատասխան indexes։ Մեծ dataset-ի performance-ը դեռ պետք է չափել E6-ով․ pre-aggregation կլինի միայն չափման հիմնավորմամբ։ |
| Ինչո՞ւ միայն frontend validation-ը բավարար չէ։ | Client request-ը կարելի է շրջանցել։ API-ն ստուգում է business rules-ը, database-ը՝ իր constraints-ը։ |
| Ինչո՞ւ FK-ն composite է։ | Միաժամանակ ստուգում է account identity-ն, owner-ը և currency-ն․ ուրիշ user-ի account reference-ը չի անցնում։ |
| Ինչո՞ւ trigger։ | Category ownership/kind և account opening date կանոնները կապվում են այլ rows-ի հետ և սովորական local CHECK-ով չեն արտահայտվում։ |
| Archive-ի ընթացքում transaction ավելացնելը վտանգավո՞ր է։ | Service-ը նույն database transaction-ում վերցնում է FOR SHARE lock։ Archive update-ը սպասում է, կամ write-ը տեսնում է archived վիճակը։ |
| Categories-ը ամբողջությամբ UI ունի՞։ | Ոչ․ API-ն կա, transaction forms-ը կարդում են categories-ը, բայց առանձին management screen չկա։ |
| Ջնջելիս պատմությունը պահպանվո՞ւմ է։ | Transaction delete-ը hard delete է։ Accounts/categories-ի archive-ը պահպանում է պատմությունը։ Audit journal կամ undo հիմա չկա։ |
| Credit card-ը վարկի մոդե՞լ է։ | Ոչ․ account type է՝ հնարավոր negative opening balance-ով։ Loan simulation-ը ապագա what-if model է։ |
| Ինչո՞ւ keyset pagination։ | Չի հենվում փոփոխվող row offset-ի վրա, օգտագործում է date+id դիրքը։ Բայց concurrent date edit-ի համար immutable snapshot չի խոստանում։ |
| Cursor-ը գաղտնագրվա՞ծ է։ | Ոչ․ base64url encoding է։ Security-ն ապահովում է authenticated user-ով query scope-ը։ |
| Single-user է, բայց users table ինչո՞ւ կա։ | Յուրաքանչյուր գրանցված անձ ունի իր անկախ ledger-ը․ household/shared finances չկան։ |
| Ինչո՞ւ modular monolith։ | Մի ուսանողի նախագծի համար պարզ deployment և transaction consistency՝ պահպանված domain boundaries-ով։ |
| Worker-ն արդեն աշխատո՞ւմ է։ | Ոչ․ Redis-ը հիմա ծառայում է rate limiting/health-ին։ BullMQ worker-ը նախատեսված է recurring/import/recompute աշխատանքի համար։ |
| Logout-ից հետո բոլոր tokens-ը անմիջապե՞ս անվավեր են։ | Refresh session-ը դադարում է, բայց access JWT-ն կարող է գործել մինչև 15 րոպե lifetime-ի ավարտը։ |
| Ինչո՞ւ ML չեք օգտագործում։ | Սկզբում կարճ ու sparse անձնական պատմության համար համեմատում եմ բացատրելի պարզ մեթոդներ։ Լավ արդյունքը պետք է հաստատել backtest-ով։ |
| Ինչպե՞ս եք չափելու forecast-ի որակը։ | Rolling-origin validation, MAE, հստակ scale-ով MASE, naive comparison և interval coverage/width։ |
| Եթե մեթոդը naive-ից վատ լինի՞։ | Դա նույնպես հետազոտական արդյունք է։ Կներկայացնեմ պայմաններն ու սխալները և կպահեմ ավելի լավ baseline-ը։ |
| Ի՞նչ կանեք քիչ տվյալների դեպքում։ | Data tiers-ը կսահմանափակի output-ը։ <14 օր դեպքում discretionary forecast չի ցուցադրվի։ Սա դեռ պլան է։ |
| Տվյալները որտեղի՞ց են լինելու։ | Fixed-seed synthetic personas և հնարավորության դեպքում անանունացված սեփական պատմություն։ Generator-ը և փորձերը դեռ պետք է իրականացնել։ |
| AI-ն հաշվարկե՞լու է գումարները։ | Ոչ․ optional AI-ն միայն բացատրելու է deterministic engines-ի հաշվարկած փաստերը։ |
| Native mobile արդեն կա՞։ | Ոչ․ ADR-0011-ը Proposed է։ Առկա է responsive web։ |
| Հայերեն տարբերակ կա՞։ | Այս փաստաթղթերը հայերեն են, UI-ի լիարժեք localization-ը դեռ իրականացված չէ։ |

## 7. Ինչ ապացույցներ ցույց տալ

- PR #16-ի merged state-ը և վերջին head-ի successful CI checks-ը։
- [Transaction migration](../../apps/api/prisma/migrations/20261119090000_add_transactions/migration.sql)՝ FK, CHECK, trigger։
- [Transactions service](../../apps/api/src/ledger/transactions/transactions.service.ts)՝ owner scope և locks։
- [Transactions e2e tests](../../apps/api/test/transactions.e2e.spec.ts)՝ behavior և concurrency սցենարներ։
- [Money codec](../../packages/shared/src/money.ts) և [accounts service](../../apps/api/src/ledger/accounts/accounts.service.ts)՝ exact amounts և derived balances։
- [Architecture նյութը](02-architecture-hy.md) և [mathematical plan-ը](04-mathematical-methods-hy.md)՝ արդեն եղածի ու ապագայի սահմանը։

PR-ում հաղորդված test counts-ը նշել որպես տվյալ revision-ի պատմական հաշվետվություն, ոչ մշտական հաստատուն։ Նոր run ներկայացնելիս նշել ամսաթիվը և revision-ը։

## 8. Հաջորդ ղեկավարական քննարկման օրակարգ

1. Արդյո՞ք financial core-ի invariants-ը բավարար են transfers/recurring-ի հաջորդ քայլի համար։
2. Ինչպե՞ս սահմանել statistical edge cases և money rounding policy-ն math package-ում։
3. Ինչպե՞ս բաժանել synthetic datasets-ը, որպեսզի model selection-ը չտեսնի test future-ը։
4. Ո՞ր metrics-ն ու minimum experiments-ն են բավարար դիպլոմի հետազոտական մասի համար։
5. Ինչպե՞ս պահել scope-ը՝ web և հիմնական engines-ը ավարտելու համար։

Հանդիպումից հետո ընդունված որոշումները գրանցել progress log-ում, իսկ architecture-ի փոփոխությունները՝ համապատասխան ADR-ով։ Ամբողջական պաշտպանության խոսքը թարմացնել միայն իրական engine-ների և կատարված փորձերի արդյունքներով։

## Աղբյուրներ

[Transactions demo](transactions-demo.md), [transactions requirements](../02-requirements/ledger-transactions.md), [PR #16](https://github.com/rudolf1118/costly/pull/16), [PR #15-ի պատմական draft](https://github.com/rudolf1118/costly/blob/fa8bde644d1cf87172e1b80ee02fdaf8089b191c/docs/10-diploma/review-1-demo.md), [root scripts](../../package.json), [API env example](../../apps/api/.env.example), [web env example](../../apps/web/.env.example)։ #15-ի հին demo-ից օգտագործված է հանդիպման ընդհանուր կառուցվածքը, իսկ status-ը և transaction քայլերը վերանայված են #16-ի կոդով։
