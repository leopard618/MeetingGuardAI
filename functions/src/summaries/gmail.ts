/**
 * Gmail forwarding confirmation (docs/v2/M10-DESIGN.md section 4 step 10, section 5 definition G,
 * decision table row 6, section 10, red-team finding 14).
 *
 * When a user adds the private address as a Gmail forwarding address, Gmail mails a confirmation
 * code to it from forwarding-noreply@google.com. The inbound handler calls this parser ONLY for
 * mail classified G (From exactly GMAIL_CONFIRMATION_SENDER with a passing google.com signature,
 * functions/src/summaries/authenticity.ts over functions/src/mail/auth.ts), then stores
 * {gmailAddress, code} in gmailRequests keyed by gmailAddress (max 3, 2-day expiry). We never
 * fetch, follow, store or return Google's link: the user pastes the code on the Gmail settings
 * page.
 *
 * Known English shape (UNVERIFIED until the first real message is captured):
 *   Subject: (#123456789) Gmail Forwarding Confirmation - Receive Mail from someone@gmail.com
 *   Body:    someone@gmail.com has requested to automatically forward mail to your email
 *            address <private address>. ... Confirmation code: 123456789 ... <links>
 * A Spanish form exists ("Codigo de confirmacion", with accents); its exact wording is
 * UNVERIFIED, so the language-independent path is the "(#digits)" subject marker plus the one
 * addr-spec in the subject.
 *
 * Rules:
 * - Code: from the subject marker "(#digits)", else from a body line that is exactly
 *   "Confirmation code: <code>" or "Codigo de confirmacion: <code>" (accents and case ignored in
 *   the label, never in the code). Two different codes anywhere (subject markers, body lines, or
 *   the subject against the body) give null. The code must match SUMMARY_GMAIL_CODE_PATTERN.
 * - Address: the single addr-spec in the subject; only when the subject names none, the English
 *   body's "<address> has requested to automatically forward mail" line. Two different addresses
 *   in the subject, or a subject address that differs from that body line, give null. It must
 *   pass the strict parseAddrSpec (../mail/headers.ts) and the contract's summaryAddrSpecSchema,
 *   and is returned lowercased. Any domain is accepted (Google Workspace accounts use their own).
 * - Nothing is ever read from a link: codes come only from the marker and whole label lines, the
 *   address only from the subject or the requester line, and the result holds nothing else.
 *
 * Pure: no Firebase, no logging. Subject, body, address and code are content: never log them.
 */
import { parseAddrSpec } from '../mail/headers';
import { SUMMARY_GMAIL_CODE_PATTERN, SUMMARY_LIMITS, summaryAddrSpecSchema } from '../shared/aiContract';

export interface GmailConfirmation {
  /** The Gmail (or Google Workspace) address that asked to forward to the private address, lowercased. */
  gmailAddress: string;
  /** The code the user pastes on the Gmail forwarding settings page. */
  code: string;
}

/** Work bounds: a real confirmation is about 1.5 KB of text with a short subject. */
export const GMAIL_SCAN_LIMITS = {
  /** A longer subject is not Gmail's: null. */
  maxSubjectChars: SUMMARY_LIMITS.maxSubjectChars,
  /** Only this much of the body is scanned. */
  maxBodyChars: 64 * 1024,
} as const;

