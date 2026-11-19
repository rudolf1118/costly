# 04 — Costly․ մաթեմատիկական մեթոդներ և հետազոտական պլան

> Վիճակ՝ 2026-11-19, code snapshot՝ `248edd60e8429934391d8d2d49fd11eaf778aded`։ **Իրականացված են exact money representation-ը և account balance-ի թվաբանական հաշվարկը։ Ստորև analytics, forecasting, goals, what-if և evaluation բաժինները ապագա աշխատանք են։** `packages/finance-math`-ը դեռ չկա։

## 1. Ինչն է մաթեմատիկական բաղադրիչի նպատակը

Մեթոդները պետք է պատասխանեն օգտագործողի կոնկրետ հարցին, ունենան հստակ input, բանաձև, data requirement և փորձարկման եղանակ։ Պարզ մեթոդի լավ չափված արդյունքը ավելի արժեքավոր է, քան բարդ մեթոդի չհիմնավորված ճշտության պնդումը։ Ծախսի կառուցվածքային բացատրությունը նույնպես պատճառահետևանքային ապացույց չէ․ «frequency effect»-ը թվաբանական decomposition է։

Նշանակումներ․ `I_m`՝ ամսվա եկամուտ, `E_m`՝ ծախս, `E_c,m`՝ category-ի ծախս, `B_0`՝ opening balance, `y_t`՝ ժամանակային շարքի դիտարկում, `ŷ_t`՝ կանխատեսում։ Դրամական գումարները պետք է պահպանեն minor-unit ճշտությունը։ Ratios/coefficients-ը դրամական ledger entries չեն․ ապագա հաշվարկներից դրամական արդյունք ստանալիս անհրաժեշտ է բացահայտ rounding policy և դրա թեստեր։

## 2. Իրականացված՝ մնացորդի հաշվարկ

Յուրաքանչյուր account-ի համար՝

```text
B = B₀ + Σ income_amount − Σ expense_amount
```

Գումարը transaction-ում դրական է, ուղղությունը սահմանում է `type`-ը։ Transfers դեռ չկան, ուստի բանաձևում transfer rows չեն ներառվում։

Օրինակ՝ `250,000 + 900,000 − 18,500.50 = 1,131,499.50 AMD`։ Minor units-ով՝ `25,000,000 + 90,000,000 − 1,850,050 = 113,149,950`։ Սրանք ցուցադրական թվեր են, ոչ user-ի իրական տվյալներ։

Գումարները database-ում `bigint` են, transport-ում՝ decimal strings, client-ում՝ `bigint`։ Առանձին balance column չկա։ Տրանզակցիայի սահմանաչափը չի նշանակում, որ բոլոր transaction-ների գումարը տեղավորվում է JavaScript safe integer-ի սահմաններում․ այդ պատճառով նաև aggregate balance-ը չպետք է փոխակերպել `number`-ի։

Աղբյուրներ՝ [accounts service](../../apps/api/src/ledger/accounts/accounts.service.ts), [money codec](../../packages/shared/src/money.ts), [ADR-0002](../03-architecture/adr/0002-money-as-bigint-minor-units.md)։

## 3. Ապագա՝ descriptive analytics

### Ամսական cash flow և savings rate

```text
N_m = I_m − E_m
SR_m = N_m / I_m
```

`I_m = 0` դեպքում savings rate-ը սահմանված չէ և պետք է ցուցադրվի `n/a`, ոչ 0% կամ infinity։ Ապագա transfers-ը պետք է բացառել income/expense totals-ից, որպեսզի սեփական հաշիվների միջև շարժը չդառնա արհեստական եկամուտ։

### Mean/median baseline

Category-ի սովորական ծախսի reference-ը՝ վերջին `k` ամբողջական ամիսների միջինը․

```text
Baseline_c,m = (E_c,m−1 + … + E_c,m−k) / k
```

