/**
 * Inbound email (A1): Postmark's inbound webhook JSON -> one email attached to its matter.
 *
 * Matching, in this order, never guessed:
 * 1. a reply address m-<token>@<mail domain> among the recipients (To, Cc, Bcc, the original
 *    recipient): matterAddresses/{token};
 * 2. else In-Reply-To, then References (newest first): matterMessageIds/{sha256(Message-ID)},
 *    which holds only the Message-IDs of emails WE sent (inbound ones are never indexed). Only an
 *    id of our own form <matterId.random@mail domain> is looked up, and the entry must name that
 *    same matterId (so an older entry written for someone else's id never resolves);
 * 3. else unmatched: nothing is stored (only a log line with the provider id).
 * A2 adds, per email: the raw bytes for the sender check (mailCheck.ts; never stored), Postmark's
 * Received-SPF as a hint, automatic-reply detection, attachment metadata (name, type, size; the
 * bytes are never kept) and the text of an HTML-only email with hidden elements removed. The text
 * kept is the NEW part of a reply: Postmark's StrippedTextReply, else the body without quoted
 * older text, so an instruction hidden in the quote never reaches the model. The inbound
 * Reply-To is never read: replies go only to the contact's address in the mandate.
 * Payload parsing is tolerant: Postmark may add fields at any time.
 */
import { emailSchema } from '../shared/aiContract';
import { MATTER_LIMITS, SPF_HINTS, messageIdKey, replyTokenFromAddress, type EmailAuth, type MatterMessage } from './model';
import type { MatterLookup, MatterStore } from './store';

export interface InboundEmail {
  providerId: string;
  from: { name: string | null; email: string };
  to: string[];
  cc: string[];
  /** Every address the email was delivered to (To, Cc, Bcc, OriginalRecipient). */
  recipients: string[];
  subject: string;
  /** The new part of a reply when Postmark could strip the quote, else the whole text. */
  text: string;
  rfcMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** RawEmail as bytes (sender check only; never stored); null when Postmark sent none. */
  raw: Buffer | null;
  spf: EmailAuth['spf'];
  autoReply: boolean;
  attachments: { name: string; type: string; size: number }[];
}

