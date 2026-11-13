# Contributing

Two developers, one Firebase project, one app people have installed. These rules keep us from
breaking each other or the live app. AI coding assistants follow them too (AGENTS.md and
CLAUDE.md point here).

## Branches

| Branch | What it is | Who changes it |
|---|---|---|
| `main` | Production: always the code that is in the stores | Only through a pull request from `v2`, merged by Dusko after a store release |
| `v2` | Staging: the next release, integrated | Only through pull requests, merged by Dusko (docs-only commits may go straight in) |
| `dev_dusko` | Dusko's work | Dusko |
| `dev_sven` | Sven's work (the executive assistant) | Sven |

- Nobody force-pushes to `main` or `v2` and nobody deletes them. GitHub Free offers no branch
  protection on a private repository, so this is a rule kept by hand.
- Before you open a pull request, merge `v2` into your branch and fix any conflict there, never
  on `v2`.
- After every release, `v2` is brought up to `main` (no code changes, it only clears the merge
  commits), and both developers merge `v2` into their branch.
- Hotfix for the live app: branch from `main` (or the release tag), open the pull request into
  `main`, then merge `main` back into `v2`. Never ship a hotfix from `v2` while it holds unfinished
  work.

## Pull requests

- Open every pull request into `v2` as a **draft** while you are still pushing to it. CI does not
  run on drafts. Click "Ready for review" when it is finished: CI runs once then. Every push to a
  ready pull request runs CI again, so convert it back to a draft for further work.
- CI must be green before merge: lint, type check, unit tests (and, for pull requests into
  `main`, the Android bundle with its secret scan) for the app; contract check, lint, type check,
  build and unit tests for `functions/`; the Firestore rules emulator tests.
- Run the same checks locally before pushing:
  - app: `npm run lint && npm run typecheck && npm test`
  - functions: `cd functions && npm run check:contract && npm run lint && npm run typecheck && npm test`
- One reviewer approves before merge. Dusko reviews and merges Sven's pull requests; Sven reviews
  Dusko's. Reviews happen within one working day.
- Keep a pull request to one topic. A changelog entry in `CHANGELOG.md` goes in the same pull
  request as the change.
- Do not run a formatter over files you did not change.

## CI minutes

The repository is private on GitHub Free: 2,000 Actions minutes a month for the whole account.
CI therefore runs only on pull requests into `v2` and `main` (not drafts), on pushes to `main`,
and by hand (Actions > CI > Run workflow). Pushes to `dev_dusko` and `dev_sven` and docs-only
changes run nothing. Add `[skip ci]` to a commit message to skip a run on purpose. One run takes
about 7 minutes; never raise the job timeouts or add Node versions to the matrix without asking.

## Shared files

Both of us add code to the same few files. Add only your own blocks there, never reorder or
reformat the rest, and resolve conflicts by keeping both sides:

- `functions/src/config.ts` (params and secrets), `functions/src/index.ts` (exports)
- `src/core/aiContract.ts` and its verbatim copy `functions/src/shared/aiContract.ts`: after any
  merge, copy the app file over the functions file and run `npm run check:contract` in
  `functions/`
- `src/core/contracts.ts`, `firestore.rules` and its tests, `firestore.indexes.json`
- `functions/src/deleteAccount.ts` (each feature adds its own deletion port)
- `src/navigation/*`, `src/i18n/resources.ts`, `src/screens/settings/SettingsScreen.tsx`

## Deploying (one shared Firebase project)

- Full deploys (`firebase deploy` or `--only functions` without names), Firestore rules and
  indexes are deployed only from `v2`, and only by Dusko.
- From a work branch, deploy only your own functions by name:
  `npx firebase deploy --only functions:name1,functions:name2` (from `functions/`).
- If the CLI offers to delete functions it does not know, answer **No**. They belong to the other
  developer's branch.
- Every secret declared anywhere in `functions/src` (defineSecret) is checked at every deploy, even
  for functions that are switched off. A secret that does not exist yet makes the CLI ask for a
  value: never type one at that prompt. Cancel, and create it the documented way (for example
  `printf '%s' "<value>" | npx firebase functions:secrets:set NAME`, so no newline is stored).
- `functions/.env.<projectId>` is not in git. Every developer who deploys needs every param line
  in his own copy, including the ones the other developer added; a missing line is prompted for,
  and fails a non-interactive deploy. Share non-secret values privately, never in the repo.
  Exception: the `MATTERS_*` lines (the assistant, SETUP 15.4) go only in the copy of the developer
  who deploys the matter functions (Sven) until the beta. The other developer leaves them out and
  answers No when the CLI offers to delete those five functions.
- New features ship switched off (an `*_ENABLED` param and, where needed, a pilot list) and are
  switched on only after review.

## Protected areas: always a second pair of eyes

Changes here need a reviewer even for a one-line fix, and the author says in the pull request
what was tested on a real phone:

- the alert engine: `src/services/alerts/**` and `modules/mg-fullscreen-alarm/**`
- the AI contract and its server mirror: `src/core/aiContract.ts`, `functions/src/shared/aiContract.ts`,
  plus the server copies of `src/core/errors.ts`, `time.ts` and `recurrence.ts` in `functions/src/shared/`
  (each copy must stay identical; `npm run check:contract` in `functions/` verifies all four)
- Firestore rules and indexes: `firestore.rules`, `firestore.indexes.json`
- everything under `functions/` (billing webhooks, WhatsApp, the assistant handler, admin callables,
  the meeting summaries in `functions/src/summaries/`, the executive assistant's matters in
  `functions/src/matters/`)

## Secrets and credentials

- Never commit a secret, token, key or password. Never paste one into chat or a screenshot.
- Server secrets live in Firebase Secret Manager; the app receives only `EXPO_PUBLIC_*` values
  through EAS environment variables. The CI secret scan fails the build if a key-like value
  reaches the bundle.
- Console setups (Firebase, Play, App Store Connect, RevenueCat, Meta, Azure, Google Cloud) are
  documented in `docs/v1/SETUP.md`. That file is the source of truth; update it when a console
  step changes.

## Dependencies

- Pin new packages to an exact version that has been out for at least two weeks.
- Never run `npm audit fix --omit=dev`: it removes the dev dependencies (jest, eslint) from the
  lock file.

## Releases

- A store build is needed when native code or native config changes; JS-only changes ship over
  the air. The runbook is `docs/v1/DEPLOYMENT.md`.
- Store builds are made from `v2`. Only Dusko presses publish. Android rolls out staged; iOS is
  released manually after approval.
- After the stores publish: tag the exact build commits (`vX.Y.Z-android`, `vX.Y.Z-ios`), open the
  `v2` to `main` pull request and merge it with "Create a merge commit" (never squash, or the two
  branches stop sharing history), then bring `v2` up to `main`.
- Every rebuilt test APK or AAB gets a new time-stamped file name; never overwrite a delivered
  artifact.

## Product text

- English and Spanish for every user-facing string, in `src/i18n/`.
- Plain punctuation in product text: no em dashes, en dashes, ellipsis characters or curly
  quotes. The same applies to admin and assistant output.

## Where things are

- `docs/v1/ARCHITECTURE.md`: how the app, functions and admin fit together.
- `docs/v2/TEST-GUIDE-STAGE1.md`: the device test guide; extend it when you add a feature.
- `docs/v2/M10-DESIGN.md`: the meeting summaries design (M10).
- `docs/v2/Milestones-2026-10-26.docx`: the milestone plan.
