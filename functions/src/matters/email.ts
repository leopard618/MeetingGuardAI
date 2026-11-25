/**
 * The assistant's outbound email: composing it (sender name, reply address, Message-ID, the
 * AI disclosure footer) and sending it through Postmark's REST API.
 *
 * - From: "<Name>'s AI assistant" <assistant@<mail domain>>. It always says it is an AI.
 * - Reply-To: the matter's own address m-<token>@<mail domain>, so a reply is matched to its
 *   matter by the address alone (model.ts replyTokenFromAddress); the Message-ID index is the
 *   second way (In-Reply-To / References).
 * - Plain text only, no open or link tracking.
 * - Development without an account: Postmark's public test token POSTMARK_API_TEST accepts the
 *   request and delivers nothing.
 * Logs and errors carry categories and Postmark error codes only, never addresses or text.
 *
 * A4 part 2: a matter confirmed to send from the owner's Microsoft mailbox (sendFrom 'mailbox')
 * goes out through Graph instead (mailbox.ts createMailboxSender, chosen by senderFor). The same
 * email, with From the mailbox address and the same Reply-To, signature and AI footer.
 */
import { randomBytes } from 'node:crypto';

import type { Language } from '../shared/aiContract';
import { mailboxOf, replyAddressFor, type MatterDoc } from './model';
import { disclosureFooter, senderName } from './text';

export interface OutboundEmail {
  /** Full From header value. */
  from: string;
  to: string[];
  cc: string[];
  replyTo: string;
  subject: string;
  /** Body including the footer. */
  text: string;
  /** Our Message-ID, with angle brackets. */
  messageId: string;
  /** In-Reply-To / References for replies inside a thread (A2); empty for the first email. */
  inReplyTo: string | null;
  references: string[];
  /** Postmark Metadata, echoed in its bounce and spam-complaint webhooks (matterDeliveryEvents). */
  metadata?: Record<string, string>;
}

/** The bare address inside a From header value ("Name" <a@b> -> a@b). */
export function bareAddress(header: string): string {
  return header.replace(/^.*<([^>]+)>$/, '$1');
}

export function fromAddress(domain: string, localPart: string): string {
  return `${localPart}@${domain.toLowerCase()}`;
}

/** A4 part 2: the From of a matter's email: the owner's mailbox, or the assistant's address. */
function fromHeader(matter: Partial<Pick<MatterDoc, 'sendFrom' | 'mailboxAddress'>>, name: string, domain: string, localPart: string): string {
  const mailbox = mailboxOf(matter);
  return mailbox ?? `"${name}" <${fromAddress(domain, localPart)}>`;
}

export function newMessageId(matterId: string, domain: string, random: () => string = () => randomBytes(8).toString('hex')): string {
  return `<${matterId}.${random()}@${domain.toLowerCase()}>`;
}

/** The first email of a matter, exactly as it is sent (and as the draft shows it). */
export function composeFirstEmail(input: {
  matter: Pick<MatterDoc, 'mandate' | 'firstEmail' | 'ownerName' | 'ownerEmail' | 'replyToken'> & Partial<Pick<MatterDoc, 'sendFrom' | 'mailboxAddress'>>;
  matterId: string;
  domain: string;
  fromLocalPart: string;
  random?: () => string;
  /** When sending: the owner's uid, for the Postmark Metadata of bounce events (not in the preview). */
  uid?: string;
}): OutboundEmail {
  const { matter } = input;
  if (!matter.mandate || !matter.firstEmail) throw new Error('The draft is not complete.');
  const language: Language = matter.mandate.language;
  const cc = matter.mandate.copyOwner === 'cc' && matter.ownerEmail ? [matter.ownerEmail] : [];
  return {
    from: fromHeader(matter, senderName(matter.ownerName, language), input.domain, input.fromLocalPart),
    to: matter.mandate.contacts.map((c) => c.email),
    cc,
    replyTo: replyAddressFor(matter.replyToken, input.domain),
    subject: matter.firstEmail.subject,
    // the model ends with a closing ("Best,") and no name: code signs as the assistant
    text: `${matter.firstEmail.text.trim()}\n${senderName(matter.ownerName, language)}\n\n${disclosureFooter(matter.ownerName, language)}`,
    messageId: newMessageId(input.matterId, input.domain, input.random),
    inReplyTo: null,
    references: [],
    ...(input.uid ? { metadata: { matterId: input.matterId, uid: input.uid } } : {}),
  };
}

