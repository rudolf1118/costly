# ADR-0004: BullMQ on Redis for background processing, not RabbitMQ

Status: Accepted
Date: 2026-09-28

## Context

Some work cannot run inside an HTTP request: parsing and committing an uploaded bank statement,
materialising recurring transactions daily, taking forecast snapshots, closing the month,
expiring insights, and recomputing derived data after ledger writes.

What that work needs is scheduling, retries with backoff, bounded concurrency, failures that stay
visible instead of disappearing, recovery after a crash, and — for recomputation — debouncing, so
that twenty quick edits produce one recomputation rather than twenty.

What it does not need is communication between independently deployed services. Costly is a
single application (ADR-0001) where the producer and the consumer are the same codebase.

## Decision

BullMQ backed by Redis, with Bull Board mounted locally for inspecting queues and failed jobs.
The worker is a second entrypoint (`worker.ts`) of the same NestJS application, sharing its
modules and database connection.

No RabbitMQ, Kafka or NATS.

## Rationale

The requirement is a job queue, not a message broker. BullMQ provides each needed primitive
directly: delayed jobs, repeatable job schedulers via `upsertJobScheduler` so redeploying does
not duplicate schedules, per-job `attempts` with exponential backoff, concurrency limits per
worker, a persistent failed set that can be inspected and retried, and deduplication by `jobId`.
That last one is what makes the debounced `recompute-user` job work at all.

Redis is already in the stack as BullMQ's backing store, present since Chapter 0 and running in
Docker Compose. Choosing BullMQ therefore adds no new service to install, run, monitor or explain
at the defense.

The Node and NestJS fit is direct: BullMQ is written in TypeScript, `@nestjs/bullmq` integrates
with dependency injection and the application lifecycle, and the worker drains active jobs on
`SIGTERM` through the same shutdown hooks the API uses.

RabbitMQ would mean running a broker, designing exchange, queue and binding topology, learning
AMQP delivery semantics, and operating a second management interface. In exchange it would still
not provide delayed or repeatable jobs without plugins, nor a queryable set of failed jobs to
inspect after the fact. It also makes `docker compose up` heavier, which matters when the whole
system has to start on a laptop at the defense. Kafka and NATS are further from the problem
still: there is no stream, no replay requirement and no second consumer language.

Idempotency is deliberately **not** delegated to the queue. Every job is safe to run twice
because the database makes it so — unique constraints such as `(recurring_rule_id,
recurring_occurrence)`, or replace-in-transaction for recomputed data. The queue is a scheduler,
not a correctness guarantee.

## Where BullMQ must not be used

A job is justified when the work is slow, scheduled, retry-worthy, or must be debounced.
Otherwise it is a function call. Specifically, these stay synchronous:

- creating, updating and deleting transactions, accounts, categories, merchants, budgets and
  goals — fast writes whose result the user must see immediately;
- all reads, including every analytics query behind the dashboard;
- running a what-if scenario, which is pure in-memory arithmetic answering in well under 100 ms;
- dismissing, snoozing or acknowledging an insight.

Pushing ordinary CRUD through a queue would trade a 30 ms response for eventual consistency and
a spinner, which is a worse product and more code.

## Consequences

Positive: no additional infrastructure; jobs share types, modules and configuration with the API;
scheduling, retries, concurrency and failure inspection come for free; queue behaviour is testable
against a real Redis through Testcontainers, including the crash-recovery tests in E8.

Negative: durability is Redis durability, so append-only persistence is enabled in Compose and
the queue is not treated as a system of record; there is no cross-language consumer story, which
is acceptable because there are no other languages; and BullMQ has sharp edges that have to be
respected — notably that adding a job whose `jobId` already exists is silently ignored, including
when that job is currently active, which the recompute job works around by re-checking its marker
before finishing.

## Alternatives Considered

**RabbitMQ.** Rejected: broker operations and topology design for a single-application job queue,
without delayed or repeatable jobs out of the box.

**Kafka or NATS.** Rejected: built for streaming and multi-consumer fan-out across services,
neither of which exists here.

**PostgreSQL as the queue** (`SELECT … FOR UPDATE SKIP LOCKED`, or pg-boss). Genuinely tempting,
since it would remove Redis and make enqueueing transactional with the ledger write. Rejected
because Redis is required anyway for BullMQ-adjacent needs such as auth rate limiting, and
because the dual-write problem it would solve is already solved by the recompute-marker pattern
(ADR-0006, to be written in Chapter 2) at a lower cost than replacing the job system.

**No queue, using `setInterval` and fire-and-forget promises.** Rejected: no retries, no
visibility, no crash recovery, and background work would die with the HTTP process.

## References

- `../../00-planning/03-technical-design.md` §3 — queue and job table, job design principles,
  the dirty-marking pattern
- `../../00-planning/01-product-and-feature-analysis.md` §4 — where BullMQ and Redis are justified
- `../../00-planning/04-roadmap-experiments-defense.md` §1 — experiment E8
