# 02 — Engines Design: Analytics, Forecasting, Goals, What-If, Insights, AI

> All engines are **deterministic** and built on one principle: every number the user sees has a
> formula, a data requirement and a reference point. The math itself lives in a pure TypeScript
> package (`packages/finance-math`) with no framework or database dependency.

Notation used below:
- `E(m)`, `I(m)`: total expenses / income in complete month `m`
- `E_c(m)`: expenses in category `c` in month `m`
- `d`: current day of month, `D`: days in month
- `MTD`: month-to-date
- All money is integer minor units. Percentages are computed at the edges, never stored.

---

## 1. Analytics engine

The analytics module produces **facts**: typed, serialisable objects such as
`CategoryDeviationFact { categoryId, period, actual, baseline, deltaAbs, deltaPct, confidence }`.
The UI, the forecasting engine, the insight rules and the optional LLM all consume the same
facts. This is the main architectural idea: *one computation, many consumers*.

### 1.1 Monthly summary
- `I(m)`, `E(m)`, net cash flow `N(m) = I(m) − E(m)`
- **Savings rate** `SR(m) = N(m) / I(m)` (undefined if `I(m) = 0`, displayed as "n/a")
- Transfers are excluded. Balances are computed as the sum of all rows per account.
- *Purpose:* the basic health number, which later becomes the input to goal projection.

### 1.2 Baselines (the reference point for everything)
- **Baseline** for category `c` at month `m`: the mean of the last `k` *complete* months,
  `B_c(m) = (1/k) Σ_{i=1..k} E_c(m−i)`, default `k = 3`.
- If `k` months aren't available, use what exists and **mark confidence low**. Below 2
  months, no baseline and no comparison is shown.
- Robust alternative: the **median** of the last 6 months, used when the category's history
  contains an extreme month (e.g., a one-off 600k flight). Rule: if `max / median > 3`, use the median.
- *Purpose:* turns "Food 180,000 AMD" into "Food is 23% above your 3-month average".

### 1.3 Pace-adjusted month-to-date comparison
Comparing MTD against a full-month baseline is misleading on day 10. Linear pacing
(`B · d/D`) is also wrong because spending is front-loaded around payday.

- Build the user's **cumulative spending profile** `P(d)`: the average fraction of monthly
  discretionary spend that has happened by day `d`, over past months.
- Expected MTD: `B_c · P(d)`. Deviation: `(MTD_c − B_c·P(d)) / (B_c·P(d))`.
- Fallback to linear `d/D` when there are fewer than 3 complete months.
- *Purpose:* reliable mid-month warnings without false alarms after payday.

### 1.4 Rolling averages and trend
- Rolling mean over 3 and 6 months per category and total.
- **Trend**: ordinary least squares slope over the last `n = 6` monthly values,
  `β = Σ(t−t̄)(y−ȳ) / Σ(t−t̄)²`, reported as a relative slope `β / ȳ` (% per month).
- Only report a trend if `n ≥ 4`, `|β/ȳ| ≥ 5%/month`, and `R² ≥ 0.5`. Otherwise the "trend" is noise.
- *Purpose:* "Groceries has grown ~6% per month for 5 months." This separates drift from a
  one-off spike, which is what the baseline comparison catches.

### 1.5 Volatility / consistency
- **Coefficient of variation** `CV_c = σ_c / μ_c` over the last 6 months.
- Classes: `CV < 0.2` stable, `0.2–0.5` variable, `> 0.5` volatile.
- *Purpose:* (1) tells the user which categories are predictable; (2) the forecasting engine
  uses CV to widen intervals and to refuse category forecasts for volatile categories;
  (3) recommendations prefer stable-but-high discretionary categories, where a cut is realistic.