// "(#123456789)": the code marker in front of Gmail's English subject (assumed, UNVERIFIED, to
// lead the subject in the other languages too).
const SUBJECT_CODE_MARKER = /\(#([0-9]+)\)/g;
// A whole body line "<label>: <code>", matched after accents are stripped from the line. \s also
// takes the no-break space a mail client may leave after the colon.
const BODY_CODE_LINE = /^\s*(?:confirmation\s+code|codigo\s+de\s+confirmacion)\s*:\s*([A-Za-z0-9]+)\s*$/i;
// The English requester line: "<address> has requested to automatically forward mail ...".
const BODY_REQUESTER_LINE = /^\s*(\S+)\s+has\s+requested\s+to\s+automatically\s+forward\s+mail\b/i;
// Combining diacritical marks (U+0300 to U+036F), built from char codes so this file stays ASCII.
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');
// Punctuation that may wrap an address in running text. None of it can start an addr-spec (the
// leading set) or end one (the trailing set), so stripping it never changes the address itself.
const LEADING_WRAP = /^[<([",;:]+/;
const TRAILING_WRAP = /[>)\]",;:.]+$/;

/** Longest token tried as an address (an addr-spec is at most 254 characters, plus wrapping). */
const MAX_ADDRESS_TOKEN_CHARS = 300;

/** One candidate token as a lowercased strict addr-spec that the contract accepts, or null. */
function addressFromToken(token: string): string | null {
  if (token.length > MAX_ADDRESS_TOKEN_CHARS || !token.includes('@')) return null;
  const unwrapped = token.replace(LEADING_WRAP, '').replace(TRAILING_WRAP, '');
  const address = parseAddrSpec(unwrapped);
  if (address === null || !summaryAddrSpecSchema.safeParse(address).success) return null;
  return address;
}

/** The one distinct value (null when there is none), or a conflict when there are several. */
function single(values: readonly string[]): { conflict: false; value: string | null } | { conflict: true } {
  const distinct = [...new Set(values)];
  if (distinct.length > 1) return { conflict: true };
  return { conflict: false, value: distinct[0] ?? null };
}

function isCode(value: string): boolean {
  return SUMMARY_GMAIL_CODE_PATTERN.test(value);
}

interface SubjectFacts {
  codes: string[];
  addresses: string[];
  /** A marker whose digits cannot be a code (too long). */
  invalidMarker: boolean;
}

function readSubject(subject: string): SubjectFacts {
  const codes: string[] = [];
  let invalidMarker = false;
  for (const match of subject.matchAll(SUBJECT_CODE_MARKER)) {
    const digits = match[1] ?? '';
    if (isCode(digits)) codes.push(digits);
    else invalidMarker = true;
  }
  const withoutMarkers = subject.replace(SUBJECT_CODE_MARKER, ' ');
  const addresses: string[] = [];
  for (const token of withoutMarkers.split(/\s+/)) {
    const address = addressFromToken(token);
    if (address !== null) addresses.push(address);
  }
  return { codes, addresses, invalidMarker };
}

interface BodyFacts {
  codes: string[];
  requesters: string[];
}

function readBody(text: string): BodyFacts {
  const codes: string[] = [];
  const requesters: string[] = [];
  const scanned = text.length > GMAIL_SCAN_LIMITS.maxBodyChars ? text.slice(0, GMAIL_SCAN_LIMITS.maxBodyChars) : text;
  for (const line of scanned.split(/\r\n|\r|\n/)) {
    // NFD plus mark removal only touches the label: ASCII letters and digits are unchanged by
    // it, so a captured code is exactly what the line says.
    const plain = line.normalize('NFD').replace(COMBINING_MARKS, '');
    const code = BODY_CODE_LINE.exec(plain)?.[1];
    if (code !== undefined) {
      codes.push(code);
      continue;
    }
    const requesterToken = BODY_REQUESTER_LINE.exec(line)?.[1];
    if (requesterToken !== undefined) {
      const address = addressFromToken(requesterToken);
      if (address !== null) requesters.push(address);
    }
  }
  return { codes, requesters };
}

/**
 * The requesting address and the confirmation code of a Gmail forwarding confirmation, or null
 * when either is missing, invalid or ambiguous. Call it only for mail classified G. Never throws.
 */
export function parseGmailConfirmation(subject: string | null, text: string | null): GmailConfirmation | null {
  const subjectText = typeof subject === 'string' ? subject : '';
  const bodyText = typeof text === 'string' ? text : '';
  if (subjectText.length > GMAIL_SCAN_LIMITS.maxSubjectChars) return null;

  const fromSubject = readSubject(subjectText);
  if (fromSubject.invalidMarker) return null;
  const fromBody = readBody(bodyText);

  const code = single([...fromSubject.codes, ...fromBody.codes]);
  if (code.conflict || code.value === null || !isCode(code.value)) return null;

  const subjectAddress = single(fromSubject.addresses);
  const requester = single(fromBody.requesters);
  if (subjectAddress.conflict || requester.conflict) return null;
  if (subjectAddress.value !== null && requester.value !== null && subjectAddress.value !== requester.value) return null;
  const gmailAddress = subjectAddress.value ?? requester.value;
  if (gmailAddress === null) return null;

  return { gmailAddress, code: code.value };
}
