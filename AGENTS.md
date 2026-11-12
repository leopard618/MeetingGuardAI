# Instructions for AI coding assistants

This repository is worked on by two developers at the same time, with one shared Firebase project
and an app that is live in the stores. Read CONTRIBUTING.md before changing anything. The rules
that matter most:

1. Work only on your developer's branch (`dev_dusko` or `dev_sven`). Never commit to, push to,
   force-push or delete `main` or `v2`.
2. Changes reach `v2` only through a pull request, opened as a draft until it is finished.
   Merge `v2` into the work branch first and resolve conflicts there.
3. Never run a full Firebase deploy, and never deploy Firestore rules or indexes, from a work
   branch. Deploy only your own functions by name. If the CLI offers to delete functions, answer
   No. If it asks for a secret value, cancel instead of typing one.
4. Never commit, print or paste secrets, keys, tokens or the contents of `.env` files.
5. In shared files (functions `config.ts` and `index.ts`, both `aiContract.ts` copies,
   `contracts.ts`, `firestore.rules`, `deleteAccount.ts`, navigation, i18n resources) add only
   your own blocks. The two `aiContract.ts` copies must stay byte-identical: run
   `npm run check:contract` in `functions/`.
6. Run the app and functions checks locally before pushing (commands in CONTRIBUTING.md). Do not
   change the CI workflow's triggers, timeouts or Node versions: the account has 2,000 Actions
   minutes a month.
7. Do not run a formatter over files you did not change. Never run `npm audit fix --omit=dev`.
8. Product text: English and Spanish, and no em dashes, en dashes, ellipsis characters or curly
   quotes.
