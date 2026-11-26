/**
 * A4 part 2: the only Microsoft calls of the assistant (docs/v2/A4-THREAT-MODEL.md T9).
 *
 * The app registration "Meeting Guard AI Mailbox" (Dusko) is a confidential client: the SERVER
 * exchanges the sign-in code with the client secret and a PKCE verifier. Scopes are fixed here:
 * Mail.Send, User.Read (the owner's own address) and offline_access. There is no call that lists,
 * searches or reads mail: replies come to the matter address through Reply-To.
 *
 * Calls: authorizeUrl (the sign-in link), exchangeCode and refreshAccess (the token endpoint),
 * readOwnAddress (GET /me) and sendMailboxEmail (POST /me/sendMail). Every call has a timeout;
 * errors carry a category and the HTTP status or Microsoft's error code, never a token or text.
 */
import { createHash } from 'node:crypto';

import { EmailSendError, MailboxSendError, type OutboundEmail } from './email';

export const MS_AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
export const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';

/** The only permissions the mailbox asks for (T9); never Mail.Read. */
export const MAILBOX_SCOPES = ['offline_access', 'https://graph.microsoft.com/Mail.Send', 'https://graph.microsoft.com/User.Read'] as const;

/** The redirect URI registered on the app registration: our callback function. */
export function mailboxRedirectUri(region: string, projectId: string): string {
  return `https://${region}-${projectId}.cloudfunctions.net/matterMailboxCallback`;
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function authorizeUrl(input: { clientId: string; redirectUri: string; state: string; verifier: string; loginHint?: string | null }): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    response_type: 'code',
    redirect_uri: input.redirectUri,
    // the code comes back in a POST body, never in a URL (and so never in a request log)
    response_mode: 'form_post',
    scope: MAILBOX_SCOPES.join(' '),
    state: input.state,
    code_challenge: pkceChallenge(input.verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${MS_AUTHORITY}/authorize?${params.toString()}`;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

/** A refused or failed token call: 'revoked' (invalid_grant: the access is gone), 'client' (our secret or app). */
export class MailboxAuthError extends Error {
  constructor(
    readonly kind: 'revoked' | 'client' | 'scope' | 'timeout' | 'connection' | 'server' | 'unknown',
    readonly code: string | null,
  ) {
    super(`Microsoft sign-in failed: ${kind}${code ? ` (${code})` : ''}`);
    this.name = 'MailboxAuthError';
  }
}

export interface GraphConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  timeoutMs: number;
  fetch?: FetchLike;
}

const doFetch = (config: Pick<GraphConfig, 'fetch'>): FetchLike => config.fetch ?? ((url, init) => fetch(url, init));

async function call(config: Pick<GraphConfig, 'fetch' | 'timeoutMs'>, url: string, init: { method: string; headers: Record<string, string>; body?: string }) {
  try {
    return await doFetch(config)(url, { ...init, signal: AbortSignal.timeout(config.timeoutMs) });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { failed: name === 'TimeoutError' || name === 'AbortError' ? ('timeout' as const) : ('connection' as const) };
  }
}

async function bodyOf(response: { json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface TokenSet {
  accessToken: string;
  /** Microsoft rotates it: the newest one replaces the stored one. */
  refreshToken: string | null;
  scopes: string[];
}

async function tokenCall(config: GraphConfig, form: Record<string, string>): Promise<TokenSet> {
  const response = await call(config, `${MS_AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...form }).toString(),
  });
  if ('failed' in response) throw new MailboxAuthError(response.failed, null);
  const body = await bodyOf(response);
  if (response.status === 200 && typeof body.access_token === 'string' && body.access_token) {
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
      scopes: typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : [],
    };
  }
  const code = typeof body.error === 'string' ? body.error : null;
  if (code === 'invalid_grant' || code === 'interaction_required' || code === 'consent_required') throw new MailboxAuthError('revoked', code);
  if (code === 'invalid_client' || code === 'unauthorized_client' || code === 'invalid_request') throw new MailboxAuthError('client', code);
  if (response.status >= 500) throw new MailboxAuthError('server', code ?? String(response.status));
  throw new MailboxAuthError('unknown', code ?? String(response.status));
}

