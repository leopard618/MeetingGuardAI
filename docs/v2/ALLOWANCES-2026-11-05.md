# AI allowances: the agreed configuration and what each surface must say

Agreed with Francisco on November 5, 2026 (chat). The server enforces it (ARCHITECTURE section
35); this page is the single wording source for the app, the website, the legal texts and the
store listings, in English and Spanish. Change the numbers in ONE place, `AI_ALLOWANCES` in
`src/core/aiContract.ts` (mirrored in `functions/src/shared/aiContract.ts`), and then these texts.

## The configuration

| | Free (introductory allowance) | Pro, USD 7.99 per month | Premium, USD 14.99 per month |
|---|---|---|---|
| AI actions | 10 in total during the 7 days after the first AI action, at most 3 per day | 100 per month | 400 per month |
| WhatsApp scheduling requests (Stage 3) | inside the 10 | up to 30 per month, inside the 100 | up to 100 per month, inside the 400 |
| Creating meetings and tasks by hand, viewing, export, scheduled reminders | free | included | included |

- A month is the subscription month: the allowance renews on the monthly anniversary of the
  subscription start, for yearly subscribers too. Counters are server-side and shared by every
  device of the account.
- A reply that only asks the user for missing details is not counted, at most two times in a row.
  After that the assistant proposes with what it has or asks the user to complete the details in
  the form; the third clarification in a row is counted, so unfinished requests cannot chain for
  free.
- Failures on our side are refunded. A debrief is one action (input limited to 4000 characters).
- There is ONE introductory offer: the free allowance above. The store subscriptions carry no
  free trial any more (console steps below). A subscription starts only when the user buys it.
- No paying subscribers existed at the change, so no migration.

## App texts (already in the locales)

Plans screen features: "10 free AI actions in your first 7 days, up to 3 a day" / "100 AI actions
per month" / "400 AI actions per month". Usage card: "3 of 10 free actions used", "Free allowance
until <date>", "Your free actions are used. A subscription unlocks the assistant and WhatsApp
scheduling; creating by hand, reminders and export stay free." Paid: "30 of 100 actions used this
month", "Renews <date>". Onboarding: "Your first 7 days include 10 free AI actions, up to 3 a day.
Creating meetings and tasks by hand, your reminders and export are always free." Terms: the AI
item names the numbers and the renewal rule. Spanish equivalents are in the same files.

## Store listings

Google Play, full description, replace the paragraph on plans with:

```
Free to start: your first 7 days include 10 AI actions (up to 3 a day). Creating meetings and
tasks by hand, your reminders, your agenda and export are always free. Pro (USD 7.99 per month)
includes 100 AI actions per month and Premium (USD 14.99 per month) 400, renewing each month on
the day you subscribed. Prices may vary by country.
```

```
Gratis para empezar: tus primeros 7 dias incluyen 10 acciones de IA (hasta 3 al dia). Crear
reuniones y tareas a mano, tus recordatorios, tu agenda y la exportacion son siempre gratis. Pro
(7,99 USD al mes) incluye 100 acciones de IA al mes y Premium (14,99 USD al mes) 400, y se
renuevan cada mes el dia en que te suscribiste. Los precios pueden variar segun el pais.
```

Subscription descriptions (Play Console, Monetize > Subscriptions, each base plan; App Store
Connect, each subscription's description), English then Spanish:

- Pro: "100 AI actions per month, renewing on your subscription day. Everything else stays free."
  / "100 acciones de IA al mes, renovadas el dia de tu suscripcion. Todo lo demas sigue gratis."
- Premium: "400 AI actions per month, renewing on your subscription day. Everything else stays
  free." / "400 acciones de IA al mes, renovadas el dia de tu suscripcion. Todo lo demas sigue
  gratis."

App Store Connect uses straight ASCII in these fields; the accented Spanish forms are fine in Play.
App Store Connect allows 45 characters in an in-app purchase description, so it may refuse
these texts (88 to 90 characters). Then use the short form: "100 AI actions per month" / "100
acciones de IA al mes", and "400 AI actions per month" / "400 acciones de IA al mes".

## Console steps: remove the 3-day store trials

Google Play Console, Monetize with Play > Products > Subscriptions
(<https://play.google.com/console>): open each subscription (pro_monthly, pro_yearly,
premium_monthly, premium_yearly), under Offers deactivate the free-trial offer, save. Existing
subscribers are unaffected.

App Store Connect, the app > Subscriptions > the group (<https://appstoreconnect.apple.com>): open
each subscription, under Subscription Prices > Introductory Offers delete the free-trial offer
(or set an end date of today). Then edit the subscription description as above and submit the
change with the next version.

RevenueCat: nothing to change; the offering stays. The app shows the store's own trial badge only
while a store reports an introductory offer, so the badge disappears when the offers are gone.

## Website (Sven)

Pricing page and plan cards use the same three lines as the app. The free card says what stays
free. No "trial" wording anywhere except "introductory": "Free to start: 10 AI actions in your
first 7 days". The FAQ answer on limits: "AI actions are counted per month on paid plans and renew
on the day you subscribed. A question the assistant asks you back does not count, up to two in a
row. Creating by hand, your reminders and export are never limited."

## Deploy order

1. Functions: `assistant`, `revenuecatWebhook` and the reconcile callable (the entitlement now
   carries `startedAt`), from the functions folder: `npx firebase deploy --only functions`.
2. Firestore rules (`usage/{uid}` root document readable by the owner): `npx firebase deploy
   --only firestore:rules`.
3. The app build with the new texts (1.6.0).
4. Store consoles: trials off, descriptions updated.
5. Website texts.

The server change is backward compatible: older app builds keep parsing the usage answer (the
new fields are optional) and show the counts as a daily figure until they update.
