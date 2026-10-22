# MeetingGuard: project plan by workstream (from 2026-10-22)

This replaces the week-by-week table as the working plan. It is organised by workstream, each
with its goal, what "done" means, who owns it, what it depends on, and the order inside it.
Dates are deliberately absent; sequencing and definitions of done are what the team commits to.
Prices are not in this file; new work is priced by Dusko and Sven with Francisco.

## 1. Where we are

- V2 Stage 1 (voice assistant, tasks, combined requests, agenda, daily briefing) is built,
  device-verified, and released: Android 1.5.0 is live on Google Play; iOS 1.5.0 is in Apple
  review as one submission with the four subscriptions; the full-screen morning summary and the
  status notification shipped in the same build.
- WhatsApp runs on the client's own number (+44 7403 693109) under the new, verified Meta
  business. The bot answers; the app is subscribed to the account.
- Team: Dusko (lead, app), Sven (joined 2026-10-22, GitHub ai-super-dev, has repo access),
  Francisco (owner: accounts, budget, acceptance), a marketer to be hired.
- The public website at meetingguard.ai is a Hostinger page builder site. It will be replaced,
  not edited.

## 2. What success means

Paying subscribers on both stores who keep the app installed, with alarms that never miss and
an assistant people trust. Everything below serves one of three things: a release users can
rely on, a product that is clearly worth paying for, and a way for new people to find it.

## 3. Workstreams

### A. Release operations (owner: Dusko)

Goal: both stores show the same current version; every release is predictable and reversible.

Order:
1. Close 1.5.0: on Apple approval, tag `v1.5.0`, date the changelog entry, update the plan and
   handoff status. If Apple rejects, answer in the review thread the same day.
2. Rollout watch: Android vitals for the first week of 1.5.0 (crash and ANR on the new speech
   module); RevenueCat events for first App Store purchases once iOS is live.
3. Release policy, written in one page: when a change is an OTA update and when it is a store
   build; staged rollout steps; the hotfix path; who presses publish. Managed publishing stays
   on for Android.
4. Store housekeeping, low priority: App Store Connect server-notification URL for RevenueCat,
   subscription level order, the Google Play advisories (code optimisation due Feb 2027,
   large-screen hints).

Done when: 1.5.0 is live on both stores, the release policy page exists, and vitals are clean
for a week.

Depends on: Apple's verdict; Francisco for the Apple and Play consoles.

### B. The app roadmap (owner: Dusko; Sven joins after the website)

Goal: the agreed Stage 2 to 4 scope, in an order where each piece makes the next one easier.

Order and why:
1. **Design refresh.** Shared components first, then the daily screens. Done first because every
   later feature then lands in the new style once, and Sven's website reuses the same palette
   and type. Dusko guides the direction.
2. **Calendars and tasks that sync both ways:** Outlook calendar, Microsoft To Do, Google Tasks.
   Done together because they share one sync engine and one conflict policy; the debrief
   (speak after a meeting, get tasks) ships with Google Tasks since it writes to the same store.
3. **Running late** (a ready-written message the user sends from the phone). Small, visible,
   closes Stage 2.
4. **Summaries in, commitments out:** the notetaker summary arrives by itself, is read, and
   becomes tasks with alarms, in the app and on WhatsApp. The decision stays: we ingest the
   summary the user already gets; we do not record meetings.
5. **Languages:** Portuguese fully; written verdicts on Hindi and Mandarin before any promise.
6. **WhatsApp complete:** voice notes in, debriefs and the daily agenda out, one record store
   with the app.
7. **Guest invitation links:** a web page where guests answer without installing; only an
   approved proposal changes the meeting. Sven builds the page on the new website.
8. **French and German, final test pass, final releases, final acceptance.**

Done when: each item passes its demo on a real phone in English and Spanish, is in the
changelog, and is released. Stage acceptance is signed by Francisco against the agreement.

Depends on: Francisco for the Azure app registration (Outlook), one real notetaker recap email
(summaries), and testing each demo.

### C. The website (owner: Sven, from scratch)

Goal: a site that shows the value in ten seconds, explains the main features clearly, and
turns visitors into installs and subscribers. Francisco's words: demonstrate the value
proposition, explain the main features, and a video.

Order:
1. **Discovery, one short pass:** who the buyer is (busy professionals who miss meetings), the
   three promises (never miss a meeting, talk to your calendar, your tasks remembered), the
   competitors' pages, and the store listing copy we already have in EN and ES.
