/**
 * M14: guest invitation links (Project-Plan-2026-11-09.md, M14). Pure handlers on ports.
 *
 * - One link per meeting: a 256-bit random token (43 base64url characters), stored only as its
 *   sha256 hash in guestLinks/{hash}; the owner's copy of the token lives in
 *   guestMeetings/{uid}__{meetingId} so the app can ask for it again (guestLinkCreate is
 *   idempotent). The token travels in the URL fragment, never in a query string or a log.
 * - The guest page (no sign-in) asks guestView for what it may show: the title, the start, the
 *   duration, the zone and the organizer's name. Never the other guests, the description, the
 *   place or the call link. Every bad, expired or revoked token gets the same answer shape.
 * - guestRespond stores one answer per guest browser (users/{uid}/guestResponses/{id}, the
 *   owner reads it); a proposal changes nothing until the owner approves it in the app, which
 *   then writes the meeting as a normal user edit, so alarms and calendars follow.
 * - Limits: per IP and day, per link and day. Logs carry the first 8 characters of the hash only.
 */
import { createHash, randomBytes } from 'node:crypto';

import {
  GUEST_LANGUAGES,
  GUEST_LIMITS,
  GUEST_TOKEN_PATTERN,
  type GuestLinkState,
  type GuestResponseDoc,
  type GuestRespondRequest,
  type GuestRespondResponse,
  type GuestViewResponse,
} from '../shared/aiContract';
import { expandOccurrences, type RecurringMeetingLike } from '../shared/recurrence';
import { isValidTimeZone, toLocalDateTime } from '../shared/time';

export const GUEST_TUNING = {
  /** A link lives this long after it was made; the meeting's own end closes it earlier. */
  linkDays: 400,
  viewsPerLinkPerDay: 500,
  responsesPerLinkPerDay: 60,
  requestsPerIpPerDay: 400,
  /** A proposal must start within this many days. */
  proposalHorizonDays: 365,
  /** Answers are kept this long after the meeting (maintenance purge). */
  responseRetentionDays: 30,
} as const;

const DAY_MS = 86_400_000;

export function newGuestToken(): string {
  return randomBytes(32).toString('base64url');
}

export function linkHashOf(token: string): string {
  return createHash('sha256').update(`mg-guest:v1:${token}`).digest('hex');
}

export function responseIdOf(linkHash: string, clientId: string): string {
  return createHash('sha256').update(`mg-guest-response:v1:${linkHash}:${clientId}`).digest('hex').slice(0, 40);
}

export function ipKeyOf(ip: string, day: string): string {
  return createHash('sha256').update(`mg-guest-ip:v1:${ip}:${day}`).digest('hex').slice(0, 40);
}

export function dayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------------------------

