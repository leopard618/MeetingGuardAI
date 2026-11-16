# Release 1.7.0: the languages part (M12)

The console and build steps that version 1.7.0 needs for Portuguese (Brazil), French and German.
It is one part of the 1.7.0 runbook: the steps of the other milestones in the same release
(summaries, WhatsApp) and the generic release and rollback procedure (docs/v1/DEPLOYMENT.md)
stay where they are. The texts to paste are in `M12-STORE-LISTINGS.md`; the scope and the
acceptance are in `M12-LANGUAGES.md`. Precedent: the Spanish localization of 1.6.0
(IOS-RELEASE-1.6.0.md A3.7, A6 step 5, D5).

Facts this plan rests on:

- The language list is native configuration. app.config.js sets expo-localization
  `supportedLocales` to en, es, pt, fr, de and the Expo `locales` map (src/i18n/native/*.json).
  At prebuild that becomes CFBundleLocalizations and one `<lang>.lproj/InfoPlist.strings` per
  language on iOS, and locales_config.xml plus resourceConfigurations on Android. 1.7.0 is
  therefore a store build, never an OTA update onto 1.6.x; JS-only fixes published after it reach
  only 1.7.0 binaries.
- Apple derives the "Languages" row of the product page from the binary's localizations; no
  console field sets it.
- App Store localizations (name, subtitle, privacy URL; description, keywords, promotional text,
  What's New) and the subscription localizations are reviewed with the version. Subscription
  localizations can be added only before the submission.
- Play translations are per listing language and are not reviewed separately from the listing.
  Play's data safety form and Apple's privacy label are per app, not per language: nothing
  changes there for languages.

## 0. Before building (freeze)

1. TEST-GUIDE-M12.md passed on an Android phone and an iPhone in Portuguese, French and German,
   and Part E (English and Spanish) passed.
2. `version` is 1.7.0 in app.config.js and package.json (the freeze commit), and the comment
   block above `version` keeps the 1.7.0 line.
3. `npx expo config --type introspect --json` on the freeze commit shows
   `ios.infoPlist.CFBundleLocalizations` = en, es, pt, fr, de and `locales` with the five files.
   `npx jest src/i18n` is green (native strings, typographic characters, resources).
4. The server side is live, in this order, from `v2` (M12-LANGUAGES.md section 6): the M12
   functions by name, then the Firestore rules, then hosting (the five-language delete-account
   page). Check: https://<project-id>.web.app/delete-account shows the Português, Français and
   Deutsch links.
5. The native-speaker review of the app texts, the permission prompts and the store texts is
   signed off, and the legal review of the translated Privacy Policy and Terms (with the line on
   which version prevails) is done or explicitly deferred by Francisco in writing.

## 1. After the builds: check the binaries

1. iOS (the .ipa of the build to submit, unzipped): `Payload/*.app/Info.plist` has
   CFBundleLocalizations with the five languages, and the app folder has `en.lproj`, `es.lproj`,
   `pt.lproj`, `fr.lproj` and `de.lproj`, each with an InfoPlist.strings whose
   NSMicrophoneUsageDescription is in that language.
2. Android (the .aab or a test .apk): `aapt2 dump resources` or bundletool shows `values-pt`,
   `values-fr` and `values-de` resources kept (resourceConfigurations no longer strips them) and
   `res/xml/locales_config.xml` lists the five languages.

## 2. App Store Connect

App: https://appstoreconnect.apple.com/apps/6819847236/distribution/info

1. App Information > the language menu at the top right > Add Language: Portuguese (Brazil),
   French, German (one at a time). For each: Name `Meeting Guard AI`, Subtitle (A2), Privacy
   Policy URL https://meetingguard.ai/privacy-policy/ (or the language's own page once it
   answers, M12-WEBSITE-LANGUAGES.md). Save. Leave French (Canada) and Portuguese (Portugal) out:
   those storefronts fall back to the primary language (English).
2. English (U.S.) and Spanish (Mexico): no change on App Information.
3. Version 1.7.0 page (the iOS app's version in the sidebar), for each of the five
   localizations, from the language menu: Description (A6, with S if the summaries ship, without
   X until the executive assistant ships), Keywords (A3 for the new languages; English and
   Spanish keep theirs), Promotional Text (A4), What's New (A5), Support URL and Marketing URL
   (the same as English). Screenshots are optional: without them the localization shows the
   English set.
4. Subscriptions: the app > Subscriptions > the group. On each of the four subscriptions:
   localization section > (+) > Portuguese (Brazil), then French, then German > Display Name
   and Description (A7) > Add. On the group: the same three localizations with the group
   display name (A7). Do this BEFORE submitting; the localizations travel in the same draft as
   the version (IOS-RELEASE-1.6.0.md D5).
5. App Review Information > Notes: add one line to the 1.7.0 notes: "New in 1.7.0: the app is
   available in Portuguese, French and German (menu > Settings > Language). The executive
   assistant, if present, and the reading of notetaker summaries stay English and Spanish."
6. Add for Review: the version, the four subscriptions and the group in one draft, then submit.

## 3. Google Play Console

App: https://play.google.com/console > Meeting Guard AI.

1. First copy the live en-US Short description and Full description into a scratch file and
   compare them with M12-STORE-LISTINGS.md B2 and B3 (en-US). If they differ, the live text wins:
   adjust the translations before pasting.
2. Grow users > Store presence > Store listings > Main store listing > Manage translations > Add
   your own translations: Portuguese (Brazil) pt-BR, French (France) fr-FR, German de-DE. Decline
   Google's machine translation. For each: App name (B1), Short description (B2), Full
   description (B3). Save, then Send for review from Publishing overview with the release, or on
   its own if the release is already out.
3. en-US: replace "Works in English and Spanish." in the Full description with the English
   languages line (B3 en-US).
4. Spanish on Play: the Play listing is English only today. Adding es-419 is optional and needs
   a Spanish short and full description that are not written yet; until then, leave the es-419
   block out of the release notes.
5. Release (production track, 1.7.0): Release notes as one block with the language tags (B4).
   Play rejects a tag that has no listing translation, so drop any block for a language not
   added in step 2.
6. Monetize with Play > Products > Subscriptions: if the Console offers translations of the
   subscription names and benefits, add pt-BR, fr-FR and de-DE (B5).

## 4. After release

1. App Store product page (https://apps.apple.com/app/id6819847236): the "Languages" row lists
   English, French, German, Portuguese and Spanish. If it does not, the binary lacks the .lproj
   folders: check section 1, it cannot be fixed in the console.
2. Open the product page with the device or the browser set to Portuguese (Brazil), French and
   German: the localized name, subtitle, description and What's New show.
3. Play listing in each language (https://play.google.com/store/apps/details?id=com.meetingguard.ai&hl=pt-BR,
   `&hl=fr`, `&hl=de`): the translated texts show.
4. Record the screenshots of 1 to 3 as evidence for M12 acceptance line 11.
5. Every later release: What's New in all five languages (and the release notes per Play tag).
