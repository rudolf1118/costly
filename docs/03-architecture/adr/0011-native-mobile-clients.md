# ADR-0011: Native iOS and Android clients

Status: Proposed
Date: 2026-11-13

> This ADR revisits an item on the out-of-scope list. It stays Proposed until the supervisor
> agrees, because the specification that excludes native mobile was agreed with the supervisor.
> If it is rejected, nothing built for the web is affected.

## Context

The specification excludes a native mobile app (`05-final-specification.md` §9). The product
analysis lists it on the out-of-scope firewall with the reason "a responsive web UI is enough"
(`01-product-and-feature-analysis.md` §3), and says that revisiting any item needs a written
reason in an ADR. The supervisor specification describes a web application.

Since then, three things have changed:

- **The approved design includes native mobile.** The design canvas (v1.1) has 19 artboards for
  iOS and Android at 390 pt: welcome, sign-in, home, accounts, activity, add transaction,
  insights, forecast, what-if, goals and settings, with platform conventions (tab bar with a
  central add button, sheets, large titles, swipe actions, haptics) and native motion specs.
- **The main input moment is on the phone.** Costly's analysis and forecasts are only as good as
  the recorded history. A transaction is easiest to record right after paying, and that happens
  away from a desk. The design's mobile add-transaction screen (amount first, keypad, last-used
  category pre-selected) is built for exactly that.
- **The web client is being built so that a second client is cheap** (ADR-0010): money
  formatting, problem details, the API client, response schemas and design tokens live in
  framework-free workspace packages.

What has not changed: Costly is a single-student diploma project from October 2026 to June
2027, the product analysis names the frontend as the largest time risk, and every chapter has a
fixed list of screens to deliver.

## Decision (proposed)

Add a native mobile client for iOS and Android, built with Expo (React Native), as a
**secondary** client that follows the web.

### Scope

- **The web stays the primary client.** It implements every feature first, it is what the
  defense demonstrates, and the system is complete without the mobile app.
- **Mobile follows feature by feature, in this order:** sign-in and session restore, home,
  accounts, then recording and browsing transactions. Analytics, forecast, what-if and goals
  screens come only if the chapter's web work is finished.
- **Still excluded:** push notifications (they stay on the out-of-scope list), offline mode or a
  local database, and publishing to the App Store or Google Play. The app runs as a development
  or locally built release on simulators, emulators and the author's own device.

### Technology

| Concern | Choice |
|---|---|
| Framework | Expo (React Native) with TypeScript, in `apps/mobile` |
| Navigation | Expo Router: a tab bar, stacks inside tabs, native sheets for forms |
| Server state | TanStack Query, as on the web |
| Shared code | `packages/shared` and `packages/design-tokens` (ADR-0010); no shared UI components |
| Animation | React Native Reanimated and Gesture Handler, following the design's motion specs |
| Session storage | `expo-secure-store` (iOS Keychain, Android Keystore) |
| Tests | jest-expo with React Native Testing Library; Maestro for a few end-to-end flows |
| Builds | Local (`expo run:ios`, `expo run:android`); no cloud build service |

Screens are written separately for each client. Sharing UI components between React DOM and
React Native would mean either a cross-platform component layer or giving up native controls,
and the design treats the two as different products with one identity.

### Authentication: what the backend must provide

The web transport from ADR-0006 does not work for a native app. The refresh token travels only
in an HttpOnly, `SameSite=Strict` cookie, which a native client can't store in secure storage,
and React Native's cookie handling is not dependable across platforms.

A native client therefore needs a way to receive and present the refresh token **without a
cookie**: returned in the response body at login and refresh, and sent explicitly when
refreshing and logging out. Everything else in ADR-0006 must still hold for it: rotation, one
successful use per token, reuse detection, the 10-second concurrent-refresh window, the absolute
30-day session lifetime and the rate limits. Because nothing is sent automatically, the CSRF
defences (SameSite and the Origin check) don't apply to that transport, and the cookie
transport for browsers stays exactly as it is.

