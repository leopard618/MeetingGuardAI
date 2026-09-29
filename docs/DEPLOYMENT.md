# Deployment and rollback (Milestone 5)

This runbook covers shipping MeetingGuard AI:

- store builds (EAS Build + Submit)
- over-the-air JavaScript updates (EAS Update)
- the Firebase backend, backups, monitoring and the Play Console declarations

The one-time setup is in `docs/SETUP.md`, the tests in `docs/TESTING.md`, and the design in
`docs/ARCHITECTURE.md` §15.

## 1. Build profiles and update channels

| `eas.json` profile | Channel | Output | Signed with | Use |
|---|---|---|---|---|
| `development` | `development` | APK with the dev client | EAS upload key | Daily development with `npm start` |
| `preview` | `preview` | APK, internal distribution | EAS upload key | QA before a release. It cannot update an app installed from Play (different signature). |
| `production` | `production` | AAB (Android) / IPA (iOS) | Play app signing key (after upload) | Play tracks and the App Store |

- **Runtime version.** `runtimeVersion` follows `version` in `app.config.js` (policy `appVersion`).
  An OTA update for 1.1.0 only reaches 1.1.0 binaries.
- **Build numbers.** EAS keeps `versionCode` / `buildNumber` (`appVersionSource: "remote"`), and
  `production` adds 1 before each build. Check with `eas build:version:get -p android`.
- **Environment.** Every build and every update reads the `EXPO_PUBLIC_*` values of its EAS
  environment (`docs/SETUP.md` §5.2).
- **Shared channel.** The internal testing track and production users of the same version share the
  `production` channel. Test OTA updates on a `preview` build first.

## 2. Store build or OTA update?

- **OTA update** (`eas update`): only JavaScript and assets. Examples: screens, texts, translations,
  logic in `src/`, bundled images.
- **Store build** (`eas build` + `eas submit`): everything native. Examples:
  - a new or upgraded native module (`npx expo install ...`), or an Expo SDK upgrade
  - a permission, a config-plugin option or other native fields in `app.config.js`
  - the icon or the splash screen

  **Raise `version` first**, so the new binary gets a new runtime. Old binaries then never receive JS
  that needs the new native code.

## 3. Android flow: internal testing -> production

Run these from the repository root.

1. Pass every check in §4 step 1.
2. If the app needs backend changes, deploy the backend first (§6).
3. Build and upload:

   ```bash
   eas build --profile production --platform android
   eas submit --profile production --platform android --latest
   ```

   `eas.json` sends the upload to the **internal** track. The first production build gets
   versionCode 21.
4. Play Console -> Test and release -> Testing -> **Internal testing** -> Testers:
   1. Add the tester emails.
   2. Copy the join link and send it to the testers.
   3. Each tester opens the link, accepts, and installs or updates the app from Google Play.
5. Run the device plan in `docs/TESTING.md` on this build. It includes the upgrade from v1.0.9 and a
   low-end phone.
6. **Promote:** Internal testing -> the release -> Promote release -> Production (or a closed track
   first).
   - Use a **staged rollout**: 10% -> 50% -> 100%.
   - At each step, wait 24 to 48 hours and watch §8.

## 4. Production release checklist

1. The checks pass on a clean checkout:
   - `npx tsc --noEmit`
   - `npm run lint`
   - `npm test`
   - `npx expo export --platform android --output-dir <tmp>`
   - `npx expo-doctor`
   - in `functions/`: `npm run build`, `npm test`, `npm run lint`, `npm run check:contract`
   - `npm run test:rules` (CI runs it; locally it needs Java 21)
2. Legal and support:
   - `LEGAL_ENTITY` is filled in `src/screens/legal/legalContent.ts`, and `legal:jurisdiction` in both
     `src/i18n/locales/{en,es}/legal.json`.
   - A lawyer has reviewed both texts.
   - The support email replaces the placeholder in `public/delete-account.html`.
   - The privacy policy has a public URL.
3. `docs/SETUP.md` §9 is complete. The functions and rules are deployed (§6). Backups are on (§7).
4. `eas env:list --environment production` shows every required value, plus
   `EXPO_PUBLIC_SENTRY_DSN`. `eas build:version:get -p android` is 20 or higher.
5. Play Console -> App content is complete (§9).
6. The internal-testing QA passed, including the v1.0.9 upgrade. The release notes (EN + ES) say that
   users must sign in again with Google.
