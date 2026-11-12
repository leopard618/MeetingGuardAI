# Contributing

Two developers, one release. These rules keep us from breaking each other or the app people
have installed.

## Branches

- `v2` is the integration branch. Releases are built from it.
- Work on a branch named `<you>/<topic>` (for example `sven/website-build`, `dusko/outlook-sync`)
  and open a pull request into `v2`.
- Nobody force-pushes to `v2` and nobody deletes it. The repository plan does not offer branch
  protection on a private repository, so this is a rule kept by hand; CI runs on every push and
  pull request and a red run on `v2` is fixed before anything else.

## Pull requests

- Every change goes through a pull request with the full check set green: the GitHub Actions
  workflow runs lint, type check, unit tests and the Android bundle secret scan for the app, and
  contract check, lint, type check, build and unit tests for `functions/`, plus the Firestore
  rules emulator tests.
- Run the same checks locally before pushing:
  - app: `npm run lint && npm run typecheck && npm test`
  - functions: `cd functions && npm run check:contract && npm run lint && npm run typecheck && npm test`
- One reviewer approves before merge. Dusko reviews Sven's pull requests; Sven reviews Dusko's.
  Reviews happen within one working day.
- Keep a pull request to one topic. A changelog entry in `CHANGELOG.md` goes in the same pull
  request as the change.
- Do not run a formatter over files you did not change.

## Protected areas: always a second pair of eyes

Changes here need a reviewer even for a one-line fix, and the author says in the pull request
what was tested on a real phone:

- the alert engine: `src/services/alerts/**` and `modules/mg-fullscreen-alarm/**`
- the AI contract and its server mirror: `src/core/aiContract.ts`, `functions/src/shared/aiContract.ts`
  (they must stay identical; `npm run check:contract` in `functions/` verifies it)
- Firestore rules and indexes: `firestore.rules`, `firestore.indexes.json`
- everything under `functions/` (billing webhooks, WhatsApp, the assistant handler, admin callables)
- the executive assistant's matter engine, once it exists

## Secrets and credentials

- Never commit a secret, token, key or password. Never paste one into chat or a screenshot.
- Server secrets live in Firebase Secret Manager; the app receives only `EXPO_PUBLIC_*` values
  through EAS environment variables. The CI secret scan fails the build if a key-like value
  reaches the bundle.
- Console setups (Firebase, Play, App Store Connect, RevenueCat, Meta, Azure, Google Cloud) are
  documented in `docs/v1/SETUP.md`. That file is the source of truth; update it when a console
  step changes.

## Releases

- A store build is needed when native code or native config changes; JS-only changes ship over
  the air. The runbook is `docs/v1/DEPLOYMENT.md`.
- Only Dusko presses publish. Android rolls out staged; iOS is released manually after approval.
- Every rebuilt test APK or AAB gets a new time-stamped file name; never overwrite a delivered
  artifact.

## Product text

- English and Spanish for every user-facing string, in `src/i18n/`.
- Plain punctuation in product text: no em dashes, en dashes, ellipsis characters or curly
  quotes. The same applies to admin and assistant output.

## Where things are

- `docs/v1/ARCHITECTURE.md`: how the app, functions and admin fit together.
- `docs/v2/TEST-GUIDE-STAGE1.md`: the device test guide; extend it when you add a feature.
- `docs/v2/Milestones-2026-10-26.docx`: the current milestone plan.