2. **Content before design:** the page outline and the actual copy, in English and Spanish:
   hero, how it works in three steps, features with real screenshots, pricing (the four plans,
   the trial), download buttons, trust (privacy, security, who we are), FAQ, footer with legal.
3. **Design:** brand direction and a full visual design of every page and both themes, using the
   app's new palette and type so app and site feel like one product. Reviewed by Dusko and
   Francisco; no code until approved.
4. **Build:** a static, fast site (no page builder), responsive, accessible, both languages,
   store badges, analytics, SEO basics (titles, descriptions, structured data), the privacy and
   terms pages migrated so the store listings keep working links.
5. **The video:** a 60 to 90 second product walkthrough on real devices (voice create, alarm,
   agenda aloud, WhatsApp), scripted from the content pass, captioned in EN and ES. Francisco's
   requirements video is separate: Sven records a short screen capture of what the site needs
   from Francisco (domain, hosting, analytics, assets).
6. **Launch:** domain pointed at the new site, old Hostinger page retired, redirects for any
   existing URLs (privacy policy URL is on both store listings and must not break), search
   console submitted, a handover note so copy can be edited without a developer.
7. **Measure:** install clicks by store, scroll depth, language split; report monthly to the
   marketer.

Done when: the site is live on meetingguard.ai in EN and ES, both store privacy links resolve,
the video plays on the home page, and analytics report installs by store.

Depends on: Francisco for Hostinger and domain access, brand assets, and sign-off on design;
Dusko for the app palette and real screenshots; the marketer for messaging once hired.

### D. The natural voice agent (owner: Sven; Dusko reviews)

Goal: answer Francisco's request honestly: can a real-time, interruptible voice conversation be
good enough and affordable enough to ship as the next version.

Order:
1. **Research spike, written up:** two architectures compared on a real phone: a streaming
   speech-to-speech API versus our current pipeline (speech to text, assistant, text to speech)
   made faster. Measure response latency, interruption handling, Spanish quality, battery and
   data use, and cost per minute of conversation at our plan prices.
2. **Decision gate with Francisco:** ship, keep as a lab feature, or stop. The write-up is the
   deliverable even if the answer is stop.
3. **If go: prototype in the app behind a switch,** a "talk" mode on the assistant screen that
   reuses every safety rule we have: every change still ends in a confirmation card, an unclear
   reply never executes, the server guards stay in place.
4. **Productise:** Spanish, error and offline handling, quota per plan, store disclosures, then
   a staged release.

Done when: the comparison exists, Francisco has decided, and if go, talk mode passes the same
device guide the assistant passed.

Depends on: Sven's time after the website; an API budget cap agreed with Francisco for the spike.

### E. Marketing and growth (owner: the marketer, once hired; Dusko hires)

Goal: people who would pay for this can find it and understand it in the stores and on the web.

What the team provides the marketer on day one:
- The product: a demo account on both platforms, the device test guide, the feature list and
  the video from workstream C.
- Store assets: screenshots in EN and ES on current devices, the feature graphic, the release
  notes, and the right to edit listing text in both consoles (Dusko grants).
- Numbers: installs, trials, conversions, churn from Play, App Store Connect and RevenueCat,
  shared read-only.

What the marketer owns:
1. **App store optimisation first,** because it is free and compounding: the app name question
   (one word "MeetingGuard" versus two words, decided once and applied to both stores), subtitle,
   keywords, screenshots that show the three promises, A/B tests where Play allows.
2. **Positioning and messaging** reused by the website and the stores: one sentence, three
   promises, proof points (alarms over the lock screen, confirmation before any change).
3. **Launch plan:** channels, content calendar, the review strategy (asking happy users at the
   right moment inside the app, a small product change we will build), press or directories if
   worth it, a paid test only after organic numbers exist.
4. **A monthly report** with the funnel: store views, installs, trial starts, paid, retained.

Done when: there is a named marketer, the ASO changes are live, and the first monthly report
exists.

Depends on: Dusko hiring; Francisco's budget decision for paid channels; workstream C for the
video and messaging.

### F. WhatsApp operations (owner: Dusko)

Goal: the bot stays reachable and the account stays in good standing.