/**
 * An A2 email of a matter (a reply or a follow-up): the same From, Reply-To, signature and footer
 * as the first email. To and Cc come from the caller (the send check decides whether they may go
 * out); the body is the text before the signature.
 */
export function composeMatterEmail(input: {
  matter: Pick<MatterDoc, 'mandate' | 'ownerName' | 'replyToken'> & Partial<Pick<MatterDoc, 'sendFrom' | 'mailboxAddress'>>;
  matterId: string;
  uid: string;
  domain: string;
  fromLocalPart: string;
  to: string[];
  cc: string[];
  subject: string;
  /** The body before the signature (the model's reply, or the follow-up template). */
  body: string;
  /** Under the signature and footer (the quoted earlier email of a follow-up). */
  quoted?: string;
  inReplyTo: string | null;
  references: string[];
  random?: () => string;
}): OutboundEmail {
  if (!input.matter.mandate) throw new Error('The matter has no mandate.');
  const language: Language = input.matter.mandate.language;
  const name = senderName(input.matter.ownerName, language);
  const footer = disclosureFooter(input.matter.ownerName, language);
  return {
    from: fromHeader(input.matter, name, input.domain, input.fromLocalPart),
    to: input.to,
    cc: input.cc,
    replyTo: replyAddressFor(input.matter.replyToken, input.domain),
    subject: input.subject,
    text: `${input.body.trim()}
${name}

${footer}${input.quoted ? `

${input.quoted}` : ''}`,
    messageId: newMessageId(input.matterId, input.domain, input.random),
    inReplyTo: input.inReplyTo,
    references: input.references,
    metadata: { matterId: input.matterId, uid: input.uid },
  };
}

// ---------------------------------------------------------------------------------------------
// Postmark
// ---------------------------------------------------------------------------------------------

export class EmailSendError extends Error {
  constructor(
    /** A4 part 2: 'mailbox' = the owner's mailbox cannot send (not connected, changed, access refused); nothing went out. */
    readonly kind: 'configuration' | 'rejected' | 'rate_limited' | 'timeout' | 'connection' | 'server' | 'unknown' | 'mailbox',
    /** Postmark's ErrorCode (0 = none), or the HTTP status when there is no body. */
    readonly code: number | null,
    options?: { cause?: unknown },
  ) {
    super(`Email send failed: ${kind}${code !== null ? ` (${code})` : ''}`, options);
    this.name = 'EmailSendError';
  }
}

/**
 * A4 part 2: the owner's mailbox cannot send. Never retried with the same access and never sent
 * from another address instead: the matter's send is refused, the owner sees it on the timeline
 * (email_failed 'mailbox') and reconnects.
 */
export class MailboxSendError extends EmailSendError {
  constructor(
    readonly reason: 'not_connected' | 'changed' | 'revoked' | 'client' | 'not_configured' | 'unavailable',
    options?: { cause?: unknown },
  ) {
    super('mailbox', null, options);
    this.name = 'MailboxSendError';
  }
}

/**
 * Failures after which the email may still have gone out: the request may have reached Postmark
 * before the timeout, the lost connection or the server error. Such a send is 'unknown' and is
 * never repeated automatically. The other kinds (configuration, rejected, rate_limited) are clear
 * refusals: nothing went out, so a retry may send.
 */
export const UNCERTAIN_SEND_KINDS: ReadonlySet<EmailSendError['kind']> = new Set(['timeout', 'connection', 'server', 'unknown']);

export interface EmailSender {
  /**
   * Resolves with Postmark's MessageID, and test: true when it was sent with the public test
   * token (accepted, delivered to nobody); throws EmailSendError.
   */
  send(email: OutboundEmail): Promise<{ providerId: string; test?: boolean }>;
}