export interface GuestLinkRecord {
  uid: string;
  meetingId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface GuestStore {
  /** guestMeetings/{uid}__{meetingId}: the live token of a meeting, or null. */
  getMeetingToken(uid: string, meetingId: string): Promise<{ token: string; expiresAt: string } | null>;
  /** Writes guestLinks/{hash} and guestMeetings/{uid}__{meetingId} together. */
  saveLink(token: string, record: GuestLinkRecord): Promise<void>;
  /** Marks the meeting's link revoked and forgets its token. false when none. */
  revoke(uid: string, meetingId: string, now: Date): Promise<boolean>;
  getLink(linkHash: string): Promise<GuestLinkRecord | null>;
  /** Atomically adds one to a per-day counter and returns the new value. */
  bump(key: string, now: Date): Promise<number>;
  /** users/{uid}/meetings/{meetingId} raw, undefined when missing. */
  getMeeting(uid: string, meetingId: string): Promise<Record<string, unknown> | undefined>;
  getOwner(uid: string): Promise<{ name: string | null; language: string | null }>;
  getResponse(uid: string, responseId: string): Promise<GuestResponseDoc | null>;
  saveResponse(uid: string, responseId: string, doc: GuestResponseDoc): Promise<void>;
}

export interface GuestDeps {
  store: GuestStore;
  now: () => Date;
  newToken?: () => string;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export class GuestError extends Error {
  constructor(readonly reason: 'invalid_request' | 'rate_limited') {
    super(reason);
    this.name = 'GuestError';
  }
}

// ---------------------------------------------------------------------------------------------
// Owner side
// ---------------------------------------------------------------------------------------------

export async function handleLinkCreate(uid: string, meetingId: string, deps: GuestDeps): Promise<{ token: string; expiresAt: string }> {
  const now = deps.now();
  const existing = await deps.store.getMeetingToken(uid, meetingId);
  if (existing !== null && Date.parse(existing.expiresAt) > now.getTime() && GUEST_TOKEN_PATTERN.test(existing.token)) return existing;
  // The meeting may not be in Firestore yet (the form asks before the first save); guestView
  // checks it at every view instead.
  const token = (deps.newToken ?? newGuestToken)();
  const expiresAt = new Date(now.getTime() + GUEST_TUNING.linkDays * DAY_MS).toISOString();
  await deps.store.saveLink(token, { uid, meetingId, createdAt: now.toISOString(), expiresAt, revokedAt: null });
  deps.log?.('guests.link_created', { uid, meetingId, link: linkHashOf(token).slice(0, 8) });
  return { token, expiresAt };
}

export async function handleLinkRevoke(uid: string, meetingId: string, deps: GuestDeps): Promise<{ revoked: boolean }> {
  const revoked = await deps.store.revoke(uid, meetingId, deps.now());
  deps.log?.('guests.link_revoked', { uid, meetingId, revoked });
  return { revoked };
}

// ---------------------------------------------------------------------------------------------
// Guest side
// ---------------------------------------------------------------------------------------------

interface Resolved {
  state: GuestLinkState;
  linkHash: string | null;
  link: GuestLinkRecord | null;
  meeting: NonNullable<GuestViewResponse['meeting']> | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The meeting as the guest sees it, with the next occurrence of a series; null when unreadable. */
export function guestMeetingOf(raw: Record<string, unknown>, now: Date): { meeting: NonNullable<GuestViewResponse['meeting']>; endMs: number } | null {
  const startAt = str(raw.startAt);
  const zone = str(raw.timezone);
  if (startAt === null || zone === null || !isValidTimeZone(zone) || !Number.isFinite(Date.parse(startAt))) return null;
  const duration = typeof raw.durationMinutes === 'number' ? Math.max(1, Math.min(20_160, Math.round(raw.durationMinutes))) : 30;
  const allDay = raw.allDay === true;
  const title = (str(raw.title) ?? '').slice(0, 200);
  const recurring = raw.recurrence !== undefined && raw.recurrence !== null;
  if (!recurring) {
    const startMs = Date.parse(startAt);
    return { meeting: { title, startAt: new Date(startMs).toISOString(), durationMinutes: duration, allDay, timezone: zone, recurring: false }, endMs: startMs + duration * 60_000 };
  }
  const local = toLocalDateTime(startAt, zone);
  const like: RecurringMeetingLike = {
    id: 'm',
    title,
    date: local.date,
    time: local.time,
    timezone: zone,
    durationMinutes: duration,
    allDay,
    recurrence: raw.recurrence as RecurringMeetingLike['recurrence'],
    recurrenceOverrides: (raw.recurrenceOverrides ?? null) as RecurringMeetingLike['recurrenceOverrides'],
  };
  try {
    const next = expandOccurrences(like, now.toISOString(), new Date(now.getTime() + 400 * DAY_MS).toISOString(), { max: 1 })[0];
    if (!next) return { meeting: { title, startAt: new Date(Date.parse(startAt)).toISOString(), durationMinutes: duration, allDay, timezone: zone, recurring: true }, endMs: 0 };
    return {
      meeting: { title: next.title.slice(0, 200), startAt: next.startAt, durationMinutes: next.durationMinutes, allDay, timezone: zone, recurring: true },
      endMs: Date.parse(next.endAt),
    };
  } catch {
    return null;
  }
}

async function resolve(token: string, deps: GuestDeps): Promise<Resolved> {
  const none = (state: GuestLinkState): Resolved => ({ state, linkHash: null, link: null, meeting: null });
  if (!GUEST_TOKEN_PATTERN.test(token)) return none('invalid');
  const linkHash = linkHashOf(token);
  const link = await deps.store.getLink(linkHash);
  if (link === null) return none('invalid');
  const now = deps.now();
  if (link.revokedAt !== null) return { ...none('revoked'), linkHash, link };
  if (Date.parse(link.expiresAt) <= now.getTime()) return { ...none('expired'), linkHash, link };
  const raw = await deps.store.getMeeting(link.uid, link.meetingId);
  if (raw === undefined || (raw.deletedAt !== undefined && raw.deletedAt !== null) || raw.status === 'cancelled' || raw.status === 'deleted') {
    return { ...none('cancelled'), linkHash, link };
  }
  const view = guestMeetingOf(raw, now);
  if (view === null) return { ...none('cancelled'), linkHash, link };
  if (view.endMs <= now.getTime()) return { state: 'past', linkHash, link, meeting: view.meeting };
  return { state: 'open', linkHash, link, meeting: view.meeting };
}

async function rateCheck(ip: string | null, deps: GuestDeps): Promise<void> {
  if (ip === null) return;
  const now = deps.now();
  const count = await deps.store.bump(`ip:${ipKeyOf(ip, dayOf(now))}`, now);
  if (count > GUEST_TUNING.requestsPerIpPerDay) throw new GuestError('rate_limited');
}

function languageOf(value: string | null): GuestViewResponse['language'] {
  return (GUEST_LANGUAGES as readonly string[]).includes(value ?? '') ? (value as GuestViewResponse['language']) : 'en';
}

export async function handleView(request: { token: string; clientId?: string | undefined }, ip: string | null, deps: GuestDeps): Promise<GuestViewResponse> {
  await rateCheck(ip, deps);
  const resolved = await resolve(request.token, deps);
  const empty: GuestViewResponse = { state: resolved.state, meeting: null, organizerName: null, language: 'en', canPropose: false, myResponse: null };
  if (resolved.link === null || resolved.linkHash === null) return empty;
  const now = deps.now();
  const views = await deps.store.bump(`view:${resolved.linkHash}:${dayOf(now)}`, now);
  if (views > GUEST_TUNING.viewsPerLinkPerDay) throw new GuestError('rate_limited');
  const owner = await deps.store.getOwner(resolved.link.uid);
  let myResponse: GuestViewResponse['myResponse'] = null;
  if (request.clientId !== undefined && resolved.state === 'open') {
    const stored = await deps.store.getResponse(resolved.link.uid, responseIdOf(resolved.linkHash, request.clientId));
    if (stored !== null && stored.meetingId === resolved.link.meetingId) myResponse = { kind: stored.kind, proposedStartAt: stored.proposedStartAt };
  }
  deps.log?.('guests.view', { link: resolved.linkHash.slice(0, 8), state: resolved.state });
  const visible = resolved.state === 'open' || resolved.state === 'past';
  return {
    state: resolved.state,
    meeting: visible ? resolved.meeting : null,
    organizerName: visible ? owner.name : null,
    language: languageOf(owner.language),
    // A series takes accept and decline only; an all-day meeting has no time to propose.
    canPropose: resolved.state === 'open' && resolved.meeting !== null && !resolved.meeting.recurring && !resolved.meeting.allDay,
    myResponse,
  };
}

/** Control characters out, spaces collapsed, cut to max; null when empty. */
export function cleanGuestText(value: string | undefined, max: number): string | null {
  if (value === undefined) return null;
  // Control and direction characters are exactly what this strips.
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length === 0 ? null : flat.slice(0, max);
}

export function cleanGuestEmail(value: string | undefined): string | null {
  const flat = cleanGuestText(value, GUEST_LIMITS.maxEmailChars)?.toLowerCase() ?? null;
  return flat !== null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(flat) ? flat : null;
}

export async function handleRespond(request: GuestRespondRequest, ip: string | null, deps: GuestDeps): Promise<GuestRespondResponse> {
  await rateCheck(ip, deps);
  const resolved = await resolve(request.token, deps);
  if (resolved.state !== 'open' || resolved.link === null || resolved.linkHash === null || resolved.meeting === null) {
    return { state: resolved.state, saved: false };
  }
  const now = deps.now();
  const responses = await deps.store.bump(`respond:${resolved.linkHash}:${dayOf(now)}`, now);
  if (responses > GUEST_TUNING.responsesPerLinkPerDay) throw new GuestError('rate_limited');
  let proposedStartAt: string | null = null;
  if (request.kind === 'proposed') {
    if (resolved.meeting.recurring || resolved.meeting.allDay) throw new GuestError('invalid_request');
    const ms = Date.parse(request.proposedStartAt ?? '');
    if (!Number.isFinite(ms) || ms <= now.getTime() || ms > now.getTime() + GUEST_TUNING.proposalHorizonDays * DAY_MS) throw new GuestError('invalid_request');
    proposedStartAt = new Date(ms).toISOString();
  }
  const uid = resolved.link.uid;
  const responseId = responseIdOf(resolved.linkHash, request.clientId);
  const previous = await deps.store.getResponse(uid, responseId);
  const nowIso = now.toISOString();
  const doc: GuestResponseDoc = {
    v: 1,
    meetingId: resolved.link.meetingId,
    kind: request.kind,
    guestName: cleanGuestText(request.name, GUEST_LIMITS.maxNameChars),
    guestEmail: cleanGuestEmail(request.email),
    proposedStartAt,
    message: cleanGuestText(request.message, GUEST_LIMITS.maxMessageChars),
    meetingStartAtSeen: resolved.meeting.startAt,
    createdAt: previous?.createdAt ?? nowIso,
    updatedAt: nowIso,
    state: 'new',
    decidedAt: null,
  };
  await deps.store.saveResponse(uid, responseId, doc);
  deps.log?.('guests.response', { link: resolved.linkHash.slice(0, 8), kind: request.kind, update: previous !== null });
  return { state: 'open', saved: true };
}