This ADR states the requirement only. The endpoint design is a backend decision recorded in its
own ADR, which amends ADR-0006. Until it exists, the mobile app gets no authentication work.

On the device:

- The refresh token is stored only in `expo-secure-store` with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so it is excluded from backups and doesn't move to another
  device. The access token stays in memory.
- Refreshes are single-flight across the app, and the session is restored on launch and checked
  again when the app returns to the foreground.
- Logout deletes the stored token even if the network call fails.
- No token, password or response body is ever logged, including in development.
- Deep links never carry credentials, and a deep link into a protected screen goes through the
  same session check as any other navigation.

### Testing and CI

Lint, typecheck and the jest-expo unit and component tests run in the existing CI job.
Expo's React Native test preset requires Jest, so `apps/mobile` is the one workspace that uses
Jest instead of Vitest. Maestro flows need a simulator and run locally before a release, not in
CI.

## Rationale

- **Expo over separate Swift and Kotlin apps.** One TypeScript codebase for both platforms that
  reuses the shared packages, the same language as the rest of the system, and native
  navigation, sheets and secure storage. Two native codebases would double the mobile work
  for a single student.
- **Native over a WebView wrapper.** A wrapper would show the web client in a frame: no native
  sheets, tab bar, keyboard handling, haptics or secure storage, which are exactly what the
  mobile design specifies.
- **Secondary, never ahead of the web.** It keeps the time risk bounded: if mobile falls behind,
  the system and the thesis are still complete. Mobile can never become a reason a chapter's
  core feature is late.
- **Secure storage over cookies on mobile.** Keychain and Keystore are the platforms' intended
  place for long-lived credentials, protected by the device lock and excluded from backups.

## Consequences

- If accepted, the out-of-scope item "native mobile app" is lifted for this limited scope. The
  specification itself stays frozen, as every change to it goes through ADRs.
- The backend gains a second refresh-token transport, with its own tests, rate limits and
  security review. Until that lands, mobile work stops at the foundation (navigation, tokens,
  primitives).
- A second UI implementation of each screen. The API client, schemas, formatting and tokens are
  shared, so the estimate is about half the web effort per feature; the first features will
  show whether that holds.
- A third test toolchain (Jest) and a mobile toolchain (Xcode, Android SDK) in development. pnpm's
  isolated `node_modules` layout has to work with Metro, which the first mobile change verifies
  before anything else.
- The thesis gains a section on a second client built on the same API and shared packages, and
  on the security trade-off between the two token transports.

## Alternatives Considered

**Responsive web only (the current decision).** Costs nothing extra and the design already covers
390 px mobile web. It loses native input (keypad sheet, haptics, swipe actions), the tab bar and
secure session storage. It remains the fallback: if this ADR is rejected, the web's responsive
layouts are the mobile experience.

**An installable progressive web app.** Much cheaper than native and keeps the web's cookie
transport unchanged. Rejected because the mobile design depends on native sheets and gestures
that a PWA only imitates, and iOS limits PWAs in storage lifetime and system integration. It is
the strongest alternative, and the right one if the time budget turns out too tight.

**Separate Swift (iOS) and Kotlin (Android) apps.** The most native result, at twice the code
in two more languages, and none of the shared packages could be reused.

**Flutter.** Good native quality from one codebase, but in Dart: the shared TypeScript packages
would have to be rewritten, and money handling would exist in two languages.

**Capacitor or another WebView wrapper.** Rejected for the reasons in Rationale.

## References

- `../../00-planning/05-final-specification.md` §9 — explicitly excluded
- `../../00-planning/01-product-and-feature-analysis.md` §3 — the out-of-scope firewall
- `../../00-planning/04-roadmap-experiments-defense.md` — chapter calendar and risks
- `../api-conventions.md` — the web client authentication contract
- ADR-0006 (authentication), ADR-0010 (web client architecture)
