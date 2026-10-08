// Grants (or removes) the `admin: true` custom claim that the admin callables and the admin
// dashboard require (docs/ARCHITECTURE.md §21, docs/ADMIN.md).
//
// Usage (from functions/, with Application Default Credentials of an account that may manage the
// project's users: `gcloud auth application-default login`):
//   node scripts/set-admin-claim.mjs <uid-or-email> [--remove] [--project <project-id>]
//
// Without --project the Admin SDK resolves the project from the environment
// (GOOGLE_CLOUD_PROJECT / the ADC quota project); pass it explicitly when in doubt.
//
// Custom claims travel inside the ID token: an already-signed-in user only sees the change after
// a token refresh (the admin page forces one with getIdToken(true) right after sign-in, and
// Firebase refreshes tokens on its own within an hour). Other custom claims are preserved.
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    remove: { type: 'boolean', default: false },
    project: { type: 'string' },
  },
});

const target = positionals[0];
if (!target || positionals.length > 1) {
  console.error('Usage: node scripts/set-admin-claim.mjs <uid-or-email> [--remove] [--project <project-id>]');
  process.exit(2);
}

initializeApp(values.project ? { projectId: values.project } : undefined);
const auth = getAuth();

let user;
try {
  user = target.includes('@') ? await auth.getUserByEmail(target) : await auth.getUser(target);
} catch (error) {
  console.error(`Could not find the user "${target}": ${error?.errorInfo?.message ?? error.message}`);
  process.exit(1);
}

const claims = { ...(user.customClaims ?? {}) };
if (values.remove) {
  if (claims.admin === undefined) {
    console.log(`${user.uid} (${user.email ?? 'no email'}) has no admin claim; nothing to do.`);
    process.exit(0);
  }
  delete claims.admin;
} else {
  claims.admin = true;
}

await auth.setCustomUserClaims(user.uid, claims);
console.log(
  values.remove
    ? `Removed the admin claim from ${user.uid} (${user.email ?? 'no email'}).`
    : `Granted the admin claim to ${user.uid} (${user.email ?? 'no email'}).`,
);
console.log('The change is inside the ID token: the user must sign in again or refresh the token (getIdToken(true)) to see it.');