Նախագծով default `k = 3`։ Երկու ամբողջական ամսից քիչ պատմության դեպքում baseline comparison չպետք է ցույց տալ։ Extreme month-ի դեպքում նախագծով քննարկված robust տարբերակը վերջին վեց ամսվա median-ն է՝ `max / median > 3` կանոնով։ Median-ը 0 լինելու դեպքը պահանջում է առանձին policy, քանի որ հարաբերությունը անորոշ է։

Օրինակ՝ 40,000, 50,000, 60,000 AMD → baseline 50,000։ Նոր ամսվա 65,000-ը baseline-ից 30% բարձր է։ Սակայն ընթացիկ ամսվա 10-րդ օրը այդ թիվը ամբողջ ամսվա baseline-ի հետ ուղղակի համեմատելն արդար չէ։

### Month-to-date pace

`P(d)`-ն անցած ամիսների cumulative spending profile-ն է՝ մինչև ամսվա `d` օրը ծախսված բաժինը։

```text
ExpectedMTD = Baseline × P(d)
Deviation = (ActualMTD − ExpectedMTD) / ExpectedMTD
```

Երեք ամբողջական ամսից քիչ պատմության դեպքում նախատեսված fallback-ը `P(d) = d/D` է, որտեղ `D`-ն ամսվա օրերի թիվն է։ Zero expected spend-ի դեպքում հարաբերական deviation-ը չի հաշվարկվում։ Մինչև իրականացումը պետք է սահմանել տարբեր երկարությամբ ամիսների և zero-spend ամիսների մշակումը։

### Trend և volatility

OLS trend-ի թեքությունը՝

```text
b = Σ(t − mean(t))(y_t − mean(y)) / Σ(t − mean(t))²
RelativeTrend = b / mean(y)
CV = standardDeviation(y) / mean(y)
```

Նախագծային trend gate՝ առնվազն 4 դիտարկում, `|RelativeTrend| ≥ 5%/month`, `R² ≥ 0.5`։ Սա candidate rule է, ոչ փորձերով արդեն հաստատված threshold։ `mean(y)=0` կամ constant series-ի դեպքում trend/CV/R² handling-ը պետք է սահմանվի բացահայտ։

CV-ի նախատեսվող դասերը՝ `<0.2` stable, `0.2..0.5` variable, `>0.5` volatile։ Հաշվարկներում անհրաժեշտ է նշել sample կամ population standard deviation-ի ընտրությունը և նույն տարբերակը կիրառել tests-ում ու experiments-ում։

### Ծախսի փոփոխության decomposition և runway

Եթե `S=n×a`, որտեղ `n`-ը գործարքների թիվն է, `a`-ն միջին գումարը, ապա՝

```text
ΔS = Δn × a₀ + n₀ × Δa + Δn × Δa
Runway = LiquidBalance / MeanMonthlyEssentialExpense
```

Առաջին բանաձևը տարանջատում է frequency, average-ticket և interaction ազդեցությունները։ Zero transaction count-ի դեպքում average ticket-ը սահմանված չէ, ուստի պետք է հատուկ branch։ Runway-ն ամիսներով անվտանգության ցուցանիշ է․ zero essential expense-ի դեպքում սովորական division չի կատարվում։

## 4. Ապագա՝ anomaly detection

Անսովոր transaction-ի հիմնական թեկնածուն robust z-score-ն է․

```text
median = median(x₁, …, x_n)
MAD = median(|x_i − median|)
z_robust = 0.6745 × (x − median) / MAD
```

Նախագծային կանոնը պահանջում է category-ում առնվազն 15 transaction, `z > 3.5`, `x > P95` և absolute floor։ `MAD=0` դեպքում բանաձևը չի աշխատում․ percentile/absolute-threshold fallback-ը պետք է ընտրվի և փորձարկվի, ոչ ենթադրվի արդեն իրականացված։

