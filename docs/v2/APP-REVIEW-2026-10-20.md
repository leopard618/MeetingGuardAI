# App Review rejection of 2026-10-20: what to fix, step by step

Apple rejected iOS 1.4.0 (build 9), submission bf226e5f, on 2026-10-20 with three findings.
All three must be closed before the next submission, which will be 1.5.0. This page is the
console walkthrough; the code side (the Plans screen) is already done in the repo.

Who does what: the console steps need the Apple Developer account (Francisco's) and the Firebase
console. Take a screenshot at every point marked [shot] and send them; they are what lets the
code side say "closed" with evidence.

## Finding 1. Guideline 2.1(b): subscription products not submitted

Apple saw the Plans screen with Pro and Premium, but App Store Connect has no subscription
products attached to the version. On Google Play the four products are live; the App Store side
is a separate setup that was never completed.

### 1.1 Check the Paid Apps agreement

App Store Connect > Business (top menu) > Agreements. "Paid Apps" must say Active. It was
Active on 2026-10-08. [shot]

### 1.2 Create the subscription group and the four products

App Store Connect > My Apps > MeetingGuard AI > Monetization > Subscriptions.

1. If no group exists: "Create" (or "+") a Subscription Group. Reference name:
   `MeetingGuard Plans`. [shot of the group page]
2. Inside the group, create four auto-renewable subscriptions. Use exactly these Product IDs,
   they must match RevenueCat and the app:

| Reference name | Product ID | Duration | Price (USD) |
|---|---|---|---|
| Pro Monthly | `pro_monthly` | 1 month | 7.99 |
| Pro Yearly | `pro_yearly` | 1 year | 71.91 (pick the nearest tier Apple offers, 69.99 or 74.99; note which) |
| Premium Monthly | `premium_monthly` | 1 month | 14.99 |
| Premium Yearly | `premium_yearly` | 1 year | 134.91 (nearest tier, 129.99 or 139.99; note which) |

3. For each product fill in, in the English localization and the Spanish localization:
   - Display name: `Pro` / `Pro (yearly)` / `Premium` / `Premium (yearly)`. Spanish:
     `Pro` / `Pro (anual)` / `Premium` / `Premium (anual)`.
   - Description, copied from the app's Plans screen so the two agree. English, Pro: `For a
     busy schedule and daily use of the assistant. 100 AI assistant requests per day.`
     Premium: `For heavy use of the AI assistant. 500 AI assistant requests per day.` Spanish,
     Pro: `Para agendas apretadas y uso diario del asistente. 100 consultas al asistente de IA
     al día.` Premium: `Para un uso intensivo del asistente de IA. 500 consultas al asistente
     de IA al día.`
   - Availability: all countries.
   - Introductory offer: Free trial, 3 days, for new subscribers. Both monthly and yearly.
   - Review information: upload a screenshot of the Plans screen (the one from the Android
     build is acceptable, Apple only needs to see where the product is sold) and a review
     note: `Shown on the Plans screen (Settings > Plans). Purchases run through RevenueCat.`
4. Group ranking: on the group page, order the products so Premium is above Pro (that is the
   upgrade direction). Monthly and yearly of the same tier are the same level.
5. Each product must show status "Ready to Submit", not "Missing Metadata". [shot of the four
   products with their status]

### 1.3 Attach the products to the version

App Store Connect > the app > the iOS version page (the one Apple rejected; it stays editable).
Scroll to "In-App Purchases and Subscriptions" > "+" > tick all four > Done. Save. [shot]

Without this step the products stay in "Ready to Submit" forever; they are reviewed together
with the app version.

### 1.4 RevenueCat, so a real purchase reaches our server

1. App Store Connect > Users and Access > Integrations > In-App Purchase > "+" Generate key.
   Name `RevenueCat`. Download the .p8 once (it cannot be downloaded again) and note the
   Issuer ID and Key ID shown on that page. [shot of the key row, the file itself stays private]
2. RevenueCat dashboard > the MeetingGuard project > Apps > "+ New" > App Store. Bundle ID
   `com.meetingguard.ai`. Upload the .p8, paste the Issuer ID and Key ID. Save.
3. RevenueCat > Product catalog > Products > "+ New" > App Store app > import the four product
   ids (or type them). Then Entitlements: attach `pro_monthly` and `pro_yearly` to the `pro`
   entitlement, `premium_monthly` and `premium_yearly` to `premium`. Then Offerings > the
   current offering > each of the four packages > add the matching App Store product. [shot of
   the offering showing both a Play and an App Store product per package]
4. RevenueCat > API keys > the App Store app's Public SDK key (`appl_...`). It goes into the
   EAS production environment as `EXPO_PUBLIC_REVENUECAT_APPLE_KEY` (the code side does this
   once the key is shared; it is a public key, not a secret).

## Finding 2. Guideline 2.1(a): Sign in with Apple errors on the reviewer's iPad

The reviewer tapped Sign in with Apple on an iPad Air (iPadOS 27.0.1) and got an error. This
flow has never been run on a real Apple device by us. The most likely cause is configuration.
Check in this order.

### 2.0 What the reviewer saw (screenshot received 2026-10-20)

The reviewer's iPad showed the dialog "Couldn't sign in. The email or password is incorrect." right
after the Apple sheet. That text is the app's wording for Firebase's auth/invalid-credential, which
is what Firebase answers when it REFUSES the Apple token. So the native Apple sheet worked (the
capability is fine) and Firebase rejected the result. The usual reason: no iOS app with bundle
ID com.meetingguard.ai registered in the Firebase project (Project settings > General > Your
apps), so the token's audience is not one Firebase accepts. The provider list already shows
Apple Enabled (screenshot received), so 2.1 is a formality; 2.1b is the check that matters.

The app now names this situation ("Apple sign-in was not accepted") instead of blaming an email
or password, from the next build.

**Resolved 2026-10-20 evening.** The iOS app was NOT registered in Firebase at review time; it
was added on 2026-10-20. Afterwards Sign in with Apple succeeded on Francisco's physical iPhone
with the same build 9 (chat 20:57). Root cause: Firebase refused the Apple token because its
audience (the bundle ID) was unknown to the project. No code change needed; the review notes
state cause and fix and attach the recording.

### 2.1b Firebase: the iOS app registration

Firebase console > Project settings (gear) > General > Your apps. [shot] If there is no iOS app:
Add app > iOS > bundle ID com.meetingguard.ai > Register. Skip downloading
GoogleService-Info.plist and the SDK steps (the app uses the JS SDK). Nothing to rebuild.

### 2.1 Firebase: the Apple provider

Firebase console > project meetingguard-ai-app > Authentication > Sign-in method. [shot of the
provider list]

- "Apple" must be in the list and Enabled. If it is missing, Add new provider > Apple > Enable.
- Open the Apple provider. Services ID can stay empty (native iOS only). Under "OAuth code
  flow configuration" fill Apple team ID `D695835P4T`, a Key ID and the private key: these come
  from developer.apple.com > Keys > "+" > name `Firebase Apple Sign In` > tick "Sign in with
  Apple" > Configure > choose the MeetingGuard App ID > Save > Register > Download the .p8
  (once). Paste the .p8 contents into the Firebase field. Save. [shot of the Apple provider
  page with the fields filled, key contents hidden]

If the provider was disabled, that alone produces exactly the error Apple saw: the native Apple
sheet works, then Firebase refuses the token and the app shows "Apple sign-in failed".

### 2.2 Apple developer portal: the capability

developer.apple.com > Certificates, Identifiers & Profiles > Identifiers > `com.meetingguard.ai`.
"Sign in with Apple" must be ticked (EAS normally does this from the entitlement). [shot]

### 2.3 Prove it on a real device

TestFlight > install build 9 (or the next build) on a real iPhone or iPad signed in to an Apple
ID. Landing screen > Sign in with Apple > share the email > the dashboard must open.

- If it fails, screenshot the exact error text. [shot] The text decides whether the fix is the
  provider (2.1), the capability (2.2) or code.
- Also try it once with the iPad in landscape, since the app is iPhone-only and the reviewer
  used an iPad: the sheet must still appear.
- Then Settings > Delete account on that test account, so the Apple ID is clean for the next
  try (and to prove the 5.1.1 revocation path once).

Send the screenshots from 2.1 to 2.3 before anything is rebuilt; if it is configuration, no new
binary is needed for this finding.

## Finding 3. Guideline 3.1.2(c): no Terms of Use link in the listing

Apple requires, for auto-renewable subscriptions, a working Terms of Use link in the App Store
metadata and the renewal terms plus privacy and terms links inside the app.

### 3.1 Code side (done)

The Plans screen now ends with the renewal sentence and two links, Privacy Policy and Terms of
Use, that open the in-app legal pages, in English and Spanish. It ships in the 1.5.0 build.

### 3.2 App Store Connect metadata

App Store Connect > the app > the version page > for EACH localization (English, Spanish):

1. Description: append as the last paragraph. English:
   ```
   MeetingGuard AI offers auto-renewable subscriptions (Pro, Premium; monthly or yearly). Payment is charged to your Apple ID account at confirmation of purchase. The subscription renews automatically unless cancelled at least 24 hours before the end of the current period. Manage or cancel in your App Store account settings.
   Privacy Policy: https://meetingguard.ai/privacy-policy
   Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
   ```
   Spanish:
   ```
   MeetingGuard AI ofrece suscripciones con renovación automática (Pro, Premium; mensual o anual). El pago se carga a tu cuenta de Apple ID al confirmar la compra. La suscripción se renueva automáticamente salvo que se cancele al menos 24 horas antes del final del periodo actual. Gestiona o cancela la suscripción en los ajustes de tu cuenta de App Store.
   Política de privacidad: https://meetingguard.ai/privacy-policy
   Términos de uso (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
   ```
   The privacy URL is the one on the Play listing; open it in a browser once to confirm it
   still loads. [shot of the end of each description]
2. App Information > Privacy Policy URL: must be filled with the same URL. [shot]
3. App Information > License Agreement: leave the standard Apple EULA (that is why the
   description links to it). Do not upload a custom EULA.

## After all three: the reply and the resubmission

Do not resubmit 1.4.0. The next submission is 1.5.0, which carries the Plans screen change and
the Stage 1 features (docs/v2/RELEASE-1.5.0.md). When the 1.5.0 build is processed:

1. Version page > change the version string from 1.4.0 to 1.5.0, select the 1.5.0 build.
2. App Review Information > Notes: paste

   ```
   This build replaces the rejected 1.4.0 (submission bf226e5f).
   2.1(b): the four auto-renewable subscriptions (pro_monthly, pro_yearly, premium_monthly, premium_yearly) are now submitted with this version. They are sold on the Plans screen (Settings > Plans).
   2.1(a): Sign in with Apple was verified on a physical iPhone and iPad with this build (video link below). The app is iPhone-only and runs in compatibility mode on iPad.
   3.1.2(c): the Plans screen shows the subscription names, durations, prices, the renewal terms and links to the Privacy Policy and Terms of Use. The App Store description links to the Privacy Policy and the standard Apple EULA.
   Demo account: hello@meetingguard.ai / (password as before).
   Screen recording: (link)
   ```
3. Reply in the Messages thread of the rejected submission with the same text, plus the screen
   recording that shows the Plans screen with its links and Sign in with Apple succeeding.
4. Submit for review.

## Status on 2026-10-20 (evening) and the remaining checklist

Verified from console screenshots: Firebase has the iOS app (com.meetingguard.ai, App Store ID
6819847236) and the Apple provider enabled; the four App Store subscriptions exist with review
screenshots and read Ready for Review; RevenueCat has both store apps, the four iOS products
(status Could not check until the In-App Purchase key is uploaded), entitlements and the
offering complete. The Plans screen on the Play build loads live prices.

Remaining, in order:

1. Apple key for Firebase (needed for account-deletion revocation): developer.apple.com > Keys >
   new key, Sign in with Apple, primary App ID com.meetingguard.ai; then Firebase > Authentication
   > Apple provider > OAuth code flow: Team ID D695835P4T, Key ID, .p8 contents. Save.
2. Firebase > Project settings > iOS app > Team ID D695835P4T (optional).
3. Francisco: TestFlight build 1.4.0 (9) on an iPhone, tap Sign in with Apple, photo of the
   result. Decides whether the refusal is deterministic or iPad/account specific.
4. App Store Connect: group display name (EN, ES), levels Premium 1 / Pro 2 (drag by the
   handle; not blocking), Add for Review on the group so the draft holds the group, descriptions
   with the two legal links in EN and ES, Privacy Policy URL field.
5. App Store Connect > Users and Access > Integrations > In-App Purchase key; upload to RevenueCat
   > Apps > MeetingGuard iOS; the four iOS products stop saying Could not check.
6. Week 3 and 4 device guide results (docs/v2/TEST-GUIDE-STAGE1.md).
7. Code side: status notification flag on, 1.5.0 builds (Android internal testing, iOS
   TestFlight), Sign in with Apple tap on the TestFlight build (Sentry now carries the Firebase
   refusal detail), then version 1.4.0 edited to 1.5.0 and submitted with the group.