### 1.6 Fixed vs. discretionary structure
- Shares of `essential_fixed`, `essential_variable`, `discretionary` in `E(m)`.
- **Recurring load** `RL = Σ monthly-equivalent active recurring expenses / median monthly income`.
- *Purpose:* "62% of your income is committed before the month starts" is directly actionable,
  and it bounds what any recommendation can realistically achieve.

### 1.7 Emergency fund / runway
- `Runway = liquid balance / mean monthly essential expenses (last 3–6 months)`, in months.
- *Purpose:* the safety constraint used by the affordability check (§4).

### 1.8 Period-over-period decomposition ("why did I spend more?")
For total change `ΔE = E(m) − E(m−1)` (or vs. baseline):
1. **Category decomposition:** `ΔE = Σ_c ΔE_c`, sorted by `|ΔE_c|`. Show the top contributors
   covering ≥ 80% of the change.
2. **Count × average-ticket decomposition** within a category. With `n` = number of
   transactions and `a` = average amount, `S = n·a`:
   `ΔS = (Δn)·a₀ + n₀·(Δa) + (Δn)(Δa)`
   i.e. *frequency effect* + *price effect* + *interaction*.
- *Purpose:* "Restaurants +18,000 AMD: you went 5 more times (+21,000); the average bill
  was slightly lower (−3,000)." This is the analysis behind "why", and it's exactly the fact
  set an LLM would later verbalise.

### 1.9 Income stability
- CV of monthly income. A stable salary gives high forecast confidence; freelance income
  gets wider intervals in balance and goal projection.

### 1.10 What analytics does NOT include
Weekday heatmaps, word clouds, "spending personality" labels, net-worth charts including
illiquid assets. They look nice and change no decisions.

---

## 2. Forecasting engine

### 2.1 Key idea: decomposition
Personal spending is two processes with very different predictability:

```
Forecast(period) = KnownRecurring(period)            ← deterministic, from recurring rules
                 + EstimatedDiscretionary(period)    ← statistical, with interval
```

- Known recurring: sum of active recurring rules' occurrences due in the period (rent, subscriptions,
  loan payments). Error ≈ 0 unless rules change.
- Estimated discretionary (including variable essentials like groceries): the time-series part.

This is the main research hypothesis: **decomposition + simple methods beat applying the same
methods to raw totals**, and both beat naive.

### 2.2 Candidate methods (applied to the monthly non-recurring series `y₁…y_t`)

| Method | Formula | Data needed | Strengths | Weaknesses | Use when |
|---|---|---|---|---|---|
| **Naive** | `ŷ_{t+1} = y_t` | 1 month | Trivial; the benchmark every method must beat | Chases noise | Always computed as the benchmark (MASE denominator) |
| **Simple moving average (k)** | `ŷ = (1/k) Σ_{i=0..k−1} y_{t−i}` | k months | Smooths noise, easy to explain | Lags behind trends; equal weights | 3–5 months of history |
| **Weighted MA** | `ŷ = Σ w_i y_{t−i} / Σ w_i`, e.g. w = 3,2,1 | 3+ months | Reacts faster than SMA | Weights are arbitrary | Alternative to SMA; compare in experiment |
| **Simple exponential smoothing (SES)** | `ℓ_t = α y_t + (1−α) ℓ_{t−1}`, `ŷ = ℓ_t` | 4+ months | One parameter; α fitted by minimising in-sample one-step error | No trend | Default for 4–8 months |
| **Holt linear (double ES)** | `ℓ_t = α y_t + (1−α)(ℓ_{t−1}+b_{t−1})`, `b_t = β(ℓ_t−ℓ_{t−1}) + (1−β) b_{t−1}`, `ŷ_{t+h} = ℓ_t + h b_t` | 8+ months | Captures trend | Overshoots on noisy data; two parameters | 9+ months *and* a trend detected (§1.4) |
| **Seasonal naive** | `ŷ = y_{t−12}` | 24+ months | Captures annual patterns | Needs 2 years | Mentioned only; not expected to be available |