Այլ նախատեսվող detectors՝ category spike, possible duplicate և recurring price increase։ Duplicate detection-ը միայն նույն գումարի համընկնում չէ․ պլանով հաշվի են առնվում account-ը, merchant/description-ը և ժամանակային պատուհանը։ Flag-ը պետք է լինի ստուգման առաջարկ, ոչ ավտոմատ մեղադրանք կամ ինքնաշխատ ջնջում։

Recurring detection-ի պլանը՝ group by merchant և մոտ գումար, առնվազն 3 occurrence, միջակայքերի median և CV։ Սպասվող պարբերություններն են շաբաթական, երկշաբաթական, ամսական, տարեկան։ «Ամիս = միշտ 30 օր» մոտեցումը բավարար չէ օրացուցային սահմանների համար․ tolerance-ը պետք է ստուգել February/end-of-month դեպքերում։

## 5. Ապագա՝ forecasting

### Հիմնական հիպոթեզ

```text
Forecast = KnownRecurring + EstimatedNonRecurring
```

Նպատակը հայտնի schedule-ով պարտավորությունները առանձնացնելն է փոփոխական ծախսերից։ Հիպոթեզն այն է, որ decomposition + simple methods-ը կարող է ավելի լավ աշխատել, քան raw totals-ի forecast-ը։ Այն պետք է հաստատել կամ մերժել փորձով։ Recurring schedule-ն էլ անսխալական չէ․ գումարը կամ կանոնը կարող են փոխվել։

### Համեմատվող մեթոդներ

| Մեթոդ | Բանաձև | Նպատակ և սահմանափակում |
|---|---|---|
| Naive | `ŷ_t+1 = y_t` | Պարտադիր benchmark․ կրկնում է վերջին ամիսը |
| SMA | `ŷ_t+1 = Σ y_t−i / k` | Հարթեցնում է աղմուկը, բայց ուշ է արձագանքում trend-ին |
| WMA | `ŷ_t+1 = Σ w_i y_t−i / Σ w_i` | Ավելի մեծ կշիռ վերջին ամիսներին․ weights-ը պետք է գնահատել |
| SES | `l_t = αy_t + (1−α)l_t−1`, `ŷ_t+1 = l_t` | Մակարդակի հարթեցում՝ առանց trend-ի |
| Holt | Ստորև | Level + trend, ավելի շատ տվյալ և զգուշություն է պահանջում |

```text
l_t = αy_t + (1−α)(l_t−1 + b_t−1)
b_t = β(l_t − l_t−1) + (1−β)b_t−1
ŷ_t+h = l_t + h×b_t
```

`α,β`-ի ընտրությունը նախատեսվում է training window-ի վրա grid search-ով։ Initialization-ը և negative expense forecast-ի policy-ն պետք է սահմանվեն նախքան գնահատումը։ Model selection-ը չպետք է օգտագործի test horizon-ի ապագա տվյալը։

### End-of-month forecast

```text
EOM = SpentMTD + RemainingRecurring + RemainingNonRecurring
w = d / (d + K)
r_cur = NonRecurringMTD / d
r_hist = HistoricalNonRecurringBaseline / D
r = w×r_cur + (1−w)×r_hist
RemainingNonRecurring = r×(D−d)
```

`K≈10 օր`-ը նախնական candidate է, ոչ հաստատված optimum։ Օրինակ՝ `d=10`, `D=30`, `K=10`, variable MTD=100,000, historical baseline=240,000 դեպքում `w=0.5`, blended daily rate=9,000 և remaining variable spend=180,000 AMD։ Եթե MTD total-ը 150,000 է, իսկ remaining recurring-ը՝ 50,000, ապա EOM=380,000 AMD։ Սա ձեռքով հաշվարկված ուսուցողական օրինակ է, ոչ ծրագրի արդյունք։

### Տվյալների բավարարություն և uncertainty

