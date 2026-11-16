# meetingguard.ai in Portuguese, French and German (app 1.7.0, M12)

For Sven. With version 1.7.0 the app speaks Portuguese (Brazil), French and German as well as
English and Spanish, and the store listings get Portuguese, French and German localizations. The
website needs the same three languages on the pages the stores and the app link to, and on the
pages a visitor from those stores reads first. The texts come from the repository, so the
website and the app say the same thing.

Rules for the pages:

- Plain punctuation only: no em dashes, no ellipsis character, no curly quotes, no German low
  quotes and no guillemets. Straight " and ' everywhere (French l'application, German
  "Einstellungen"). No non-breaking spaces; French keeps a plain space before ":", "?", "!" and
  ";".
- The product name is "Meeting Guard AI", with spaces, in every language. Product names (Google
  Calendar, Outlook, Microsoft To Do, Google Tasks, WhatsApp, Zoom, App Store, Google Play) are
  never translated.
- Keep every existing URL unchanged. The new pages use the same paths as the English ones with
  a language prefix, as the Spanish pages do (https://meetingguard.ai/es/privacy-policy/).
- Portuguese is Brazilian Portuguese ("você"), French uses "vous", German uses "Sie".
- Menu paths are written with ">" and the app's own labels in that language:
  Configurações > Conta > Excluir conta; Paramètres > Compte > Supprimer le compte;
  Einstellungen > Konto > Konto löschen.
- Each legal page gets its own "Last updated" line, set to the day you publish, in every
  language, and the line on which version prevails (below).
- All five languages go live together, and only after the native-speaker review (and, for the
  legal pages, Francisco's legal review) has signed the texts off. Until then, do not publish the
  pt, fr and de legal pages.
- Every page links its other languages (a language switcher) and carries hreflang links:
  en, es, pt-BR, fr, de, plus x-default pointing at the English page.

---

## Part A. The pages and their URLs

| Page | English (exists) | Portuguese (new) | French (new) | German (new) | Text source |
|---|---|---|---|---|---|
| Privacy Policy | https://meetingguard.ai/privacy-policy/ | https://meetingguard.ai/pt/privacy-policy/ | https://meetingguard.ai/fr/privacy-policy/ | https://meetingguard.ai/de/privacy-policy/ | `src/i18n/locales/<lang>/legal.json`, key `privacy` (title, intro and every section, in order), with `updated`, `jurisdiction` and `contact` |
| Terms of Service | https://meetingguard.ai/terms-of-service/ | https://meetingguard.ai/pt/terms-of-service/ | https://meetingguard.ai/fr/terms-of-service/ | https://meetingguard.ai/de/terms-of-service/ | the same files, key `terms` |
| Delete account | https://meetingguard.ai/delete-account/ | https://meetingguard.ai/pt/delete-account/ | https://meetingguard.ai/fr/delete-account/ | https://meetingguard.ai/de/delete-account/ | `public/delete-account.html`, the sections `id="pt"`, `id="fr"`, `id="de"` (texts and the mailto links as they are) |
| Home (landing) | https://meetingguard.ai/ | https://meetingguard.ai/pt/ | https://meetingguard.ai/fr/ | https://meetingguard.ai/de/ | `docs/v2/M12-STORE-LISTINGS.md` A6 (feature paragraphs) and A4 (one-line pitch) in that language |
| Pricing | the current English pricing page or section | the same path with /pt/ | with /fr/ | with /de/ | the Plans screen texts, `src/i18n/locales/<lang>/pricing.json`, and the free-allowance lines of ALLOWANCES-2026-11-05.md as the app shows them in that language |
| FAQ | the current English FAQ | the same path with /pt/ | with /fr/ | with /de/ | translate the English answers; the app's onboarding and pricing texts in that language give the terms to use |

The App Store links to the Privacy Policy per localization (App Information > Privacy Policy
URL) and in each description. The store localizations keep the English URL until the
localized page answers 200; then Dusko switches each localization to its own page. Google Play
has one privacy URL per app, so Play keeps https://meetingguard.ai/privacy-policy/. The
delete-account URL in Play's Data safety form also stays the English one.

Check before telling Dusko the pages are live: each URL above answers 200 over https, shows the
right language, and its language switcher reaches the other four.

## Part B. The line on which version prevails

Decision of November 2026, marked for Francisco's legal review: the translated Privacy Policy and
Terms carry a line that the English version prevails if the versions differ. In the app it is
the last sentence of `privacy.intro` and `terms.intro` in the pt, fr and de legal.json, so it is
already part of the text you copy:

- pt: "Esta é uma tradução. Se houver divergência em relação à versão em inglês, prevalece a
  versão em inglês."
- fr: "Ceci est une traduction. En cas de divergence avec la version anglaise, la version
  anglaise prévaut."
- de: "Dies ist eine Übersetzung. Weicht sie von der englischen Fassung ab, ist die englische
  Fassung maßgeblich."

The English and Spanish pages do not get the line.

If the legal review drops or changes the clause, the app texts and these pages change together.

## Part C. What the pages must not say

The app is in five languages, but two parts stay English and Spanish:

- The executive assistant (matters and email, when it ships) works in English and Spanish only.
- Notetaker summaries are read in English and Spanish: a summary written in Portuguese, French or
  German is stored and shown, but the commitments are proposed from English and Spanish
  summaries.

The home, pricing and FAQ pages in every language say "Available in English, Spanish,
Portuguese, French and German" and add those two limits where the features are described, in
the wording of M12-STORE-LISTINGS.md (the languages line and the X sentence).

## Part D. Order

1. Dusko sends the reviewed pt, fr and de legal texts (legal.json) and confirms the delete-account
   sections.
2. Sven builds the pages on a preview, Dusko checks the texts against the repository.
3. Francisco approves; all pages go live the same day.
4. Dusko updates the App Store Privacy Policy URL of each new localization
   (RELEASE-1.7.0-LANGUAGES.md).
