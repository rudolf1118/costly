# ADR-0010: Web client architecture

Status: Accepted
Date: 2026-11-13

## Context

The backend has registration, authentication with rotating refresh sessions (ADR-0006) and
financial accounts. The web client, `apps/web`, is still the Chapter 0 skeleton: Vite, React and
Vitest with a health-check widget, and nothing else. The next web work (an application shell,
then sign-in, then accounts) needs its foundations chosen first, because every later screen builds
on them.

What is already fixed:

- **Specification §18:** React + Vite + TanStack Query, a component library (shadcn/ui or
  Mantine), one chart library (Recharts or ECharts), zod for shared schemas, Vitest, fast-check
  and a few Playwright end-to-end tests.
- **Product analysis §3:** the frontend is the largest time risk. The mitigation is a component
  library and one chart library, and "no custom design system".
- **Technical design §2.1:** a `packages/shared` workspace package for the API types and zod
  schemas that the API and the web client share.
- **ADR-0002:** money crosses the API as decimal strings of integer minor units.
- **ADR-0006 and `api-conventions.md`:** the access token stays in memory, the refresh token
  only in an HttpOnly cookie, a refresh that answers 409 is retried once.
- **An approved visual design.** A design canvas (v1.1) defines the brand, light and dark
  colour tokens, a type scale on Geist with tabular figures, a 4 px spacing scale, radii,
  elevation, motion tokens with exact easing curves, four breakpoints and 21 web artboards.

The design is a visual language, not a component library. The question is how to implement it
without building and maintaining a design system from scratch, which the product analysis warns
against.

## Decision

The web client is a single-page application with these parts.

| Concern | Choice |
|---|---|
| Build, dev server | Vite (existing) |
| Routing | TanStack Router, code-based route tree |
| Server state | TanStack Query |
| Components | shadcn/ui: Radix primitives whose source is copied into the app and styled with Costly's tokens |
| Styling | Tailwind CSS v4, reading the design tokens as CSS variables |
| Forms | react-hook-form with the zod resolver |
| Fonts | Geist and Geist Mono from the `geist` package, Noto Sans Armenian self-hosted |
| Motion | CSS transitions and the Web Animations API, driven by the motion tokens |
| Charts | Recharts, added with the first chart (not part of the foundation) |
| Tests | Vitest + Testing Library + user-event, MSW for the API, fast-check for money, Playwright for a few flows |

### Workspace packages

- **`packages/shared`** (the package the technical design already names). Framework-free
  TypeScript with no browser or Node dependency:
  - the money codec: a decimal string to `bigint` and back, with the same grammar the API
    enforces (`api-conventions.md`, Money), and the AMD display formatter;
  - the RFC 9457 problem-details type and parser;
  - zod schemas for the responses the web client reads;
  - the API client (below).
- **`packages/design-tokens`.** The design's tokens as one typed TypeScript object, and a build
  step that writes them as CSS custom properties for light and dark themes. A separate package
  because a second client (ADR-0011, if accepted) would read the same object.

The API keeps its request schemas in `apps/api` for now. Moving them into `packages/shared`
changes backend code, so it happens later and in agreement with the backend work. Until then the
web client writes its response schemas from `api-conventions.md`.

### API client

One `fetch` wrapper in `packages/shared`, no HTTP library. It:

- prefixes the base URL and sends `Authorization: Bearer` from an injected token store;
- turns every non-2xx response into a typed error carrying the problem details;
- validates every response body with its zod schema, so a malformed amount or a missing field
  becomes an error state, never a wrong number on screen;
- never logs request or response bodies, headers or tokens.

### Authentication

Implements the web client contract in `api-conventions.md`:

- The access token lives in a module variable, never in `localStorage`, `sessionStorage` or a
  cookie readable by script.
- On start the app calls `POST /auth/refresh` once. Success means a restored session; 401 means
  signed out.
- Refreshes are single-flight: concurrent callers wait for the one request in progress.
- A refresh that answers 409 is retried once, after a short delay.
- A request that answers 401 triggers one refresh and is replayed once. A second 401 signs the
  user out.
- Sign-out calls `POST /auth/logout`, clears the token and the whole query cache, and returns to
  the sign-in page.
- 429 shows the `Retry-After` wait. 503 says the service is temporarily unavailable.

### Server state and money

- TanStack Query owns everything that comes from the API. There is no client-side store
  (Redux, Zustand); the session is one React context.
- **Writes are not optimistic.** A create, update, archive or restore shows its pending state and
  updates the screen from the server's response. The server decides what is valid.
- **The client computes no financial figures.** It displays the amounts the API returns. It does
  not add opening balances into a total or derive a current balance; those arrive from the API
  when the ledger provides them. An account's `openingBalance` is always labelled as the opening
  balance.
- Amounts stay `bigint` from parsing to formatting. They are never converted to `number` for
  arithmetic. A tween in an animation may interpolate on numbers, but its last frame is the
  exact formatted value.

### Design tokens, theming and motion