| Պատմություն | Նախագծային սահման |
|---|---|
| <14 օր | Discretionary forecast չցուցադրել |
| 14 օր–1 ամիս | Pace-based EOM, low confidence |
| 1–3 ամիս | Սահմանափակ պատմություն, պարզ next-month estimate |
| 3–8 ամիս | Baselines/SES՝ կոնկրետ մեթոդի նվազագույն դիտարկումները բավարարելու դեպքում |
| 9+ ամիս | Holt միայն trend-ի դեպքում, backtested method selection |

Tier ունենալը չի շրջանցում մեթոդի նվազագույն պահանջը․ օրինակ SES-ի պլանում նշված է 4+ ամիս։ Նման սահմանների ճշգրտումը պետք է ամրագրվի իրականացման փաստաթղթում։

80% prediction interval-ի candidate-ը rolling backtest-ի residual-ների P10/P90 quantiles-ն է։ Սա uncertainty estimate է, ոչ երաշխիք։ Coverage-ի հետ պետք է չափել interval width-ը․ չափազանց լայն interval-ը կարող է լավ coverage ունենալ և գործնականում քիչ օգնել։

## 6. Ապագա՝ goals և what-if

Եթե target-ը `T` է, current amount-ը՝ `C₀`, ամսական contribution-ը՝ `c`, ապա պարզեցված գնահատումը՝

```text
R = max(0, T − C₀)
RequiredMonthly = R / monthsRemaining
MonthsToGoal = ceil(R / c)      եթե c > 0
```

`R=0`՝ նպատակն արդեն կատարված է։ `c≤0` և `R>0`՝ ընթացիկ վարքագծով completion date չկա։ Past/zero target horizon-ը նույնպես հատուկ դեպք է։ Մի քանի goal-ի դեպքում նախատեսվում է priority waterfall allocation, որպեսզի նույն խնայողությունը չհաշվարկվի մի քանի անգամ։

What-if-ը կլինի pure `simulate(baseline, modifiers)`՝ default 36 ամսվա horizon-ով։ Modifier-ներ՝ եկամտի/կատեգորիայի փոփոխություն, extra saving, one-time income/expense, recurring add/remove, loan scenario։ Նույն input-ը պետք է տա նույն output-ը։

Վարկի annuity payment-ի candidate բանաձևը՝

```text
r = annualRatePct / 100 / 12
A = P×r / (1 − (1+r)^(-n))      երբ r > 0
A = P/n                        երբ r = 0
TotalInterest ≈ A×n − P
```

Պետք են `P≥0`, `n>0`, rate validation և rounding/վերջին վճարման ճշգրտում։ Սա scenario-ի պարզ մոդել է՝ առանց բանկային բոլոր fees/taxes-ի, և չի նշանակում loan tracking-ի իրականացում։

Comparison-ը պլանով ցույց կտա goal-date shift, minimum liquid balance, buffer breaches և տոկոսագումար։ Insight-ի տարեկան ազդեցությունը պետք է ստացվի նույն simulation engine-ից, ոչ անկախ երկրորդ հաշվարկից։

## 7. Ապագա՝ փորձերի մեթոդաբանություն

### Rolling-origin backtesting

Յուրաքանչյուր origin `t`-ի համար train անել միայն `1..t` տվյալներով, կանխատեսել հաջորդ շրջանը, ապա համեմատել փաստացիի հետ։ Hyperparameters-ը ընտրվում են այդ training history-ի ներսում։ Նույն test windows-ը և նույն data preparation-ը կիրառվում են բոլոր մեթոդների համար։

```text
MAE = (1/N) × Σ |y_i − ŷ_i|
Coverage = interval-ի ներսում եղած actual-ների թիվ / N
Precision = TP/(TP+FP)
Recall = TP/(TP+FN)
F1 = 2×Precision×Recall/(Precision+Recall)
```

Zero denominator-ի դեպքում արդյունքը նշել undefined և հաշվետվությունում ներկայացնել counts-ը։ MAPE-ն կարող է լինել միայն օժանդակ metric, քանի որ zero/near-zero actual-ների համար անկայուն է։