α and β are selected by grid search (e.g., α ∈ {0.1, 0.2, …, 0.9}) minimising one-step-ahead
MAE on the training window. That's cheap, explainable and reproducible.

**Explicitly rejected:** ARIMA (needs ~50+ observations to identify reliably), Prophet,
LSTM/neural models. The data length doesn't support them, and the thesis should state this
with the reason.

### 2.3 End-of-month (EOM) forecast: the most useful forecast
On day `d` of `D`:

```
EOM = Spent_MTD
    + RemainingRecurring(d+1..D)
    + RemainingDiscretionary
```

`RemainingDiscretionary` is estimated with a **credibility-weighted blend** of the current
month's pace and the historical baseline:

- current-month daily rate: `r_cur = DiscretionaryMTD / d`
- historical daily rate: `r_hist = B_disc / D`
- weight on current month: `w = d / (d + K)`, with `K` ≈ 10 days (tuned in the experiment)
- `r = w·r_cur + (1−w)·r_hist`
- `RemainingDiscretionary = r · (D − d)` (or profile-based: `B_disc · (1 − P(d))` blended the same way)

Early in the month the forecast leans on history. Late in the month it leans on actuals. This is
a simple, explainable form of Bayesian shrinkage and a good applied-math talking point.

**Interval:** from empirical residuals of past EOM forecasts made on the same day `d`
(backtest), taking the 10th–90th percentile of error. Fallback when history is short:
`± z · σ_daily · √(D−d)`, with `σ_daily` from the current month.

### 2.4 Other forecasts
- **Next-month total** = next month's known recurring + discretionary method forecast (method
  chosen by data tier).
- **Category forecast** for the next month: only for categories with `CV < 0.5` and ≥ 3 months.
  Otherwise shown as "unpredictable: typical range X–Y" (P10–P90 of history).
- **Account balance projection** (liquid accounts, next 30–90 days): current balance + scheduled
  recurring income/expense on their dates + discretionary spread by the daily profile. The
  output is a daily curve with the **minimum balance point**, used for cash-flow warnings.
- **Monthly savings forecast** `Ŝ = Î − Ê`, used by goal projection.

### 2.5 Cold start: data-sufficiency tiers

The system never shows a forecast without a confidence label. The tier is computed per user
(and per category for category forecasts).

| History | What Costly shows | What it refuses to show |
|---|---|---|
| **< 14 days** | MTD totals; known recurring due this month; "we need ~2 weeks of data to estimate your pace" | Any discretionary forecast, baselines, anomalies (except duplicates) |
| **14 days – 1 month** | EOM forecast using the current month's pace only, wide interval, label "low confidence" | Next-month forecast, trends, category baselines |
| **1–3 months** | EOM with blend (short history); next-month = recurring + SMA of available months; baselines with "based on N months" | Trends, Holt, category forecasts for volatile categories |
| **3–8 months** | Full baselines; SES; category forecasts for stable categories; anomalies | Trend-based forecasts |
| **9–12+ months** | Holt when a trend is detected; backtested method selection per user (choose the method with the lowest rolling-origin MAE on *their* data); calibrated intervals | Seasonality (needs 24+ months) |

Also: **statement import immediately upgrades the tier**. A user who imports 6 months of
history on day 1 skips cold start. This is another reason import belongs early.

### 2.6 Accuracy evaluation
- **Rolling-origin backtest:** for each month `t` from `t_min` to `T−1`, train on `1..t`,
  forecast `t+1`, record the error. No look-ahead leakage.
- **Metrics:**
  - MAE `= mean |y − ŷ|`, in AMD, interpretable.
  - **MASE** `= MAE_method / MAE_naive`. Below 1 means it beats naive. Scale-free, so it can be
    compared across users and categories. This is the headline metric.
  - MAPE only as a secondary metric (it breaks when actual values are near zero).
  - **Interval coverage**: the % of actuals falling inside the stated 80% interval (should be ≈ 80%).