- Tokens become CSS variables on `:root` and `[data-theme="dark"]`. Tailwind's theme maps to
  those variables, so components never contain raw hex values.
- The theme preference (system, light or dark) is the only thing kept in `localStorage`. An
  inline script in `index.html` applies it before the first paint, so there is no flash.
- Motion uses the design's tokens (`motion.instant` 100 ms through `motion.chart` 520 ms).
  Under `prefers-reduced-motion: reduce`, movement becomes an instant change or a short fade,
  and number count-ups are off.

### Structure of `apps/web/src`

```
app/        router, providers, application shell
features/   one folder per module: auth/, accounts/, later categories/, transactions/ …
ui/         the shadcn/ui primitives, styled with Costly tokens
lib/        web-only helpers
```

A feature folder holds its routes, queries, forms and tests. Features don't import from each
other's internals.

### Accessibility

WCAG 2.2 AA is a requirement, not polish. Radix supplies focus management and keyboard handling
for dialogs, menus and popovers. Every field has a label, errors are linked to their field and
announced, and the focus ring is the design's 2 px Cobalt ring. Playwright runs an axe check on
each page it visits.

### Not decided here

- How an amount with non-zero minor units (for example `"150050"`) is displayed. AMD has an
  exponent of 2 but is normally shown without decimals (ADR-0002). The rule is settled with the
  money formatter and recorded with it.
- Armenian UI, which the specification lists as optional.

## Rationale

- **shadcn/ui over Mantine.** Both satisfy "use a component library". Mantine brings its own
  visual language, and matching the approved design means overriding it component by component.
  shadcn/ui is Radix behaviour plus unstyled source in the repository, so the design's tokens
  apply directly and nothing has to be fought. The accessibility work (focus traps, roving
  focus, `aria` wiring) is still Radix's, which is the part not worth rebuilding.
- **Tailwind with CSS variables.** The design is already expressed as tokens. Utilities that
  read those tokens keep spacing and colour consistent without a separate stylesheet per
  component. The copied shadcn/ui source expects Tailwind.
- **TanStack Router.** Route parameters and search parameters are typed. Transaction filters,
  analytics periods and forecast horizons will live in the URL, where typed parsing prevents a
  class of bugs. It is from the same family as TanStack Query and loads route data through it.
- **No optimistic writes.** Ledger writes have server-side rules (unique names, archived
  parents, later the balance invariants) that the client cannot fully know. A wrong optimistic
  state followed by a rollback is worse in a finance product than 100 ms of a pending button.
- **No client arithmetic on money.** It keeps one authority for every figure (the API, and later
  `finance-math` behind it) and keeps rounding decisions out of the browser.
- **Validated responses.** The API is developed in parallel. If a response shape drifts, the
  client shows an error instead of rendering `undefined` or a mis-parsed amount.
- **Self-hosted fonts.** No request to a third-party font CDN on every page view, and the app
  works offline in development and at the defense.
- **No motion library.** The design's motion board specifies every animation as CSS or Web
  Animations API code. A library would add weight for nothing the design asks for.

## Consequences

- Two new workspace packages join the lint, typecheck, test and build that CI already runs
  through `pnpm -r`.
- shadcn/ui components are owned code: they are reviewed, tested and updated like any other
  source, not upgraded by bumping a version.
- Response schemas exist twice (API request and response code, web zod schemas) until they move
  into `packages/shared`. A changed API contract has to change both, and the web tests against
  MSW fixtures will not catch a backend change on their own. The Playwright tests run against the
  real API and do.
- A screen that needs a figure the API doesn't provide yet (a current balance, a total, a monthly
  net) waits for the API. The designs show such figures; the implementation shows only what
  exists.
- Every page reload costs one refresh request, as ADR-0006 already accepts.

## Alternatives Considered

**Mantine.** Complete and well documented, rejected because restyling it to the approved design
costs more than styling unstyled primitives.

**Radix primitives with CSS Modules, no Tailwind.** Workable, but every component needs its own
stylesheet that repeats the token values, and shadcn/ui's source could not be used as is.

**React Router.** Smaller and more familiar. Rejected for untyped search parameters, which the
filter-heavy screens of later chapters depend on.

**A client-state library (Redux Toolkit, Zustand).** There is no client state that isn't either
server state (TanStack Query) or the session (one context).

**Next.js or another server-rendered framework.** The API is a separate NestJS service, there is
no public content to index, and the specification names a Vite SPA.

**Axios.** Interceptors are convenient, but `fetch` plus one wrapper covers the same needs with
no dependency.

**Framer Motion.** Rejected for now: nothing in the design needs layout or gesture animation that
CSS cannot do. It can be reconsidered if a later screen does.

## References

- `../../00-planning/05-final-specification.md` §18 — technology stack
- `../../00-planning/01-product-and-feature-analysis.md` §3 and "What could become too difficult"
- `../../00-planning/03-technical-design.md` §2.1 — repository layout
- `../api-conventions.md` — money, errors, the web client authentication contract
- ADR-0002 (money), ADR-0006 (authentication), ADR-0011 (native mobile clients, proposed)