/** Whether the granted scopes include sending mail (the owner may untick it on the consent page). */
export function grantsSend(scopes: readonly string[]): boolean {
  return scopes.some((s) => s.toLowerCase() === 'mail.send' || s.toLowerCase() === 'https://graph.microsoft.com/mail.send');
}

export async function exchangeCode(config: GraphConfig, code: string, verifier: string): Promise<TokenSet & { refreshToken: string }> {
  const tokens = await tokenCall(config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
    scope: MAILBOX_SCOPES.join(' '),
  });
  if (!tokens.refreshToken) throw new MailboxAuthError('scope', 'no_refresh_token');
  if (!grantsSend(tokens.scopes)) throw new MailboxAuthError('scope', 'no_mail_send');
  return { ...tokens, refreshToken: tokens.refreshToken };
}

export function refreshAccess(config: GraphConfig, refreshToken: string): Promise<TokenSet> {
  return tokenCall(config, { grant_type: 'refresh_token', refresh_token: refreshToken, scope: MAILBOX_SCOPES.join(' ') });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The owner's own address (User.Read): mail, else the sign-in name of a personal account. */
export async function readOwnAddress(config: Pick<GraphConfig, 'fetch' | 'timeoutMs'>, accessToken: string): Promise<{ address: string; name: string | null }> {
  const response = await call(config, `${GRAPH_ROOT}/me?$select=mail,userPrincipalName,displayName`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if ('failed' in response) throw new MailboxAuthError(response.failed, null);
  const body = await bodyOf(response);
  if (response.status !== 200) throw new MailboxAuthError(response.status >= 500 ? 'server' : 'unknown', String(response.status));
  const candidates = [body.mail, body.userPrincipalName].filter((v): v is string => typeof v === 'string' && EMAIL_RE.test(v.trim()));
  const address = candidates[0]?.trim().toLowerCase();
  if (!address) throw new MailboxAuthError('scope', 'no_address');
  return { address, name: typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim().slice(0, 100) : null };
}

const recipients = (list: readonly string[]) => list.map((address) => ({ emailAddress: { address } }));

/** The Graph sendMail body: plain text, our Reply-To, saved in the owner's Sent Items. */
export function graphMessage(email: OutboundEmail): Record<string, unknown> {
  return {
    message: {
      subject: email.subject,
      body: { contentType: 'Text', content: email.text },
      toRecipients: recipients(email.to),
      ...(email.cc.length ? { ccRecipients: recipients(email.cc) } : {}),
      replyTo: recipients([email.replyTo]),
    },
    saveToSentItems: true,
  };
}

/**
 * POST /me/sendMail. 202 is accepted. A 401 or 403 after a fresh access token means the access no
 * longer allows sending (MailboxSendError 'revoked'); the others map like Postmark's.
 */
export async function sendMailboxEmail(config: Pick<GraphConfig, 'fetch' | 'timeoutMs'>, accessToken: string, email: OutboundEmail): Promise<void> {
  const response = await call(config, `${GRAPH_ROOT}/me/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(graphMessage(email)),
  });
  if ('failed' in response) throw new EmailSendError(response.failed, null);
  if (response.status === 202 || response.status === 200) return;
  if (response.status === 401 || response.status === 403) throw new MailboxSendError('revoked');
  if (response.status === 429) throw new EmailSendError('rate_limited', 429);
  if (response.status >= 500) throw new EmailSendError('server', response.status);
  if (response.status === 400 || response.status === 422) throw new EmailSendError('rejected', response.status);
  throw new EmailSendError('unknown', response.status);
}