/**
 * A4 part 2: who sends a matter's email: the owner's mailbox when the matter was confirmed for it,
 * else the assistant (Postmark). A mailbox matter never falls back to the assistant's address.
 */
export function senderFor(
  deps: { sender: () => EmailSender; mailboxSender?: (uid: string, address: string) => EmailSender },
  uid: string,
  matter: Partial<Pick<MatterDoc, 'sendFrom' | 'mailboxAddress'>>,
): EmailSender {
  if (matter.sendFrom !== 'mailbox') return deps.sender();
  const mailbox = mailboxOf(matter);
  if (!mailbox || !deps.mailboxSender) {
    return {
      send: () => Promise.reject(new MailboxSendError(deps.mailboxSender ? 'not_connected' : 'not_configured')),
    };
  }
  return deps.mailboxSender(uid, mailbox);
}

/** Postmark's public test token: every send is accepted and nothing is delivered. */
export const POSTMARK_TEST_TOKEN = 'POSTMARK_API_TEST';

export const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

export function postmarkPayload(email: OutboundEmail, messageStream: string): Record<string, unknown> {
  const headers: { Name: string; Value: string }[] = [{ Name: 'Message-ID', Value: email.messageId }];
  if (email.inReplyTo) headers.push({ Name: 'In-Reply-To', Value: email.inReplyTo });
  if (email.references.length) headers.push({ Name: 'References', Value: email.references.join(' ') });
  return {
    From: email.from,
    To: email.to.join(', '),
    ...(email.cc.length ? { Cc: email.cc.join(', ') } : {}),
    ReplyTo: email.replyTo,
    Subject: email.subject,
    TextBody: email.text,
    MessageStream: messageStream,
    Headers: headers,
    TrackOpens: false,
    TrackLinks: 'None',
    ...(email.metadata ? { Metadata: email.metadata } : {}),
  };
}

/** Postmark error codes that mean our setup is wrong (token, sender signature, account review). */
const CONFIGURATION_CODES = new Set([10, 400, 401, 405, 412]);
/** Postmark "You tried to send to recipient(s) that have been marked as inactive". */
export const INACTIVE_RECIPIENT_CODE = 406;

export function createPostmarkSender(options: {
  token: string;
  messageStream: string;
  timeoutMs: number;
  fetch?: FetchLike;
}): EmailSender {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    async send(email) {
      if (options.token.trim().length === 0) throw new EmailSendError('configuration', null);
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await doFetch(POSTMARK_API_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Postmark-Server-Token': options.token,
          },
          body: JSON.stringify(postmarkPayload(email, options.messageStream)),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        throw new EmailSendError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'connection', null, { cause: error });
      }
      let body: { ErrorCode?: unknown; MessageID?: unknown } = {};
      try {
        body = ((await response.json()) ?? {}) as typeof body;
      } catch {
        body = {};
      }
      const code = typeof body.ErrorCode === 'number' ? body.ErrorCode : null;
      if (response.status === 200 && code === 0 && typeof body.MessageID === 'string' && body.MessageID) {
        return { providerId: body.MessageID, test: options.token.trim() === POSTMARK_TEST_TOKEN };
      }
      if (response.status === 401 || (code !== null && CONFIGURATION_CODES.has(code))) {
        throw new EmailSendError('configuration', code ?? response.status);
      }
      // 406 "inactive recipient": with several recipients Postmark answers "Message OK, but will not
      // deliver to these inactive addresses", so the others MAY have it; never a blind retry
      if (code === INACTIVE_RECIPIENT_CODE) throw new EmailSendError('unknown', code);
      if (response.status === 429) throw new EmailSendError('rate_limited', code ?? 429);
      if (response.status >= 500) throw new EmailSendError('server', code ?? response.status);
      if (response.status === 422) throw new EmailSendError('rejected', code ?? 422);
      throw new EmailSendError('unknown', code ?? response.status);
    },
  };
}