- **In production:** every daily EOM forecast is stored as a snapshot. When the month closes,
  the error of each snapshot is computed. This gives the *convergence curve* (error vs. day of
  month) and lets the app show "our forecasts for you are usually within ±X%".

---

## 3. Financial goals

### 3.1 Model
- `name`, `target_amount`, `target_date` (optional), `priority` (1..n), `status`
  (`active`, `achieved`, `paused`, `abandoned`), optional `linked_account_id`.
- **Current amount:**
  - linked to a savings account → the account's balance (simplest and truthful);
  - not linked → a sum of explicit `goal_contributions` (allocations the user records, or
    ones created automatically when a transfer to savings is marked "for goal X").

### 3.2 Calculations (deterministic)
- Remaining `R = target − current`.
- Progress `= current / target`.
- **Required monthly saving** to hit the target date: `R / months_until(target_date)`.
- **Expected monthly contribution** `C`: the goal's share of the forecast monthly savings `Ŝ`,
  allocated by **priority waterfall**. Higher-priority goals take what they need (their
  required monthly amount); the remainder flows down. Without a target date, a goal takes an
  equal share of what's left.
- **Expected completion date** = today + `⌈R / C⌉` months (if `C ≤ 0` → "not reachable at current behaviour").
- **On-track status:** `C ≥ required` → on track; else the gap `required − C` per month.
- **Sensitivity** (what moves the date):
  - spending change of Δ per month → new date `⌈R / (C + Δ)⌉`; weeks gained
    `≈ (R/C − R/(C+Δ)) · 4.35`;
  - income change of `p%` → `Δ = p · Î` (all of it assumed to flow to savings, stated as an assumption).
- **Optional (stretch):** a range for the completion date using P25/P75 of historical monthly
  savings instead of the point forecast, e.g. "most likely March 2029, range Oct 2028 – Sep 2029".

### 3.3 Interactions
- Forecasting provides `Ŝ`. Goals consume it.
- The what-if engine runs the same goal projection under modified inputs.
- Recommendations translate any saving opportunity into goal-date movement, the most
  motivating unit.

### 3.4 Example
Apartment: target 40,000,000, current 6,000,000, target date 5 years out → R = 34,000,000,
required = 566,667/month. Forecast savings `Ŝ` = 420,000/month, all to this goal →
expected completion in 81 months (6.75 years), 21 months late. Gap: 146,667/month. Costly then
shows the top discretionary categories and what a realistic cut in each would contribute
toward that gap.

---

## 4. What-if / scenario simulator: the signature feature

**Recommendation: yes, make this a central diploma feature.** It uses every other engine,
it's deterministic and testable, it's what makes the demo memorable, and it directly answers
the product's core question.

### 4.1 Baseline projection
A monthly timeline for horizon `H` (default 36 months, max 120), built from real data:

- starting liquid balance and savings balance, per account type;
- monthly income = recurring income + median non-recurring income (last 6 months);
- monthly expenses per category = recurring rules + per-category discretionary baseline;
- goals with priorities (waterfall allocation each month);
- safety buffer = `bufferMonths × mean essential monthly expenses` (default 3 months).

### 4.2 Scenario input: a list of typed modifiers

```ts
type Modifier =
  | { kind: 'income_change';   pct?: number; amount?: number; from: YearMonth }
  | { kind: 'category_change'; categoryId: string; pct: number; from: YearMonth }
  | { kind: 'extra_saving';    amount: number; from: YearMonth; goalId?: string }
  | { kind: 'one_time_expense';amount: number; at: YearMonth; label: string }
  | { kind: 'one_time_income'; amount: number; at: YearMonth; label: string }
  | { kind: 'recurring_add';   amount: number; from: YearMonth; months?: number; label: string }
  | { kind: 'recurring_remove';recurringRuleId: string; from: YearMonth }
  | { kind: 'loan';            principal: number; annualRatePct: number; termMonths: number; at: YearMonth; purpose?: string }
```