1. Confirm the Meta app is in Live mode and that a non-admin (Francisco) gets the reply.
2. Keep the account policy-safe: the bot only answers people who message it; no unsolicited
   messages; when proactive messages are wanted later (the daily agenda, reminders), they go
   through approved message templates, and that work is scoped inside the roadmap's
   "WhatsApp complete" item.
3. Watch the quality rating and messaging limits in WhatsApp Manager monthly.
4. Keep the number's two-step PIN and the system-user token in the shared credentials store.

Done when: Francisco's test passes and the Live toggle holds.

### G. Engineering health (owner: Dusko; Sven follows the rules)

Goal: two people can ship without breaking each other or the release.

1. **Branches and reviews:** `v2` is the integration branch; every change is a pull request with
   the full check set green (type check, lint, tests in both tiers, contract check); nobody
   pushes to `v2` directly; Dusko reviews Sven's PRs, Sven reviews Dusko's.
2. **Protected bits:** the alert engine, the AI contract mirror, Firestore rules, and anything
   under `functions/` get a second pair of eyes always; secrets are never in the repo, chat, or
   screenshots; the operator notes in `docs/v1/SETUP.md` are the source of truth for console
   setups.
3. **Tests that matter:** keep the device test guide current; add screenshot tests for the main
   screens when the design refresh lands; crash triage weekly from Play vitals and App Store.
4. **Documentation:** CHANGELOG per change, the plan files updated when scope changes, a
   decision log (section 6) so nothing is re-argued.

### H. Team process (owner: Dusko)

- One shared group for the three of us; technical detail in GitHub issues and PRs.
- A weekly demo to Francisco on a real phone, recorded, the same way weeks 1 to 5 were shown.
- Francisco decides: pricing of new additions, the voice-agent gate, the marketing budget, the
  app name spelling. We present options with a recommendation, he chooses.

## 4. What we need from Francisco

- Apple: forward the review verdict when it arrives.
- Website: Hostinger and domain registrar access (or the DNS change when we ask), brand assets
  if any exist, sign-off on the design.
- Outlook: the Azure app registration on his tenant (we send the exact steps).
- Summaries: forward one real notetaker recap email.
- Voice agent: an API spend cap for the research spike.
- Marketing: budget decision for any paid channel; final say on the app name spelling.

## 5. Risks and what we do about them

- **Apple rejects again.** Everything they asked for is in the submission; if a new point comes,
  we answer the same day. Android is already live, so revenue does not wait on iOS.
- **The website drifts into a long project.** The order is content, design, build, launch, with a
  design sign-off gate; launch with the core pages and improve after.
- **The voice agent costs more than it earns.** The spike measures cost per minute before anyone
  builds; the gate can say no.
- **Two developers, one release.** PR rules and the protected-bits list in workstream G.
- **Marketing starts before the product has proof.** ASO and messaging first, paid only after
  organic numbers; the review-prompt feature is small and built early.
- **Account blocks (Meta, stores).** Policy-safe bot behaviour, no unsolicited messaging, keep
  business verification documents current.

## 6. Open decisions and the decision log

Open:
- App name spelling across both stores ("MeetingGuard AI" versus "Meeting Guard AI").
  Recommendation: pick the findable two-word form on the store listings, keep the one-word brand
  on the domain; align the on-device name at the next store build.
- Voice agent: go or no-go, after the spike.
- Marketing budget and channels, after the marketer's first plan.

Decided:
- 2026-10-16: no meeting recording; ingest the summary the user already receives.
- 2026-10-22: the website is rebuilt from scratch, not edited in Hostinger.
- 2026-10-22: Sven's first work is the website; he moves to the app after it launches.

## 7. First actions, right now

Dusko:
1. Close the 1.5.0 release when Apple answers; keep an eye on Android vitals.
2. Confirm the WhatsApp Live toggle and Francisco's test.
3. Set the PR rules and the protected-bits list in the repo (a short CONTRIBUTING note).
4. Start the design refresh: the palette and type decisions Sven's site will reuse.
5. Hire the marketer; hand them the day-one pack from workstream E.

Sven:
1. Read the codebase and the docs folder; run the app from a test build.
2. Website discovery and the content outline in EN and ES; book the design review with
   Francisco and Dusko.
3. In parallel, a half-day scoping note on the voice-agent spike: what to measure and how.

Francisco:
1. Apple verdict, Hostinger and domain access, the recap email, the name spelling decision.
