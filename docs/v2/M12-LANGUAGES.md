# M12. The languages: Portuguese, French and German, and the Hindi and Mandarin verdicts

Design and acceptance page for milestone M12 (Project-Plan-2026-11-09.md section 2, USD 550,
about 2 weeks). It records what M12 delivers, the decisions it rests on, what stays out, how
acceptance is shown and the deploy order. Companion pages in this folder:

- `M12-STORE-LISTINGS.md`: the store texts in every language, counted.
- `RELEASE-1.7.0-LANGUAGES.md`: the console steps for the new localizations.
- `TEST-GUIDE-M12.md`: the device pass in Portuguese, French and German.
- `M12-VERDICT-HINDI.md` and `M12-VERDICT-MANDARIN.md`: the protocol and the verdict forms.
- `M12-WEBSITE-LANGUAGES.md`: the brief for Sven (the localized website pages).

## 1. Scope

Portuguese, French and German everywhere the user meets the app, to the same standard as
Spanish:

- Interface: every screen, dialog, toast and error, in the five languages en, es, pt, fr, de.
- Speaking and listening: the in-app AI assistant (the meeting and task chat, Dusko's code)
  understands requests and answers in the app language, by text and by voice; the agenda is read
  aloud in the right voice; yes and no to a card by voice.
- Confirmation cards, reminders and notifications: meeting alerts, snooze, follow-up, the daily
  briefing (also full screen), task reminders, the status notification, channels and action
  buttons, the alarm screens and the voice readout.
- Dates: names of days and months, 24-hour times by default, and the first day of the week of
  each language (Sunday in Brazilian Portuguese, Monday in French and German).
- Server texts: the WhatsApp bot, the M11 commitment lists over WhatsApp, the task origin lines,
  the meeting summary screens and the emails the server sends.
- Native: the iOS permission prompts (src/i18n/native/<lang>.json through the Expo `locales`
  config), the per-app language list on iOS and Android (expo-localization `supportedLocales`),
  and the widget's fallback strings (modules/mg-next-meeting-widget res/values-pt, -fr, -de).
- Legal: the in-app Privacy Policy and Terms of Service, and the hosted delete-account page
  (public/delete-account.html).
- Store listings in the new languages, on the App Store and Google Play.
- Hindi and Mandarin: tested with real mixed speech, each with a written verdict. They are not
  added as app languages.

## 2. Decisions

| # | Decision | By, when |
|---|---|---|
| 1 | Portuguese is Brazilian Portuguese (pt-BR), under the language code `pt`. French is France French (`fr`), German is Germany German (`de`). The app ships one `pt`, `fr` and `de` (i18n `load: 'languageOnly'`), and the store localizations match: Portuguese (Brazil), French, German. | Owner, November 2026 |
| 2 | Address forms: "você" in Portuguese, "vous" in French, "Sie" in German, consistently. One glossary for every translator (the M12 task glossary: Meeting = reunião / réunion / Besprechung, Alert = alerta / alerte / Alarm, and so on). | Owner |
| 3 | The in-app Privacy Policy and Terms are translated, with a line that the English version prevails, MARKED FOR REVIEW: Francisco and counsel confirm the clause and the consumer-language rules of France and Germany before the texts are final. | Owner; legal review open |
| 4 | Sven's executive assistant (matters: functions/src/matters, src/screens/matters, src/services/matters, the `matters` namespace) stays English and Spanish. Its namespace falls back to English in pt, fr and de. Nothing in it is translated or changed by M12 (Project-Plan-2026-11-09.md section 4: "it does not follow the app into Portuguese, French and German"). | Agreed November 10 |
| 5 | Meeting summary screens, task origin lines and the WhatsApp commitment lists are translated. The READING of notetaker recaps written in Portuguese, French or German is not in scope: the parser's headings and lexicons stay English and Spanish (M11-DESIGN.md "Not M11"; summary headings EN and ES, M10 section 8). | Owner |
| 6 | WhatsApp commitment trigger words: `compromissos` (pt), `engagements` (fr), `zusagen` (de), next to the English and Spanish ones. | Owner |
| 7 | Product text rule in every language: no em or en dashes, no ellipsis character, no curly quotes, no German low quotes (U+201E, U+201A), no non-breaking spaces. French keeps a plain space before ":", "?", "!" and ";". Guillemets are not used. Enforced by src/i18n/__tests__/noTypographicChars.test.ts (now also over public/, which holds the delete-account page) and nativeStrings.test.ts. | Team rule (AGENTS.md rule 8) |
| 8 | Hindi and Mandarin get a verdict, not a translation. A language judged "not good enough to ship" is replaced by work of similar size or by a price adjustment, agreed in writing (Complete-Plan-2026-11-10.md; Consolidated-Schedule-2026-10-27.docx, the language rule). | Agreed |
| 9 | M12 ships with the 1.7.0 store build: the language list and the iOS permission strings are native configuration, so they never travel as an OTA update onto 1.6.x. | Technical |

## 3. Out of scope

- The executive assistant (matters, email, A1 to A10) in Portuguese, French or German.
- Reading notetaker recaps written in Portuguese, French or German (detecting the headings, the
  owners and the dates in them). Such a recap is still stored and shown; the commitment proposals
  come from English and Spanish recaps.
- Hindi and Mandarin as app languages (only the verdicts).
- Portuguese (Portugal), French (Canada) and other variants as separate languages.
- The full test guide in every language (M13) and the final test pass in every language (M14).
- Firebase Authentication's own emails (verification, password reset): localized by Firebase when
  the app sets the auth language; the console templates are checked separately.

## 4. Acceptance

The agreement lines, word for word.

Project-Plan-2026-11-09.md, M12: "Portuguese, French and German everywhere: interface, speaking,
listening, confirmation cards, reminders, dates and the store listings. Hindi and Mandarin tested
with real mixed speech, each with a written verdict."

Consolidated-Schedule-2026-10-27.docx, the two milestones M12 joins:

- "Portuguese everywhere: interface, speaking, listening, confirmation cards, reminders, dates,
  the store listing. Hindi tested with real mixed Hindi and English speech and a written verdict
  on whether it is good enough to ship." Shown by: "A complete Portuguese voice flow (create,
  move, cancel, agenda aloud) on a phone; the Hindi findings in writing."
- "French and German to the same standard as Portuguese; the written Mandarin verdict. Store
  listings in the new languages." Shown by: "A complete French and a complete German voice flow
  on a phone; the Mandarin findings in writing."

Run on a phone with the 1.7.0 store build (or its TestFlight and internal-testing build), record
the screen with sound, and fill in the evidence and result columns. TEST-GUIDE-M12.md has the
steps.

| # | Line | Evidence (recording or screenshot) | Result |
|---|---|---|---|
| 1 | Interface in Portuguese: Settings > Language > Português; the dashboard, a meeting, the meeting editor, Tasks, Alert settings, Plans and the assistant read in Portuguese, with no English left outside the executive assistant. | | |
| 2 | Interface in French, as line 1. | | |
| 3 | Interface in German, as line 1. | | |
| 4 | Portuguese voice flow on a phone: create a meeting by voice, move it, cancel it, and hear the agenda aloud in a Portuguese voice; yes and no to the cards by voice. | | |
| 5 | French voice flow, as line 4. | | |
| 6 | German voice flow, as line 4. | | |
| 7 | Confirmation cards in pt, fr and de: titles, dates, times, people and buttons in the language. | | |
| 8 | Reminders and notifications in pt, fr and de: a meeting alert with its buttons, snooze, the follow-up, the daily briefing and a task reminder, with the app closed. | | |
| 9 | Dates in pt, fr and de: day and month names, 24-hour times, the month calendar starting on Sunday (pt) or Monday (fr, de), relative dates ("amanhã", "demain", "morgen"). | | |
| 10 | iOS: the microphone, speech recognition, calendar, photo and camera prompts in each language; Settings > Meeting Guard AI > Language lists the five languages. | | |
| 11 | Store listings: the App Store product page and the Google Play listing show Portuguese (Brazil), French and German texts; the App Store "Languages" row lists English, French, German, Portuguese and Spanish. | | |
| 12 | Hindi: M12-VERDICT-HINDI.md filled in and signed, with the recordings. | | |
| 13 | Mandarin: M12-VERDICT-MANDARIN.md filled in and signed, with the recordings. | | |

Francisco's written acceptance of these lines releases the M12 payment.

## 5. What changes where

| Area | Files | Notes |
|---|---|---|
| Native config | app.config.js (`locales`, expo-localization `supportedLocales`), src/i18n/native/{en,es,pt,fr,de}.json | iOS InfoPlist.strings per language; CFBundleLocalizations, locales_config.xml and resourceConfigurations gain pt, fr, de. Native: 1.7.0 store build. |
| Widget fallback | modules/mg-next-meeting-widget/android/src/main/res/values-pt, -fr, -de | Only used before the app first runs; at runtime the widget follows the app language. |
| Interface | src/i18n/locales/{pt,fr,de}/*.json, src/i18n/resources.ts | Every namespace except `matters`, which falls back to English. |
| Voice and cards | src/screens/assistant, src/services/ai, functions/src/assistant, the shared aiContract.ts (app language type) | The executive assistant's language type stays en/es. |
| Server texts | functions/src/whatsapp, functions/src/summaries (texts only), notifications | Recap reading stays en/es. |
| Legal | src/i18n/locales/{pt,fr,de}/legal.json, public/delete-account.html | Native-speaker and legal review before publishing. |
| Firestore rules | firestore.rules `isAppLanguage` | Accepts en, es, pt, fr, de for the language preference only. Meetings keep `isLanguage` (en, es). |
| Store and website | M12-STORE-LISTINGS.md, M12-WEBSITE-LANGUAGES.md | Console and website work, no code. |

## 6. Deploy order

The order matters: a 1.7.0 app that talks to the old server gets `invalid_request` when the AI
chat sends `pt`, `fr` or `de`, and without the rules change the language preference of a pt, fr
or de user is denied at write. Meetings, AI meeting drafts and the executive assistant stay en/es.

1. Functions, from `v2` after the M12 pull request is merged, by name: the functions whose code
   M12 changed (at least `assistant`, `whatsappWebhook`, `summaryInbound`, `summaryAction`,
   `summaryCommitments`, `summaryWhatsApp`; take the final list from the merged diff), with
   `npx firebase deploy --only functions:assistant,functions:whatsappWebhook,...` from
   `functions/`. Never the matter functions. If the CLI offers to delete functions, answer No.
   The widened request schema is additive: 1.6.0 clients keep working.
2. Firestore rules, from `v2`, by Dusko only: `npx firebase deploy --only firestore:rules`, after
   the rules tests pass.
3. Hosting, from `v2`: `npx firebase deploy --only hosting` for the five-language
   delete-account page.
4. The 1.7.0 store builds (version bump in app.config.js and package.json at the freeze), then
   the store consoles (RELEASE-1.7.0-LANGUAGES.md).
   No EAS Update from `v2` before the 1.7.0 version bump: the new native config (supportedLocales,
   the iOS permission texts) only reaches users in a store build. For a local test APK run
   `npx expo prebuild --clean` first, or check that locales_config.xml lists five languages.
   Within step 1, deploy `summaryWhatsApp` before or together with `whatsappWebhook`.
5. The website pages (Sven), live before the store localizations point at them.

## 7. Risks and open items

- Legal review of the translated Privacy Policy and Terms, and of the "English version prevails"
  clause (decision 3). Not verifiable from the repository.
- Native-speaker review of all pt, fr and de text: the app, the server texts, the permission
  prompts, the delete-account page and the store listings. Francisco provides the reviewers or
  approves a vendor.
- Cross-version: a user with 1.7.0 on one phone and 1.6.0 on another. Meetings stay en/es, so
  nothing is lost; the old app only ignores a pt, fr or de language preference and keeps its own
  language until it updates.
- Device dependencies: Portuguese, French and German speech recognition packs and TTS voices may
  be missing on some phones, offline Android in particular. The test guide checks the message.
- The menu paths in the legal texts and the delete-account page quote the Settings labels word
  for word. If the interface labels change later, those texts must change with them.
- The website pages depend on Sven; the store localizations keep the English policy URL until
  the localized pages answer.
- Each later release needs What's New in five languages (an ongoing cost).