Loan payment uses the annuity formula: `A = P · r / (1 − (1+r)^−n)`, with `r = annualRate/12`.
Total interest `= A·n − P`.

### 4.3 Calculation
`simulate(baseline, modifiers[]) → Timeline` is a **pure function**:
for each month, apply modifiers → compute income, expenses, loan payments → net → allocate to
goals by priority → update balances → record flags (below buffer, negative balance).

Then `compare(baselineTimeline, scenarioTimeline)` produces:
- goal completion date per goal: baseline vs. scenario (± months);
- minimum liquid balance and when it happens; months below the safety buffer;
- total saved at horizon; total interest paid (loans);
- **verdict** for affordability questions: `affordable`, `affordable_with_tradeoffs`
  (buffer holds but goals are delayed), `risky` (buffer breached), `not_affordable`
  (negative balance).
- **Alternatives** (for purchase questions): the earliest month when the purchase becomes
  `affordable` if the user saves for it instead; and the comparison with a loan of the same amount.

### 4.4 Relationships
- **Goals:** the simulator reuses goal projection, so there's one implementation.
- **Forecasts:** the baseline is built from forecast outputs (`Î`, category baselines, recurring).
- **Recommendations:** every recommendation's "impact" is computed by running a one-modifier
  scenario (e.g., `category_change −15%`) through the same engine. One engine, consistent numbers.
- **AI:** "Can I afford X?" can be mapped to a scenario by the LLM (tool call), but the verdict
  comes from the engine.

### 4.5 Backend design
- `POST /scenarios/simulate`: synchronous, stateless, returns baseline + scenario + diff.
  Pure in-memory math in milliseconds. **No queue.**
- `POST /scenarios`: save a named scenario (modifiers as validated JSON) to re-run later
  against fresh data; results are *not* stored, since they're recomputed from current data.
- The baseline input is built by `ScenarioBaselineBuilder` (reads analytics/forecast facts);
  the simulation lives in `finance-math`.

### 4.6 UI idea
- Left panel: modifier cards ("+ Purchase", "+ Loan", "Change category", "Change income").
- Right panel: two balance lines (baseline vs. scenario) over time with the buffer line; goal
  date chips showing movement ("Apartment: Jun 2031 → Feb 2032, +8 months").
- Sliders recompute live (debounced API call). This is the moment the commission sees
  "decision support".
- Preset quick question: "Can I afford…?" (amount + month) → verdict card with explanation.

---

## 5. Anomaly detection

**Verdict: genuinely useful for four specific cases, harmful if generalised.** Each detector
must require minimum history, and its false-positive rate must be measured.

| Detector | Method | Min. data | Why useful |
|---|---|---|---|
| **Unusually large transaction** | Robust z-score within category: `z = 0.6745 (x − median) / MAD`, flag if `z > 3.5` **and** `x > P95` of the category **and** `x > absolute floor` (e.g., 10,000 AMD) | ≥ 15 transactions in category | Catches mistakes, fraud, forgotten one-offs. Median/MAD resist the outliers that break mean/σ |
| **Category spike (month-level)** | Pace-adjusted MTD deviation (§1.3) > +30% and > absolute floor, or full-month z-score vs. 6-month history | ≥ 3 months | The "spending much more than usual" warning |
| **Possible duplicate** | Same account, same amount, same merchant (or similar description), within 48h; also imported row matching a manual entry | none | High value and very low false-positive rate; especially after imports |
| **Recurring price increase** | Actual amount of a matched recurring payment > expected by > 5% | 2 occurrences | "Your streaming subscription went from 3,990 to 4,990" |

Why these statistics:
- **Mean / standard deviation / z-score** `(x − μ)/σ`: the textbook starting point; shown in
  the thesis as the baseline method. A single extreme value inflates σ and masks itself.