function rec(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');
const isEmail = (value: string) => emailSchema.safeParse(value).success;

function addresses(value: unknown): { name: string | null; email: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(rec)
    .filter((v): v is Record<string, unknown> => v !== null)
    .map((v) => ({ name: str(v.Name).trim().slice(0, MATTER_LIMITS.nameChars) || null, email: str(v.Email).trim() }))
    .filter((a) => isEmail(a.email));
}

function header(headers: unknown, name: string): string | null {
  if (!Array.isArray(headers)) return null;
  for (const h of headers) {
    const entry = rec(h);
    if (entry && str(entry.Name).toLowerCase() === name.toLowerCase()) return str(entry.Value).trim() || null;
  }
  return null;
}

const MESSAGE_ID = /<[^<>\s]+>/g;

function messageIds(value: string | null): string[] {
  return value ? (value.match(MESSAGE_ID) ?? []).map((id) => id.slice(0, MATTER_LIMITS.messageIdChars)) : [];
}

// ---------------------------------------------------------------------------------------------
// Text: HTML-only emails, quoted older text
// ---------------------------------------------------------------------------------------------

/** Elements a reader does not see (simple, non-nested forms; dropped rather than read). */
const HIDDEN_ELEMENT =
  /<(\w+)\b[^>]*(?:\shidden\b|aria-hidden\s*=\s*["']?true|display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:px|pt|em|%)?\s*[;"']|opacity\s*:\s*0(?:\.0+)?\s*[;"']|max-height\s*:\s*0(?:px)?\s*[;"'])[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** Whether the HTML hides text from the reader (then its visible text is used, never TextBody). */
export function hasHiddenHtml(html: string): boolean {
  HIDDEN_ELEMENT.lastIndex = 0;
  return HIDDEN_ELEMENT.test(html.slice(0, 200_000));
}

const ENTITIES: Readonly<Record<string, string>> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** The visible text of an HTML body: no scripts, styles, comments, hidden elements or quoted blocks. */
export function htmlToText(html: string): string {
  let text = html.slice(0, 200_000);
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<(script|style|head|title|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  for (let pass = 0; pass < 5; pass += 1) {
    const next = text.replace(HIDDEN_ELEMENT, ' ');
    if (next === text) break;
    text = next;
  }
  // quoted older text: <blockquote> and Gmail's quote block
  text = text.replace(/<blockquote\b[\s\S]*?<\/blockquote\s*>/gi, ' ');
  text = text.replace(/<div[^>]*class\s*=\s*["'][^"']*gmail_quote[\s\S]*$/i, ' ');
  text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6]|table)\s*>/gi, '\n');
  text = text.replace(/<[^>]*>/g, ' ');
  text = text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+|#39);/gi, (all, name: string) => {
    const key = name.toLowerCase();
    if (key in ENTITIES) return ENTITIES[key]!;
    const code = key.startsWith('#x') ? parseInt(key.slice(2), 16) : key.startsWith('#') ? parseInt(key.slice(1), 10) : NaN;
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lines that start the quoted older email in a reply (EN and ES clients). */
const QUOTE_HEADER = /^(?:On .{1,300} wrote:|El .{1,300} escribi[oó]:|-{2,} ?(?:Original Message|Mensaje original|Forwarded message|Mensaje reenviado) ?-{2,}|From: .+|De: .+)$/i;

/** The new part of a plain-text reply: everything before the first quote header or quoted line block. */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (QUOTE_HEADER.test(trimmed)) break;
    if (trimmed.startsWith('>')) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

// ---------------------------------------------------------------------------------------------
// Automatic replies, SPF hint, attachments
// ---------------------------------------------------------------------------------------------

const AUTO_SUBJECT = /^\s*(?:automatic reply|auto(?:matic)?[- ]?reply|autoreply|auto:|out of (?:the )?office|respuesta autom[aá]tica|fuera de la oficina|ausente|ausencia|r[eé]ponse automatique|abwesenheitsnotiz)/i;

/**
 * An automatic reply (RFC 3834 Auto-Submitted, the X-Autoreply family, bulk or list mail, an
 * out-of-office subject). Stored, never answered, and it never resets the follow-up clock.
 */
export function isAutoReply(headers: unknown, subject: string): boolean {
  const auto = header(headers, 'Auto-Submitted');
  if (auto !== null && auto.trim().toLowerCase() !== 'no') return true;
  if (header(headers, 'X-Autoreply') !== null || header(headers, 'X-Autorespond') !== null || header(headers, 'X-Autoresponder') !== null) return true;
  const precedence = (header(headers, 'Precedence') ?? header(headers, 'X-Precedence') ?? '').trim().toLowerCase();
  if (['bulk', 'auto_reply', 'list', 'junk'].includes(precedence)) return true;
  if (header(headers, 'List-Id') !== null || header(headers, 'List-Unsubscribe') !== null) return true;
  return AUTO_SUBJECT.test(subject);
}

/** Received-SPF's result word as Postmark wrote it; 'unknown' when absent or unreadable. */
export function spfHint(headers: unknown): EmailAuth['spf'] {
  const value = (header(headers, 'Received-SPF') ?? '').trim().toLowerCase();
  const word = value.split(/[\s(;]/)[0] ?? '';
  return (SPF_HINTS as readonly string[]).includes(word) ? (word as EmailAuth['spf']) : 'unknown';
}

function attachmentsOf(value: unknown): InboundEmail['attachments'] {
  if (!Array.isArray(value)) return [];
  return value
    .map(rec)
    .filter((v): v is Record<string, unknown> => v !== null)
    .slice(0, MATTER_LIMITS.maxAttachments)
    .map((v) => ({
      name: str(v.Name).slice(0, MATTER_LIMITS.attachmentNameChars),
      type: str(v.ContentType).slice(0, 100),
      size: typeof v.ContentLength === 'number' && Number.isFinite(v.ContentLength) && v.ContentLength >= 0 ? Math.floor(v.ContentLength) : 0,
    }));
}

/** The text kept for a reply: the new part, from the stripped reply, the text body or the visible HTML. */
function replyText(root: Record<string, unknown>): string {
  const html = str(root.HtmlBody);
  // an HTML body that hides text: its visible text is the truth (a TextBody may carry the hidden part)
  if (html && hasHiddenHtml(html)) return stripQuoted(htmlToText(html));
  const stripped = str(root.StrippedTextReply).trim();
  if (stripped) return stripped;
  const textBody = str(root.TextBody);
  if (textBody.trim()) return stripQuoted(textBody);
  return html ? stripQuoted(htmlToText(html)) : '';
}

/** A contact's Message-ID fit for In-Reply-To / References: one <local@domain> id, bounded, not our stand-in. */
export function threadSafeId(id: string | null): string | null {
  if (id === null) return null;
  const trimmed = id.trim();
  if (trimmed.length > MATTER_LIMITS.threadIdChars) return null;
  if (!/^<[^<>\s@]+@[^<>\s@]+>$/.test(trimmed)) return null;
  if (/@postmark>$/i.test(trimmed)) return null;
  return trimmed;
}

/** null when the payload is not an inbound email we can use. */
export function parseInbound(payload: unknown): InboundEmail | null {
  const root = rec(payload);
  if (!root) return null;
  const providerId = str(root.MessageID).trim();
  const fromFull = rec(root.FromFull);
  const fromEmail = str(fromFull?.Email ?? root.From).trim();
  if (!providerId || providerId.length > 128 || !isEmail(fromEmail)) return null;
  const to = addresses(root.ToFull);
  const cc = addresses(root.CcFull);
  const bcc = addresses(root.BccFull);
  const original = str(root.OriginalRecipient).trim();
  const recipients = [...to, ...cc, ...bcc].map((a) => a.email);
  if (isEmail(original)) recipients.push(original);
  const ownId = messageIds(header(root.Headers, 'Message-ID'))[0] ?? null;
  const rawEmail = str(root.RawEmail);
  const subject = str(root.Subject).slice(0, MATTER_LIMITS.subjectChars);
  return {
    providerId,
    from: { name: str(fromFull?.Name).trim().slice(0, MATTER_LIMITS.nameChars) || null, email: fromEmail },
    to: to.map((a) => a.email).slice(0, MATTER_LIMITS.maxRecipients),
    cc: cc.map((a) => a.email).slice(0, MATTER_LIMITS.maxRecipients),
    recipients,
    subject,
    text: replyText(root).slice(0, MATTER_LIMITS.bodyChars),
    rfcMessageId: ownId,
    inReplyTo: messageIds(header(root.Headers, 'In-Reply-To'))[0] ?? null,
    references: messageIds(header(root.Headers, 'References')).slice(-MATTER_LIMITS.maxReferences),
    raw: rawEmail.length > 0 ? Buffer.from(rawEmail, 'utf8') : null,
    spf: spfHint(root.Headers),
    autoReply: isAutoReply(root.Headers, subject),
    attachments: attachmentsOf(root.Attachments),
  };
}

/** Reply-address tokens looked up per email. */
export const MAX_TOKEN_LOOKUPS = 5;

/** Which matter the email belongs to (see the header for the order); null = unmatched. */
export async function matchInbound(email: InboundEmail, domain: string, store: Pick<MatterStore, 'findByToken' | 'findByMessageKey'>): Promise<MatterLookup | null> {
  // at most MAX_TOKEN_LOOKUPS distinct tokens: an email listing hundreds of made-up reply
  // addresses costs a handful of reads, not hundreds
  const tokens = [...new Set(email.recipients.map((address) => replyTokenFromAddress(address, domain)).filter((t): t is string => t !== null))];
  for (const token of tokens.slice(0, MAX_TOKEN_LOOKUPS)) {
    const found = await store.findByToken(token);
    if (found) return found;
  }
  const threadIds = [email.inReplyTo, ...[...email.references].reverse()].filter((id): id is string => id !== null);
  for (const id of threadIds) {
    const matterId = ownMessageIdMatter(id, domain);
    if (!matterId) continue;
    const found = await store.findByMessageKey(messageIdKey(id));
    if (found && found.matterId === matterId) return found;
  }
  return null;
}

/** The matterId inside one of OUR Message-IDs (email.ts newMessageId), else null. */
export function ownMessageIdMatter(rfcMessageId: string, domain: string): string | null {
  const bare = rfcMessageId.trim().replace(/^<|>$/g, '').trim();
  const at = bare.lastIndexOf('@');
  if (at <= 0 || bare.slice(at + 1).toLowerCase() !== domain.trim().toLowerCase()) return null;
  const local = bare.slice(0, at);
  const dot = local.lastIndexOf('.');
  return dot > 0 && /^[A-Za-z0-9]+$/.test(local.slice(dot + 1)) ? local.slice(0, dot) : null;
}

/** The stored form of an inbound email (A2 fields: see the handler). */
export function toMatterMessage(
  email: InboundEmail,
  receivedAtIso: string,
  a2: Pick<MatterMessage, 'auth' | 'senderRole' | 'readState'> = { auth: null, senderRole: null, readState: null },
): MatterMessage {
  return {
    direction: 'inbound',
    status: 'received',
    // an email without a Message-ID still gets one, so every stored message has an id
    rfcMessageId: email.rfcMessageId ?? `<inbound.${email.providerId}@postmark>`,
    inReplyTo: email.inReplyTo,
    references: email.references,
    from: email.from,
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    text: email.text,
    at: receivedAtIso,
    providerId: email.providerId,
    auth: a2.auth,
    senderRole: a2.senderRole,
    autoReply: email.autoReply,
    attachments: email.attachments,
    readState: a2.readState,
    readAttempts: 0,
    readClaimedAt: null,
    readOutcome: null,
  };
}