7. Tag the released commit: `git tag v1.1.0`. A rollback then knows what "last good" is.

## 5. OTA updates

```bash
npm run update:preview -- "Fix: <what changed>"       # install and test on a preview build
npm run update:production -- "Fix: <what changed>"    # the same commit, after QA
```

- **What the scripts run:** `eas update --channel <name> --environment <name> --message <text>`. For a
  gradual update, call eas directly with `--rollout-percentage <1-100>`.
- **When devices get it:** a device downloads the update in the background at a cold start
  (`checkAutomatically: ON_LOAD`). It runs the update from the **next** cold start
  (`fallbackToCacheTimeout: 0`), so a launch never waits for the network.
- **How to see it:** Settings shows "Update <id> · <channel>". Sentry events carry the tags
  `expo.updates.update_id`, `expo.updates.channel` and `expo.updates.runtime_version`.
- **Sentry source maps:** after an update, run `npx sentry-expo-upload-sourcemaps dist`
  (`docs/SETUP.md` §7).
- **Old versions:** OTA only reaches binaries that contain `expo-updates`, which means 1.1.0 and
  later. v1.0.9 users must install the store update first.

## 6. Backend deploy and rollback

Run these in `functions/`.

| Action | Command |
|---|---|
| Deploy functions (lint, contract check and build run first) | `npm run deploy` |
| Deploy Firestore rules + indexes | `npm run deploy:rules` |
| Deploy the account deletion page | `npx firebase deploy --only hosting` |
| Read the function logs | `npm run logs` |

- **Compatibility rule:** the callable contract (`src/core/aiContract.ts`, copied to
  `functions/src/shared/aiContract.ts`) must work with every app version still in use:
  - Add fields; never rename or remove them. A new request field must be optional, because older
    apps do not send it (the server strips request fields it does not know).
  - **Actions:** from 1.1.0 the app validates each proposed action on its own and drops (and logs)
    one it does not understand, so a new action kind, or a new enum value inside an action, does
    not break older installs. Their users simply do not get that card, although the request still
    counts against the quota, so make the reply text make sense without it.
  - **Everything else in the response** (`reply`, `suggestions`, `usage`, including `usage.plan`)
    is validated strictly. A new enum value there (a new plan, for example) makes every older
    install show an error. Send such values only to app versions that declare support for them:
    first add an optional request field (for example `clientVersion` or `capabilities`), ship it in
    a store release, then gate the new value on it.
- **Functions rollback:**
  1. Check out the last good tag in a separate folder: `git worktree add ../mg-last-good v1.1.0`.
  2. Copy `.firebaserc` and `functions/.env.<project-id>` into it (both are git-ignored).
  3. In its `functions/` folder, run `npm ci`, then `npm run deploy`.
  4. For an emergency: every v2 function is a Cloud Run service. In the Cloud Run console, send 100%
     of traffic to the previous revision. The next deploy replaces that.
- **Rules rollback:** Firebase console -> Firestore -> Rules shows the history, and you can publish an
  older version there. Or restore the file from git, then run `npm run deploy:rules`:

  ```bash
  git checkout <last-good-tag> -- firestore.rules
  ```

## 7. Firestore backups

Set these up once per project. The `npx firebase ...` commands were checked with the pinned
firebase-tools 15.32.0; run them in `functions/`.

```bash
# Point-in-time recovery (7 days, minute steps) and protection against deleting the database
npx firebase firestore:databases:update "(default)" --point-in-time-recovery ENABLED --delete-protection ENABLED
# Daily backup kept for 14 days (the maximum retention is 14 weeks)
npx firebase firestore:backups:schedules:create --recurrence DAILY --retention 14d
npx firebase firestore:backups:schedules:list
npx firebase firestore:backups:list
```

The `gcloud` equivalent of the daily backup schedule:

```bash
gcloud firestore backups schedules create --database="(default)" --recurrence=daily --retention=14d
```

Before a risky data change, also make a manual export to a Cloud Storage bucket in the same location:

```bash
gcloud firestore export gs://<bucket>/manual-<date>
```

**Restore.** A restore always creates a **new** database, and the app keeps using `(default)`:

1. Pick the source:
   - A backup: `npx firebase firestore:backups:list`, then
     `npx firebase firestore:databases:restore --database restore-<date> --backup <backup-name>`.
   - A point in time:
     `npx firebase firestore:databases:clone "(default)" restore-<date> --snapshot-time 2026-10-01T09:00:00Z`.
2. Check the data in the console. The database picker is at the top of the Firestore page.
3. Copy back what you need:
   - `gcloud firestore export gs://<bucket>/restore-<date> --database=restore-<date>`
   - then `gcloud firestore import gs://<bucket>/restore-<date>/<export-folder> --database="(default)"`

   An import overwrites documents with the same path and does not delete other documents.
4. Delete the temporary database: `npx firebase firestore:databases:delete restore-<date>`.

gcloud was not available when this runbook was written, so check the flags of the `gcloud` lines with
`--help` before you depend on them.

## 8. Monitoring

- **Sentry** (production environment):
  - New issues and the crash-free rate per release.
  - Filter by `expo.updates.update_id` after an OTA update.
  - The message "emergency launch: the latest update failed to start" means a bad OTA update: roll
    it back (§10).
- **Firebase / Google Cloud:**
  - Functions -> error rate and logs (`npm run logs`).
  - Firestore -> Usage.
  - Authentication -> Users.
  - Create a Cloud Monitoring alert on function errors, and a billing budget alert.
- **OpenAI:** set a monthly usage limit on the project. `ASSISTANT_GLOBAL_DAILY_LIMIT` stops requests
  after the daily total.
- **Play Console:** Android vitals (crash and ANR rates) and the pre-launch report of every upload.

## 9. Play Console declarations (App content)

- **Permissions.**
  - The app requests `SCHEDULE_EXACT_ALARM`, which the user grants in "Alarms & reminders". It does
    not request `USE_EXACT_ALARM`.
  - If Play asks about exact alarms, the core feature is **user-set meeting alerts** (calendar /
    alarm).
  - The app has no foreground service and no full-screen intent. `RECORD_AUDIO`, `READ_CONTACTS` and
    `SYSTEM_ALERT_WINDOW` are blocked in `app.config.js`.
  - Libraries can add permissions at build time, so check the final list in Play Console -> App
    bundle explorer before you answer the forms.
- **Data safety.** Confirm each answer against the final privacy policy:
  - Collected:
    - Personal info: name and email address (the Google account; account management).
    - Calendar events: meetings, including participant names and emails (app functionality).
    - Other user-generated content: notes, and assistant messages (sent through our server to OpenAI
      for processing).
    - App info and performance: crash logs and diagnostics (Sentry, when the DSN is set).
  - Not collected: attachments stay on the phone.
  - Data is encrypted in transit.
  - Users can delete their account and data.
- **Account deletion.**
  - In the app: Settings -> Account -> Delete account.
  - Web URL: `https://<project-id>.web.app/delete-account` (`public/delete-account.html`, deployed in
    §6).
- **App access:** reviewers must sign in with Google. Give them a test Google account and the steps.
- Also complete: the privacy policy URL, Ads (the app shows none), the content rating and the target
  audience.

## 10. Rollback

**Automatic protection.** If a downloaded update crashes before it finishes starting, expo-updates
starts the previous working bundle ("emergency launch"). The app reports it to Sentry. Treat that as a
signal to roll the channel back for everyone.

**Bad OTA update.** Choose one option, then check on a device and in Sentry:

- `eas update:rollback`: pick the bad update group. EAS publishes the update before it again, or the
  embedded bundle if there is none.
- `eas update:republish --group <last-good-group-id>`: publish a known good group again. Find the id
  with `eas update:list --branch production`.
- `eas update:roll-back-to-embedded --channel production`: every device goes back to the JavaScript
  inside its binary.
- Fix forward: revert the commit, then `npm run update:production -- "Revert <what>"`.

Devices download the rollback at the next cold start and run it at the start after that.

**Bad store build.** Play never accepts a lower versionCode, so a rollback is a **new** build of the
old code:

1. Play Console -> the release -> **Halt rollout**. Users who already updated keep the bad build. For
   iOS, pause the phased release.
2. Check out the last good tag and keep its `version` (the same runtime). Use a new patch version only
   if the native code differs.
3. Run `eas build --profile production --platform android`. EAS gives it a higher versionCode.
4. Submit the build and roll it out.

If the problem is JavaScript only, an OTA update to the bad binary's runtime also fixes it.
