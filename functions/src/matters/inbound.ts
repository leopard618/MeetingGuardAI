/**
 * Inbound email (A1): Postmark's inbound webhook JSON -> one email attached to its matter.
 *
 * Matching, in this order, never guessed:
 * 1. a reply address m-<token>@<mail domain> among the recipients (To, Cc, Bcc, the original
 *    recipient): matterAddresses/{token};
 * 2. else In-Reply-To, then References (newest first): matterMessageIds/{sha256(Message-ID)},
 *    which holds only the Message-IDs of emails WE sent (inbound ones are never indexed);
 * 3. else unmatched: nothing is stored (only a log line with the provider id).
 * The sender checks (SPF, DKIM, DMARC from the raw email) and what to do with the reply are A2;
 * here `auth` stays null.
 * Payload parsing is tolerant: Postmark may add fields at any time.
 */
import { emailSchema } from '../shared/aiContract';
import { MATTER_LIMITS, messageIdKey, replyTokenFromAddress, type MatterMessage } from './model';
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
  const stripped = str(root.StrippedTextReply).trim();
  const ownId = messageIds(header(root.Headers, 'Message-ID'))[0] ?? null;
  return {
    providerId,
    from: { name: str(fromFull?.Name).trim().slice(0, MATTER_LIMITS.nameChars) || null, email: fromEmail },
    to: to.map((a) => a.email).slice(0, MATTER_LIMITS.maxRecipients),
    cc: cc.map((a) => a.email).slice(0, MATTER_LIMITS.maxRecipients),
    recipients,
    subject: str(root.Subject).slice(0, MATTER_LIMITS.subjectChars),
    text: (stripped || str(root.TextBody)).slice(0, MATTER_LIMITS.bodyChars),
    rfcMessageId: ownId,
    inReplyTo: messageIds(header(root.Headers, 'In-Reply-To'))[0] ?? null,
    references: messageIds(header(root.Headers, 'References')).slice(-MATTER_LIMITS.maxReferences),
  };
}

/** Which matter the email belongs to (see the header for the order); null = unmatched. */
export async function matchInbound(email: InboundEmail, domain: string, store: Pick<MatterStore, 'findByToken' | 'findByMessageKey'>): Promise<MatterLookup | null> {
  for (const address of email.recipients) {
    const token = replyTokenFromAddress(address, domain);
    if (!token) continue;
    const found = await store.findByToken(token);
    if (found) return found;
  }
  const threadIds = [email.inReplyTo, ...[...email.references].reverse()].filter((id): id is string => id !== null);
  for (const id of threadIds) {
    const found = await store.findByMessageKey(messageIdKey(id));
    if (found) return found;
  }
  return null;
}

/** The stored form of an inbound email. */
export function toMatterMessage(email: InboundEmail, receivedAtIso: string): MatterMessage {
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
    auth: null,
  };
}