- **Median / MAD / robust z**: the production choice, because spending distributions are
  right-skewed with heavy tails.
- **Percentile thresholds (P95)**: distribution-free and easy to explain to the user ("larger
  than 95% of your restaurant bills").
- **Rolling baseline**: all thresholds are computed over a rolling window (last 6 months), so the
  detector adapts when the user's life changes.

Rejected: isolation forests, autoencoders, clustering. They can't be explained to the user and
can't be validated with this data volume.

**Evaluation:** inject known anomalies into synthetic personas and measure precision, recall and
F1 per detector and method (mean-z vs. robust-z vs. percentile). Also measure **alerts per user
per month**, a direct proxy for alert fatigue (target ≤ 2–3).

---

## 6. Recommendation (Insight) engine

### 6.1 One concept: Insight
Anomalies, warnings and recommendations share a lifecycle, so they share a table and a module:

```
Insight { type, ruleId, subject (category/goal/recurring/transaction), period,
          fingerprint, severity, impact (AMD/year, goal days), facts JSON,
          status, createdAt, expiresAt, feedback }
```

### 6.2 Rule interface
```ts
interface InsightRule {
  id: string;                    // 'category_over_baseline'
  minTier: DataTier;             // don't run without enough data
  evaluate(ctx: InsightContext): InsightCandidate[];  // pure, uses facts only
}
```
`InsightContext` is built once per evaluation from analytics, forecast and goal facts. Rules
don't query the database, so they're unit-testable with plain objects.

### 6.3 Rule catalogue (initial)

| Rule | Trigger | Calculation shown to user |
|---|---|---|
| `category_over_baseline` | Discretionary category, month ≥ baseline +20% and ≥ 15,000 AMD above | "Restaurants +31% vs. 3-month baseline (65,500 vs. 50,000). Reducing by 15% saves ≈ 118,000/year and moves Apartment ≈ 8 weeks earlier." |
| `budget_pace` | Projected EOM category spend > budget | "At this pace Groceries ends at 118k vs. budget 100k; 22k/week left for 9 days keeps you within budget." |
| `budget_unrealistic` | Budget exceeded in ≥ 3 of the last 4 months, or used < 50% | "Suggested budget: 95k (your 75th percentile)" |
| `cash_flow_warning` | Projected liquid balance < buffer (or < 0) before next income | "Card balance may drop to −40k around the 27th; salary arrives on the 30th." |
| `goal_off_track` | Expected completion > target date | Gap per month + top 3 categories whose realistic cut covers it |
| `goal_acceleration` | Unallocated surplus > threshold for 2+ months | "An extra 50k/month to Car moves it 5 months earlier." |
| `recurring_price_increase` | See anomalies | Annualised extra cost |
| `recurring_review` | Discretionary recurring total > X% of income | List + annual cost of each |
| `unusual_transaction` | Anomaly detector | Percentile context |
| `possible_duplicate` | Duplicate detector | "Mark as duplicate / keep" actions |

"Realistic cut" is bounded: max 25% for a discretionary category, never applied to essentials,
and never below the category's P10 of history.

### 6.4 Prioritisation
`score = severity_weight × normalised_impact × confidence × freshness`
- `normalised_impact` = annual AMD impact / median monthly income (so it scales across users);
- `confidence` from data tier and category CV;
- warnings with time pressure (cash flow, budget pace) get a severity boost.
Show at most 3–5 active insights on the dashboard. The rest stay in the feed.

### 6.5 Lifecycle, deduplication, expiry, feedback
- `fingerprint = hash(userId, ruleId, subjectId, period)` with a **unique constraint**:
  re-evaluation updates the existing insight's facts instead of creating a new one. This makes
  job re-runs idempotent.
- States: `active → seen → (acted | dismissed | snoozed) → resolved | expired`.
- **Dismissal cooldown:** the same `(ruleId, subjectId)` isn't re-raised for 60 days (stored on the dismissal).
- **Expiry:** period-bound insights expire when the period ends (`expiresAt`). A daily job sweeps them.
- **Auto-resolve:** when re-evaluation no longer triggers (e.g., spending normalised).
- **Feedback:** 👍/👎 + optional reason ("not relevant", "already know", "wrong").
- **Usefulness metrics:** acceptance rate, dismissal rate per rule, and *outcome*: for
  spending recommendations, whether the next month's category spend actually decreased. Rules
  with high dismissal rates are candidates for tuning. That's a small, real feedback loop.

---

## 7. AI / LLM (optional, Chapter 4)

### Architecture
```
Ledger → Analytics / Forecast / Simulation / Insights → structured facts (JSON)
      → LLM (explain / map question to tool calls) → text with cited numbers
```

### Where AI helps
- **Explain a month:** turn the decomposition facts (§1.8) into a short narrative.
- **Explain an insight or a scenario result** in plain language.
- **Natural-language Q&A** over read-only tools: `get_month_summary`, `compare_periods`,
  `get_goal_projection`, `simulate_scenario`. The LLM picks tools and parameters; the engines
  compute.
- *(Optional)* **Suggest a category for an unknown merchant** during import, only after
  deterministic rules fail, and always as a suggestion the user confirms.

### Where AI must NOT be used
- Any arithmetic, sum, average, forecast, goal date or affordability verdict
- Deciding which insights to raise or their priority
- Writing to the database
- Anything that runs without the user asking (no silent AI processing of data)

### Guardrails & evaluation
- The prompt contains only facts, never raw transaction lists beyond what's needed.
- **Numeric grounding check:** every number in the LLM response must appear in the provided facts
  (tolerating formatting). Responses that fail are flagged. Measure the grounding rate on a
  fixed question set (experiment E10).
- The provider sits behind a small `LlmClient` interface. The model is configurable (e.g., a
  current Claude model), and the feature flag is off by default. The diploma works with AI disabled.
- Executed as a BullMQ job only if streaming isn't used. Otherwise a synchronous streaming
  endpoint with a timeout is simpler. Decide in Ch4.

---

## 8. Applied mathematics: summary and purpose

| Method | Where | Product purpose |
|---|---|---|
| Mean, median, percentiles | Baselines, typical ranges | Reference point for every number |
| Standard deviation, CV | Volatility classes, interval width | "How predictable is this category?" |
| Robust z-score (median/MAD) | Anomaly detection | Unusual transactions without masking |
| OLS linear regression, R² | Trend detection | Drift vs. noise |
| Additive decomposition (Δ = frequency + price + interaction) | "Why did I spend more?" | Causal-looking but honest explanation |
| SMA / WMA / SES / Holt | Forecasting | Next-month and category forecasts |
| Credibility-weighted blending | EOM forecast | Smooth transition from history to actuals |
| Empirical residual quantiles | Forecast intervals | Honest uncertainty |
| MAE, MASE, interval coverage, rolling-origin validation | Evaluation | Measurable diploma results |
| Annuity formula, compounding | What-if loans, deposits | Loan cost, affordability |
| Priority waterfall allocation | Goals | Multiple goals competing for savings |
| Precision / recall / F1 | Anomaly & recurring detection evaluation | Measurable diploma results |
| Periodicity detection (interval median and dispersion) | Recurring detection | Automates the most predictable part |

Recurring detection, briefly: group transactions by merchant (+ amount within ±10%), sort by date,
compute the intervals between occurrences. If there are ≥ 3 occurrences, the median interval is
within {7, 14, 30, 365} ± tolerance, and the interval CV < 0.2, suggest a recurring rule with
that period and the median amount. Evaluate against the generator's ground truth.

This is enough mathematics to explain and evaluate in a thesis chapter. None of it is decorative:
every method changes something the user sees.
