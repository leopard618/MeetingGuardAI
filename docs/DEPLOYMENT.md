# Deployment and rollback

Short runbook for shipping MeetingGuard AI: store builds (EAS Build), over-the-air JavaScript updates (EAS Update) and the Firebase backend. Architecture: `docs/ARCHITECTURE.md` §15.

## Channels and versions

| EAS build profile | Channel | Distribution | Use |
|---|---|---|---|
| `development` | `development` | internal APK / dev client | day-to-day development |
| `preview` | `preview` | internal APK / ad hoc | QA before a release |
| `production` | `production` | Play Store AAB / App Store | users |

- `runtimeVersion` follows `version` in `app.config.js` (policy `appVersion`). An update published for 1.1.0 only reaches 1.1.0 binaries.
- Android `versionCode` / iOS `buildNumber` are managed by EAS (`appVersionSource: remote`, auto-incremented for `production`).
- `EXPO_PUBLIC_*` values live in EAS environment variables (`development`, `preview`, `production`). Builds and updates both read the environment of their profile; `.env` files are never uploaded.

## What needs a store build, what can be an OTA update

- **OTA update** (`eas update`): JavaScript and assets only: screens, texts and translations, logic in `src/`, images already known to the app.
- **Store build** (`eas build`, then `eas submit`): anything native. A new or upgraded native module (`npx expo install ...`), an Expo SDK upgrade, a permission, a config-plugin option, the app icon or splash, `app.config.js` native fields. **Bump `version` first**, so the new binary gets a new runtime and old binaries never receive JS that expects the new native code.

## Release checklist

1. On a clean checkout: `npx tsc --noEmit`, `npm run lint`, `npm test`, `cd functions && npm run build && npm test && npm run lint && npm run check:contract`, `npx expo export --platform android --output-dir <tmp>`, `npx expo-doctor`.
2. Before the first store release: fill `LEGAL_ENTITY` in `src/screens/legal/legalContent.ts`, `legal:jurisdiction` in both `legal.json` files and the support e-mail in `public/delete-account.html`; have the legal texts reviewed.
3. Backend first when the app depends on it: `firebase deploy --only functions,firestore:rules,firestore:indexes` (see README "Firebase backend").
4. `eas build --profile preview --platform android` (and `ios`), install, run the QA pass (sign-in, Google and device calendar sync, alerts at max / medium / light, EN / ES, offline edits, assistant).
5. `eas build --profile production --platform all` and `eas submit --profile production`. Roll out in stages (Play Console staged rollout, App Store phased release).
6. Tag the commit (`git tag v1.1.0`) so a rollback knows what "last good" is.

## Shipping an OTA fix

```bash
npm run update:preview -- "Fix: <what changed>"      # test on a preview build
npm run update:production -- "Fix: <what changed>"   # same commit, after QA
```

The scripts run `eas update --channel <name> --environment <name> --message <text>`. Devices download the update in the background at the next cold start (`checkAutomatically: ON_LOAD`) and run it from the following cold start (`fallbackToCacheTimeout: 0`: a launch never waits for the network). Settings shows the running update ("Update 1a2b3c4d · production"); Sentry events carry the update id.

## Rollback

**Automatic.** If a downloaded update crashes before it finishes launching, expo-updates starts the previous working bundle (emergency launch). The app reports it to Sentry at start ("emergency launch ..."). Treat that as a signal to roll back the channel for everyone.

**Bad OTA update** (pick one, then verify on a device and in Sentry):

- `eas update:republish --group <last-good-group-id>`: publishes the last good update again as the newest one on the branch (find the id with `eas update:list --branch production`).
- `eas update:roll-back-to-embedded --branch production`: every device goes back to the JavaScript embedded in its binary.
- Or fix forward: revert the commit and `npm run update:production -- "Revert <what>"`.

**Bad store build.** Halt the staged rollout (Play Console) or pause the phased release (App Store). A published binary cannot be downgraded: build the last good tag with `version` unchanged (or a patch version when native code changed), let EAS increment the build number, and submit it. Users who already have the bad binary keep receiving OTA updates for its runtime, so a JS-only problem can also be fixed with an update on that runtime.

**Backend.** Cloud Functions: check out the last good tag and `firebase deploy --only functions`. Firestore rules: redeploy the previous `firestore.rules` (or use the rules history in the Firebase console). The callable contract (`functions/src/shared/aiContract.ts`) must stay compatible with every app version still in use: add fields, do not rename or remove them.
