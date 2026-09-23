# Costly: Documentation

This folder is the technical source of truth for the Costly diploma project. It grows chapter by
chapter. Code without a corresponding doc update is incomplete.

## Start here
- [Final specification](00-planning/05-final-specification.md): what we build
- [Supervisor specification](10-diploma/supervisor-specification.md): the project summary for the supervisor

## Structure

```
docs/
  README.md                        this file
  00-planning/                     pre-implementation analysis (frozen after approval; changes via ADR)
    01-product-and-feature-analysis.md
    02-engines-design.md
    03-technical-design.md
    04-roadmap-experiments-defense.md
    05-final-specification.md

  01-product/
    vision.md                      product definition, core problem, differentiator (short, stable)
    personas-and-use-cases.md      target user, daily/weekly/monthly use cases
    feature-decisions.md           feature-by-feature keep/drop table with reasons
    out-of-scope.md                the scope-creep firewall

  02-requirements/
    functional-requirements.md     numbered FR-xx per module (referenced from tests and the thesis)
    non-functional-requirements.md latency targets, correctness invariants, data isolation, local-run requirement
    glossary.md                    baseline, data tier, discretionary, insight, fingerprint, EOM…

  03-architecture/
    overview.md                    C4 context + container diagram (api, worker, web, postgres, redis)
    modules.md                     module table, owned tables, public facades, dependency rules
    background-jobs.md             queues, jobs, idempotency keys, retries, schedules, dirty-marking pattern
    api-conventions.md             errors, pagination, validation, auth, versioning
    flows.md                       the six end-to-end flows (kept current with the implementation)
    adr/
      0001-modular-monolith.md
      0002-money-as-bigint-minor-units.md
      0003-prisma-with-raw-sql-for-analytics.md
      0004-bullmq-over-rabbitmq.md
      0005-transfers-as-paired-rows.md
      0006-dirty-marking-instead-of-outbox.md
      0007-sync-simulation-async-snapshots.md
      ...                          one ADR per significant decision, including rejected options

  04-database/
    schema-overview.md             ER diagram per domain (core, analytics, forecasting, insights)
    tables/                        one short file per domain: purpose, fields, constraints, indexes
    derived-data-policy.md         what is stored vs. calculated, and why
    migrations-log.md              notable migrations and data backfills

  05-analytics/
    metrics-catalog.md             every metric: formula, data requirement, purpose, where shown
    anomaly-detection.md           detectors, thresholds, evaluation
    recurring-detection.md

  06-forecasting/
    methods.md                     formulas, parameters, selection
    data-tiers-cold-start.md
    backtesting.md                 methodology, metrics, how to run the harness

  07-decision-support/
    goals.md
    what-if-engine.md              modifier types, calculation, verdict rules
    insights-engine.md             rules catalogue, scoring, lifecycle
    ai-assistant.md                (optional) boundaries, prompts, grounding check

  08-testing/
    strategy.md                    test pyramid for this project, what is tested where
    data-generator.md              personas, parameters, ground-truth format, seeds
    performance-testing.md         k6 scenarios, dataset sizes, how to reproduce

  09-research/
    experiment-template.md         hypothesis · dataset · method · metrics · results · conclusion
    experiments/
      E01-forecast-method-comparison.md
      E02-eom-convergence.md
      E03-cold-start.md
      E04-anomaly-detection.md
      E05-recurring-detection.md
      E06-query-performance.md
      E07-ingestion-throughput.md
      E08-queue-behaviour.md
      E09-recommendation-rules.md
      E10-ai-grounding.md          (optional)
    results/                       generated CSV/PNG outputs referenced by experiments

  10-diploma/
    supervisor-specification.md    initial project specification for the supervisor
    thesis-outline.md              chapter plan mapping docs → thesis sections
    progress-log.md                dated entries: what was done, decisions, supervisor feedback
    chapter-reports/               one short report per development chapter (v0.1 … v1.0)
    defense-demo-script.md         minute-by-minute demo, fallback plan
    slides/                        defense presentation sources
```

## Rules
1. **ADR for every significant decision**, especially for anything on the out-of-scope list.
2. **Formulas live in docs, not only in code.** `05`–`07` are written *before or with* the implementation.
3. **Experiments are reproducible:** each links to the script and seed that produced its numbers.
4. **Each chapter ends** with a chapter report in `10-diploma/chapter-reports/` and a `progress-log.md` entry.
5. `00-planning/` is frozen after supervisor approval. Later changes go into the topic folders + ADRs.

## Suggested thesis mapping (`10-diploma/thesis-outline.md`)
1. Introduction: problem, goals, relevance → `01-product`
2. Review of existing solutions and methods → `01-product`, `09-research`
3. Requirements and domain model → `02-requirements`, `04-database`
4. System architecture → `03-architecture`
5. Analytics and anomaly detection → `05-analytics`
6. Forecasting and evaluation → `06-forecasting`, E1–E3
7. Decision support: goals, simulation, recommendations → `07-decision-support`
8. Testing, performance and experimental results → `08-testing`, `09-research`
9. Conclusion and future work