**MASE-ի անվանման ճշտում՝ ապագա implementation-ի համար։** Frozen engines plan-ը shorthand-ով գրում է `MAE_method / MAE_naive`։ Համադրելի հաշվետվության համար պետք է հստակ նշել denominator-ը։ Non-seasonal MASE-ի սովորական սահմանման training scale-ը՝

```text
q = (1/(T−1)) × Σ[t=2..T] |y_t − y_t−1|
MASE = mean(|testError| / q)
```

Եթե denominator-ը նույն test windows-ի naive MAE-ն է, արդյունքը պետք է առանձին կոչել **relative MAE vs naive**։ Rolling origins-ի դեպքում scale-ը հաշվել յուրաքանչյուր training window-ի ներսում։ `q=0` դեպքում MASE-ն undefined է․ ներկայացնել MAE-ն և այդ սահմանափակումը։ Այս պարզաբանումը չի փոփոխում frozen փաստաթուղթը և չի ներկայացվում որպես արդեն ընդունված code change։

### Փորձերի քարտեզ

| Փորձ | Ինչ հարցի է պատասխանում | Չափելի output |
|---|---|---|
| E1 | Decomposition-ը և որ մեթոդն են ավելի լավ forecast տալիս | MAE, հստակ սահմանված MASE/relative MAE |
| E2 | Ամսվա ընթացքում EOM error-ը նվազո՞ւմ է | Error ըստ ամսվա օրվա, coverage |
| E3 | Քիչ պատմությունն ինչպե՞ս է ազդում | Metrics ըստ data tier-ի |
| E4 | Anomaly detector-ը օգտակա՞ր է | Precision/recall/F1, false alerts/month |
| E5 | Recurring detection-ը ճի՞շտ է | Հայտնաբերման metrics ըստ պարբերության |
| E6 | Query/index ընտրությունն ինչ ազդեցություն ունի | EXPLAIN ANALYZE, p50/p95 latency |
| E7 | Transaction/import throughput-ը բավակա՞ն է | Throughput, latency, error rate |
| E8 | Jobs-ը կրկնվելուց կամ crash-ից հետո ճի՞շտ են | Duplicate/lost work counts, recovery |
| E9 | Recommendation rules-ը ճի՞շտ և օգտակա՞ր են | Scenario expectations, հետագա feedback metrics |
| E10՝ optional | AI-ն պահպանում է տրամադրված փաստե՞րը | Numeric grounding rate |

**Այս փորձերի արդյունքներ այս revision-ում չեն ներկայացվում, քանի որ համապատասխան փորձերն այստեղ չեն կատարվել։**

Dataset plan-ը՝ deterministic synthetic personas՝ fixed seed և հայտնի ground truth, հնարավորության դեպքում՝ անանունացված սեփական պատմություն։ Յուրաքանչյուր փորձի համար պետք է պահել commit SHA, seed, parameters, dataset version, train/test periods, script և raw results։ Synthetic data-ի հաջողությունը չի ապացուցում նույն որակը իրական population-ի վրա։

## 8. Աղբյուրներ և հաջորդ քայլ

Մեթոդների նախագծային հիմքը՝ [engines design](../00-planning/02-engines-design.md), [final specification](../00-planning/05-final-specification.md), [roadmap և experiments](../00-planning/04-roadmap-experiments-defense.md)։ Դրանք **պլանի աղբյուրներ են**, ոչ իրականացված algorithms-ի կամ ստացված ճշտության ապացույց։

Հաջորդ քայլը financial core-ի ավարտից հետո pure math package-ի ստեղծումն է, edge-case policies-ի ամրագրումը և unit/property tests-ը՝ նախքան forecasting UI-ի ցուցադրումը։ Պաշտպանության ձևակերպումները՝ [05 — Պաշտպանության նախապատրաստում](05-defense-preparation-hy.md)։
