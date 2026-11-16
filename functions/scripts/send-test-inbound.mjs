// Posts a Postmark-shaped inbound payload built from a local .eml file to summaryInbound, so the
// whole pipeline can be tested before the Postmark account exists (docs/v2/M10-DESIGN.md section 11
// step 4c and the usage note at the end of section 11; docs/v2/M11-DESIGN.md section 10).
//
// Usage (from functions/, after `npm run build`):
//   node scripts/send-test-inbound.mjs --url <function url> --to <private address> --eml <path> [--from-envelope <addr>] [--dry-run]
//
// - --url: the deployed summaryInbound URL, or the emulator's (http is accepted for a loopback
//   host only). Never put credentials in the URL.
// - --to: the private address; it fills OriginalRecipient (the only routing input), To, ToFull
//   and MailboxHash (the part after "+").
// - --eml: the message as saved from a mail client ("Download message" or "Show original"). Its
//   bytes go into RawEmail unchanged; From, Subject and Date are read from its header block for the
//   JSON fields only.
// - --from-envelope: the SMTP envelope sender to claim, as a Return-Path entry of Headers. The
//   pipeline never reads it.
// - --dry-run: builds the payload and prints its shape (content as lengths, RawEmail truncated)
//   and the checks; sends nothing and needs no credentials.
//
// Credentials: ONLY the environment variable SUMMARIES_TEST_WEBHOOK_AUTH, holding
// `postmark:<the SUMMARIES_WEBHOOK_AUTH value>` (the pair Postmark sends as Basic auth). Set it in
// the shell for one session, never in a file or an argument, for example in Git Bash:
//   read -rs S && export SUMMARIES_TEST_WEBHOOK_AUTH="postmark:$S"; unset S
// The script never prints it, the URL's query, the message, its subject or its sender. It prints
// the HTTP status, the fixed answer (or code-like reason fields), and a hint. The webhook answers
// 200 for every deliberate outcome, so the verdict and reason are in the summaries.inbound log line.
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const USAGE =
  'Usage: node scripts/send-test-inbound.mjs --url <function url> --to <private address> --eml <path> [--from-envelope <addr>] [--dry-run]';
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RESPONSE_CHARS = 64 * 1024;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function errorName(error) {
  return error instanceof Error ? error.name : typeof error;
}

function errorCode(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : null;
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      url: { type: 'string' },
      to: { type: 'string' },
      eml: { type: 'string' },
      'from-envelope': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  }));
} catch {
  // The parser's message echoes the unknown argument, which could be a mistyped secret.
  fail(USAGE);
}

const dryRun = values['dry-run'] === true;
if (!values.to || !values.eml || (!dryRun && !values.url)) fail(USAGE);

const require = createRequire(import.meta.url);
let lib;
try {
  lib = require('../lib/summaries/provider/postmarkTestPayload.js');
} catch (error) {
  fail(
    errorCode(error) === 'MODULE_NOT_FOUND'
      ? 'Build first: run `npm run build` in functions/ (the script loads lib/summaries/provider/postmarkTestPayload.js).'
      : `Could not load the payload builder (${errorName(error)}).`,
  );
}

// The target, checked before any file is read.
let target = null;
if (values.url) {
  const checked = lib.checkTestUrl(values.url);
  if (!checked.ok) {
    const why = {
      invalid_url: 'is not a valid http or https URL',
      credentials_in_url: 'carries credentials: remove them and use SUMMARIES_TEST_WEBHOOK_AUTH',
      insecure_http: 'is http to a host that is not loopback: use https',
    }[checked.reason];
    fail(`--url ${why}.`);
  }
  target = checked.url;
}

// The credentials, from the environment only. Checked before reading the file on a real send.
const auth = lib.testWebhookAuthorization(process.env[lib.TEST_WEBHOOK_AUTH_ENV]);
if (!dryRun && !auth.ok) {
  fail(
    auth.reason === 'missing'
      ? `${lib.TEST_WEBHOOK_AUTH_ENV} is not set. Set it in this shell to postmark:<the SUMMARIES_WEBHOOK_AUTH value>, or use --dry-run.`
      : `${lib.TEST_WEBHOOK_AUTH_ENV} is not of the form postmark:<secret> (one line, no control characters).`,
  );
}

// The .eml bytes, exactly as on disk.
let raw;
try {
  const size = statSync(values.eml).size;
  if (size > lib.TEST_MAX_EML_BYTES) fail(`The .eml is over ${lib.TEST_MAX_EML_BYTES} bytes: the webhook would ignore the post.`);
  raw = readFileSync(values.eml);
} catch (error) {
  fail(`Cannot read the .eml file (${errorCode(error) ?? errorName(error)}).`);
}

const built = lib.buildTestInboundPayload({
  rawEmail: raw,
  to: values.to,
  fromEnvelope: values['from-envelope'] ?? null,
  messageId: randomUUID(),
});
if (!built.ok) {
  const why = {
    empty_eml: 'The .eml file is empty.',
    invalid_to: '--to is not a plain address (local@domain, at most 254 characters).',
    invalid_from_envelope: '--from-envelope is not a plain address (local@domain, at most 254 characters).',
    invalid_message_id: 'The generated MessageID was refused (should not happen).',
    body_too_large: 'The JSON body would be over 12 MiB: the webhook would ignore it.',
  }[built.reason];
  fail(why ?? built.reason);
}

const { facts } = built;
const counts = facts.headerCounts;
console.log(
  `Message: ${facts.rawBytes} bytes, line endings ${facts.lineEndings}, UTF-8 round trip ${facts.utf8Exact ? 'exact' : 'NOT exact'}; ` +
    `header fields From ${counts.from}, To ${counts.to}, Date ${counts.date}, Subject ${counts.subject}, ` +
    `Message-ID ${counts.messageId}, DKIM-Signature ${counts.dkimSignature}. JSON body ${facts.bodyBytes} bytes.`,
);
for (const warning of facts.warnings) console.log(`Warning ${warning}: ${lib.TEST_PAYLOAD_WARNING_TEXT[warning]}`);

if (dryRun) {
  console.log(JSON.stringify(lib.describeTestPayload(built.payload), null, 2));
  const authState = auth.ok ? 'set' : auth.reason === 'missing' ? 'not set' : 'set, but not of the form postmark:<secret>';
  console.log(`Dry run: nothing sent. ${lib.TEST_WEBHOOK_AUTH_ENV} is ${authState}.${target ? ` Target: ${lib.printableUrl(target)}` : ''}`);
  process.exit(0);
}

console.log(`POST ${lib.printableUrl(target)}`);
let response;
try {
  response = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth.authorization },
    body: built.body,
    // Never re-send the credentials to wherever a redirect points.
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
} catch (error) {
  const code = errorCode(error?.cause) ?? errorCode(error);
  fail(`The request failed (${errorName(error)}${code ? ` ${code}` : ''}).`, 1);
}

let text = '';
try {
  text = (await response.text()).slice(0, MAX_RESPONSE_CHARS);
} catch {
  text = '';
}
const described = lib.describeTestResponse(response.status, text);
console.log(described.line);
if (described.hint) console.log(described.hint);
process.exit(response.ok ? 0 : 1);
