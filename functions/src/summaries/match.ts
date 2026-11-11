/**
 * M10 matching: which meeting a notetaker summary belongs to, and whether it may be filed without
 * asking (docs/v2/M10-DESIGN.md section 6, section 5 decision table rows 7 to 10, section 12
 * Matching). PURE: no Firebase, no logging, no clock (the caller passes `now`). Reading Firestore
 * and expanding series is candidates.ts; this module takes plain occurrences.
 *
 * Scores (all rounded to 4 decimals, compared after rounding so a threshold never flips on a
 * floating-point remainder):
 * - Title T (0 to 1), the better of the summary's titleLine and subjectClean against the meeting
 *   title: 1.0 on equal normalizeTitle() values; else the best of token Dice, 0.85 when every
 *   token of the shorter set is in the longer one, and 0.6 for one shared distinctive token
 *   (at least 4 letters, not generic, not a stopword). Tokens drop English and Spanish stopwords
 *   ("with", "the", "de", "con", ...), so "Call with the team" and "Lunch with the CEO" share
 *   nothing.
 * - Time M, from lag = anchor minus the meeting's SCHEDULED end, in minutes:
 *   - no anchor: 0.5;
 *   - anchor at or before start minus 15 minutes ("written before the meeting began"): 0. With a
 *     signed anchor the start gate already drops these, so this only applies to unsigned anchors;
 *   - "ended early": the anchor is after start minus 15 minutes but more than 15 minutes before
 *     the scheduled end (lag < -15): 0.6;
 *   - -15 <= lag <= 60: 1.0; 60 < lag < 360: falls linearly to 0; lag >= 360: 0;
 *   - an unsigned anchor caps M at 0.8.
 * - S = 0.65 T + 0.35 M, plus 0.15 when the meeting's conference link appears in the summary text,
 *   capped at 1.
 *
 * Hard gates, per candidate: deleted dropped; with a signed anchor the start must be before anchor
 * plus 15 minutes; with summaryDate D the start's local date must equal D in the meeting's zone,
 * the preferences zone or UTC (in that order; zoneUsed records which one). An all-day meeting is
 * checked in its own zone only (its start is local midnight there; any other zone shifts the day).
 * Rejected meeting ids drop the WHOLE group they belong to, so "Not this meeting" on the Outlook
 * copy cannot come back through the phone-calendar duplicate. Cancelled and all-day meetings stay
 * as suggestions but are never filed automatically.
 *
 * Grouping: same start within 5 minutes, same duration in minutes and the same normalized title
 * count as one meeting (Outlook plus the phone calendar). The representative follows the source
 * priority outlook, google, manual, ai_chat, whatsapp, device; the others go to
 * duplicateMeetingIds. A group's scores are its best-scoring member's; a group is suggestion-only
 * when ANY member is cancelled or all-day.
 *
 * Decision (decide()):
 * - Rule A, the only automatic filing: tier vendor_verified, recipientBound, fresh and a signed
 *   anchor (fresh implies one), the top group not cancelled or all-day, T >= 0.35, S >= 0.60, and
 *   no second group within 0.15 of the top S.
 * - Otherwise the summary waits in the inbox. The trust facts give the reason first (rows 8 to 10:
 *   old_summary, not_addressed_to_you, user_forwarded); for a bound, fresh vendor recap the scores
 *   give it: no_date (no summaryDate and no anchor; nothing is scored), no_candidate (no group
 *   survives the gates), ambiguous (a second group within 0.15, both at S >= 0.20, one of them
 *   with T >= 0.35), needs_confirmation (rule B: exactly one group after the gates with T >= 0.6
 *   and M >= 0.5; or a top group that passes rule A's scores but is cancelled or all-day), weak
 *   (everything else).
 * - Suggestions (stored as candidates[]): the top 3 groups with S >= 0.20, best first; none on
 *   not_addressed_to_you items (finding 7) and none for no_date.
 *
 * Nothing here returns summary content: reasons are fixed codes, titles in the result are the
 * user's own meeting titles (the meetingSnapshot), and no input text is echoed.
 */
import { z } from 'zod';

import {
  LOCAL_DATE_KEY_PATTERN,
  MEETING_ID_PATTERN,
  SUMMARY_LIMITS,
  isoDateTimeSchema,
  type SummaryInboxReason,
  type SummaryTier,
} from '../shared/aiContract';
import { isLocalDate, isValidTimeZone, toDate, toLocalDateTime } from '../shared/time';

// ---------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------

/** Every matching constant (recalibrated on Francisco's real recaps; design section 6). */
export const SUMMARIES_TUNING = {
  /** S = title * T + time * M (+ conferenceBonus), capped at 1. */
  weights: { title: 0.65, time: 0.35 },
  conferenceBonus: 0.15,
  title: {
    equal: 1,
    subset: 0.85,
    sharedDistinctiveWord: 0.6,
    /** A distinctive token has at least this many letters (and is not generic or a stopword). */
    distinctiveMinLetters: 4,
  },
  time: {
    /** lag = anchor minus the scheduled end, in minutes; M is 1.0 from fullFrom to fullTo. */
    fullFromMinutes: -15,
    fullToMinutes: 60,
    /** M falls linearly from 1.0 at fullTo to 0 here. */
    zeroAtMinutes: 360,
    /** The anchor is more than 15 minutes before the scheduled end, after the start tolerance. */
    endedEarly: 0.6,
    noAnchor: 0.5,
    unsignedAnchorCap: 0.8,
  },
  /**
   * With a signed anchor the meeting must start before anchor plus this; for any anchor at or
   * before start minus this, M is 0 (written before the meeting began).
   */
  startToleranceMinutes: 15,
  /** Two candidates are one meeting when their starts are at most this far apart (plus same duration and title). */
  groupStartToleranceMinutes: 5,
  ruleA: { minTitleScore: 0.35, minScore: 0.6, tieWithin: 0.15 },
  ruleB: { minTitleScore: 0.6, minTimeScore: 0.5 },
  suggestions: { minScore: 0.2, max: SUMMARY_LIMITS.maxSuggestions },
} as const;

/** Representative choice inside a duplicate group, best first. Unknown sources rank last. */
export const SUMMARY_SOURCE_PRIORITY = ['outlook', 'google', 'manual', 'ai_chat', 'whatsapp', 'device'] as const;

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** One meeting occurrence that could own the summary (candidates.ts builds these). */
export const matchCandidateSchema = z.object({
  /** The master id for a series. */
  meetingId: z.string().regex(MEETING_ID_PATTERN),
  /** For a series: the ORIGINAL local date of the occurrence (the recurrenceOverrides key); else null. */
  occurrenceDate: z.string().regex(LOCAL_DATE_KEY_PATTERN).nullable(),
  title: z.string(),
  /** Effective start and end of this occurrence (a moved occurrence at its moved time). */
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  timezone: z.string().max(64),
  allDay: z.boolean(),
  cancelled: z.boolean(),
  /** Tombstone (deletedAt set). */
  deleted: z.boolean(),
  /** MeetingSource ('outlook', 'google', 'manual', 'ai_chat', 'whatsapp', 'device'). */
  source: z.string().max(32),
  conferenceUrl: z.string().max(2048).nullable(),
});
export type MatchCandidate = z.infer<typeof matchCandidateSchema>;

export interface MatchAnchor {
  /** ISO instant: the signed Date header for vendor mail, the forward wrapper's Date for user forwards. */
  at: string;
  /** "date" is in the deciding signature's signed headers. */
  signed: boolean;
}

export interface MatchInput {
  /** Trust facts fixed at receipt (section 5). */
  tier: SummaryTier;
  recipientBound: boolean;
  fresh: boolean;
  /** First meaningful body line (content: never logged). */
  titleLine: string | null;
  /** Subject without Fwd/Re/RV and vendor prefixes (normalizeTitle strips them again anyway). */
  subjectClean: string | null;
  /** YYYY-MM-DD found in the summary, or null. */
  summaryDate: string | null;
  anchor: MatchAnchor | null;
  /** The sanitized summary text, searched for conference links only. */
  text: string;
  /** The user's preferences zone, or null. */
  preferencesTimeZone: string | null;
  /** Meetings the user said this summary is not about ("Not this meeting"). */
  rejectedMeetingIds: readonly string[];
  candidates: readonly MatchCandidate[];
  /** matchedAt. */
  now: Date;
}

/** Which zone made the start's local date equal summaryDate; null when there is no summaryDate. */
export type ZoneUsed = 'meeting' | 'preferences' | 'utc';

export type TitleReason = 'title_equal' | 'title_words' | 'title_subset' | 'title_shared_word' | 'title_none';
export type TimeReason =
  | 'time_no_anchor'
  | 'time_close'
  | 'time_late'
  | 'time_too_late'
  | 'time_ended_early'
  | 'time_before_start';

/** Fixed reason codes (never content); safe to store and to log. */
export type MatchReason =
  | TitleReason
  | 'title_from_subject'
  | TimeReason
  | 'time_unsigned_anchor'
  | 'conference_link'
  | 'date_meeting_zone'
  | 'date_preferences_zone'
  | 'date_utc'
  | 'cancelled'
  | 'all_day'
  | 'duplicates_grouped'
  | 'rule_a';

/** What the scores alone conclude ('confident' = rule A's score conditions hold). */
export type MatchOutcome =
  | 'confident'
  | Extract<SummaryInboxReason, 'needs_confirmation' | 'ambiguous' | 'weak' | 'no_candidate' | 'no_date'>;

export interface TitleScore {
  score: number;
  reason: TitleReason;
}

export interface TimeScore {
  score: number;
  /** The band, plus 'time_unsigned_anchor' when the cap applied. */
  reasons: (TimeReason | 'time_unsigned_anchor')[];
}

/** A suggestion (stored candidates[] entry): one duplicate group, by its representative. */
export interface SummaryMatchCandidate {
  meetingId: string;
  occurrenceDate: string | null;
  duplicateMeetingIds: string[];
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  /** S. */
  score: number;
  /** T. */
  titleScore: number;
  /** M. */
  timeScore: number;
  reasons: MatchReason[];
  zoneUsed: ZoneUsed | null;
  cancelled: boolean;
  allDay: boolean;
}

/** The stored `match` (design section 6, Stored). */
export interface StoredSummaryMatch {
  meetingId: string;
  occurrenceDate: string | null;
  duplicateMeetingIds: string[];
  method: 'auto';
  score: number;
  titleScore: number;
  timeScore: number;
  reasons: MatchReason[];
  zoneUsed: ZoneUsed | null;
  matchedAt: string;
  meetingSnapshot: { title: string; startAt: string; endAt: string; timezone: string };
}

export interface MatchRecord {
  /** 'matched' only through rule A. */
  status: 'matched' | 'inbox';
  /** Null exactly when status is 'matched'. */
  inboxReason: SummaryInboxReason | null;
  outcome: MatchOutcome;
  match: StoredSummaryMatch | null;
  /** Suggestions, best first (max 3, S >= 0.20); empty on not_addressed_to_you and no_date. */
  candidates: SummaryMatchCandidate[];
  rejectedMeetingIds: string[];
  /** Groups that survived the gates (for logs and calibration). */
  groupCount: number;
}

// ---------------------------------------------------------------------------------------------
// Title normalization
// ---------------------------------------------------------------------------------------------

/** Generic meeting words (English and Spanish, accent-free): never "distinctive". */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  // English (design list plus plurals and close relatives)
  'meeting', 'meetings', 'call', 'calls', 'sync', 'syncs', 'weekly', 'daily', 'standup', 'standups',
  'update', 'updates', 'review', 'reviews', 'team', 'teams', 'project', 'projects', 'planning',
  'plan', 'plans', 'discussion', 'discussions', 'status', 'check', 'checkin', 'demo', 'demos',
  'kickoff', 'monthly', 'quarterly', 'biweekly', 'session', 'sessions', 'catchup', 'chat',
  'huddle', 'notes', 'summary', 'recap', 'minutes', 'agenda', 'internal', 'general', 'online',
  'virtual', 'followup', 'follow', 'meet', 'zoom',
  // Spanish
  'reunion', 'reuniones', 'junta', 'juntas', 'llamada', 'llamadas', 'sincronizacion', 'semanal',
  'semanales', 'diaria', 'diario', 'diarias', 'diarios', 'actualizacion', 'actualizaciones',
  'revision', 'revisiones', 'equipo', 'equipos', 'proyecto', 'proyectos', 'planificacion',
  'planeacion', 'discusion', 'estado', 'seguimiento', 'demostracion', 'arranque', 'inicio',
  'sesion', 'sesiones', 'mensual', 'quincenal', 'trimestral', 'interna', 'interno', 'notas',
  'resumen', 'minuta', 'acta',
  // Months and weekdays (a shared "october" or "monday" says nothing about the meeting)
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'sept',
  'october', 'november', 'december', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre', 'monday',
  'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'lunes', 'martes',
  'miercoles', 'jueves', 'viernes', 'sabado', 'domingo',
]);

/** Function words dropped from the token sets (English and Spanish, accent-free). */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'with', 'by', 'from', 'about',
  'vs', 'x', 'our', 'your', 'my', 'this', 'that', 'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e',
  'o', 'u', 'con', 'para', 'por', 'en', 'sobre', 'un', 'una', 'al', 'su', 'sus', 'mi', 'tu',
]);

/** Notetaker names that prefix or suffix subjects ("Fireflies.ai notes for ..."). */
const VENDOR_NAMES = [
  'fireflies.ai', 'fireflies', 'otter.ai', 'fathom', 'read.ai', 'tl;dv', 'tldv', 'granola', 'avoma',
  'bluedot', 'meetgeek', 'sembly', 'notta', 'tactiq', 'zoom ai companion', 'microsoft teams',
  'google meet', 'zoom',
];

/** Notetaker labels ("Meeting notes", "Resumen de la reunion"), accent-free. */
const SUMMARY_LABELS = [
  'meeting notes', 'meeting summary', 'meeting recap', 'meeting minutes', 'meeting report',
  'call notes', 'call summary', 'call recap', 'ai meeting notes', 'ai notes', 'ai summary',
  'your meeting notes', 'your meeting summary', 'your meeting recap', 'your notes', 'your summary',
  'your recap', 'notes', 'summary', 'recap', 'minutes', 'notas de la reunion', 'notas de reunion',
  'notas de la junta', 'notas de la llamada', 'resumen de la reunion', 'resumen de reunion',
  'resumen de la junta', 'resumen de la llamada', 'minuta de la reunion', 'minuta de reunion',
  'acta de la reunion', 'acta de reunion', 'tus notas', 'tu resumen', 'notas', 'resumen', 'minuta',
  'acta',
];

/** Words that join a leading label to the title ("Notes for X", "Resumen de X"). */
const LABEL_CONNECTORS = ['for', 'of', 'from', 'on', 'about', 'de', 'del', 'sobre', 'para'];

function alternation(words: readonly string[]): string {
  return [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
    .join('|');
}

const VENDORS_RE = alternation(VENDOR_NAMES);
const LABELS_RE = alternation(SUMMARY_LABELS);
const CONNECTORS_RE = alternation(LABEL_CONNECTORS);

/** Separators after the first pass: "-", "|" and ":" (dashes and dots are unified to these). */
const SEP = '[:|-]';

const REPLY_PREFIX = /^(?:(?:re|fw|fwd|rv|tr|enc|res|aw|wg|rif)\s*(?:\[\d{1,3}\]|\(\d{1,3}\))?\s*:\s*)+/;
const TAG_PREFIX = /^(?:\[[^\]]{0,40}\]\s*)+/;
const VENDOR_LABEL_PREFIX = new RegExp(
  `^(?:(?:${VENDORS_RE})\\s*(?:${SEP}\\s*)?)?(?:${LABELS_RE})(?:\\s*${SEP}\\s*|\\s+(?:${CONNECTORS_RE})\\s+|\\s*$)`,
);
const VENDOR_PREFIX = new RegExp(`^(?:${VENDORS_RE})\\s*${SEP}\\s*`);
const LABEL_SUFFIX = new RegExp(`\\s*(?:${SEP}|\\()\\s*(?:(?:${VENDORS_RE})\\s+)?(?:${LABELS_RE})\\s*\\)?$`);
const VENDOR_SUFFIX = new RegExp(`\\s*(?:${SEP}|\\()\\s*(?:(?:by|via|por)\\s+)?(?:${VENDORS_RE})\\s*\\)?$`);

const MONTHS_RE =
  'jan(?:uary)?|feb(?:ruary|rero)?|mar(?:ch|zo)?|apr(?:il)?|abr(?:il)?|may(?:o)?|jun(?:e|io)?|jul(?:y|io)?|aug(?:ust)?|ago(?:sto)?|sep(?:t(?:ember)?|tiembre)?|set(?:iembre)?|oct(?:ober|ubre)?|nov(?:ember|iembre)?|dec(?:ember)?|dic(?:iembre)?|ene(?:ro)?';
const WEEKDAYS_RE =
  'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|lun(?:es)?|mar(?:tes)?|mie(?:rcoles)?|jue(?:ves)?|vie(?:rnes)?|sab(?:ado)?|dom(?:ingo)?';
const DAY_SUFFIX = '(?:st|nd|rd|th)?';
const DATE_CORE_RE = [
  // 2026-10-16, 2026/10/16, 2026.10.16
  '\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}',
  // 16/10/2026, 10-16-26, 16.10.2026 (dots only with a 4-digit year, so "1.2.10" stays)
  '\\d{1,2}[/-]\\d{1,2}[/-](?:\\d{4}|\\d{2})',
  '\\d{1,2}\\.\\d{1,2}\\.\\d{4}',
  // Oct 16, 2026 / October 16 / octubre 16, 2026
  `(?:${MONTHS_RE})\\.?\\s+\\d{1,2}${DAY_SUFFIX}(?:,?\\s+\\d{4})?`,
  // 16 Oct 2026 / 16 de octubre de 2026
  `\\d{1,2}${DAY_SUFFIX}\\s+(?:de\\s+)?(?:${MONTHS_RE})\\.?(?:,?\\s+(?:de\\s+|del\\s+)?\\d{4})?`,
].join('|');
const TIME_RE = '\\d{1,2}:\\d{2}(?:\\s*(?:am|pm|a\\.m\\.|p\\.m\\.|h|hrs))?|\\d{1,2}\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)';
const TRAILING_DATE = new RegExp(
  `(?:^|[\\s,:|(\\[-]+)(?:(?:on|el|del|from)\\s+)?(?:(?:${WEEKDAYS_RE})\\.?,?\\s+)?(?:${DATE_CORE_RE})(?:,?\\s+(?:at\\s+|a\\s+las\\s+)?(?:${TIME_RE}))?\\s*[)\\]]?\\s*$`,
);
const TRAILING_TIME = new RegExp(`(?:^|[\\s,|(\\[-]+)(?:at\\s+|@\\s*|a\\s+las\\s+)?(?:${TIME_RE})\\s*[)\\]]?\\s*$`);
const LEADING_ISO_DATE = /^\d{4}-\d{1,2}-\d{1,2}(?:\s*[:|-]\s*|\s+)/;

const MAX_STRIP_PASSES = 6;

/** Cuts to `max` UTF-16 units without splitting a surrogate pair. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const code = value.charCodeAt(max - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

function stripOnce(value: string): string {
  let s = value.replace(TAG_PREFIX, '').replace(REPLY_PREFIX, '');
  s = s.replace(VENDOR_LABEL_PREFIX, '').replace(VENDOR_PREFIX, '').replace(LEADING_ISO_DATE, '');
  s = s.replace(TRAILING_DATE, '').replace(TRAILING_TIME, '');
  s = s.replace(LABEL_SUFFIX, '').replace(VENDOR_SUFFIX, '');
  return s.trim();
}

/**
 * Comparable form of a title: NFKD with accents removed, lowercase, "&" as "and", reply and
 * forward prefixes, [tags], notetaker names and labels ("Meeting notes: ...", "... - Resumen"),
 * a leading ISO date and trailing dates and times removed, then words joined by single spaces.
 * A title that is only a label ("Meeting notes") normalizes to "" and scores 0.
 */
export function normalizeTitle(input: string | null | undefined): string {
  if (typeof input !== 'string') return '';
  let s = truncate(input, SUMMARY_LIMITS.maxTitleChars)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // One spelling for dashes and for dot or bar separators.
    .replace(/\p{Pd}/gu, '-')
    .replace(/[\u00b7\u2022\u2219\u30fb|]/g, ' | ')
    // "Bob's" is one word.
    .replace(/(\p{L})['\u2019](\p{L})/gu, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
  for (let pass = 0; pass < MAX_STRIP_PASSES; pass++) {
    const next = stripOnce(s);
    if (next === s) break;
    s = next;
  }
  return (s.match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');
}

function contentTokens(normalized: string): Set<string> {
  const all = normalized.split(' ').filter((t) => t.length > 0);
  const content = all.filter((t) => !STOPWORDS.has(t));
  return new Set(content.length > 0 ? content : all);
}

function isDistinctive(token: string): boolean {
  if (GENERIC_WORDS.has(token) || STOPWORDS.has(token)) return false;
  return token.replace(/[^\p{L}]/gu, '').length >= SUMMARIES_TUNING.title.distinctiveMinLetters;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** T for two already normalized titles. */
function normalizedPairScore(a: string, b: string): TitleScore {
  if (a.length === 0 || b.length === 0) return { score: 0, reason: 'title_none' };
  if (a === b) return { score: SUMMARIES_TUNING.title.equal, reason: 'title_equal' };
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  const shared = [...ta].filter((t) => tb.has(t));
  let best: TitleScore = { score: 0, reason: 'title_none' };
  const dice = (2 * shared.length) / (ta.size + tb.size);
  if (dice > best.score) best = { score: dice, reason: 'title_words' };
  const smaller = Math.min(ta.size, tb.size);
  if (smaller > 0 && shared.length === smaller && SUMMARIES_TUNING.title.subset > best.score) {
    best = { score: SUMMARIES_TUNING.title.subset, reason: 'title_subset' };
  }
  if (shared.some(isDistinctive) && SUMMARIES_TUNING.title.sharedDistinctiveWord > best.score) {
    best = { score: SUMMARIES_TUNING.title.sharedDistinctiveWord, reason: 'title_shared_word' };
  }
  return { score: round4(best.score), reason: best.reason };
}

/** T of one summary title against one meeting title (both normalized here). */
export function titlePairScore(summaryTitle: string | null, meetingTitle: string | null): TitleScore {
  return normalizedPairScore(normalizeTitle(summaryTitle), normalizeTitle(meetingTitle));
}

/** T: the better of titleLine and subjectClean against the meeting title. */
export function titleScore(
  summary: { titleLine: string | null; subjectClean: string | null },
  meetingTitle: string | null,
): TitleScore & { fromSubject: boolean } {
  const meeting = normalizeTitle(meetingTitle);
  const line = normalizedPairScore(normalizeTitle(summary.titleLine), meeting);
  const subject = normalizedPairScore(normalizeTitle(summary.subjectClean), meeting);
  return subject.score > line.score ? { ...subject, fromSubject: true } : { ...line, fromSubject: false };
}

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

interface ParsedAnchor {
  atMs: number;
  signed: boolean;
}

function parseAnchor(anchor: MatchAnchor | null | undefined): ParsedAnchor | null {
  if (!anchor || typeof anchor.at !== 'string') return null;
  const atMs = Date.parse(anchor.at);
  return Number.isFinite(atMs) ? { atMs, signed: anchor.signed === true } : null;
}

const MINUTE_MS = 60_000;

function timeScoreMs(startMs: number, endMs: number, anchor: ParsedAnchor | null): TimeScore {
  const t = SUMMARIES_TUNING.time;
  if (anchor === null) return { score: t.noAnchor, reasons: ['time_no_anchor'] };
  let score: number;
  let reason: TimeReason;
  const lag = (anchor.atMs - endMs) / MINUTE_MS;
  if (anchor.atMs <= startMs - SUMMARIES_TUNING.startToleranceMinutes * MINUTE_MS) {
    score = 0;
    reason = 'time_before_start';
  } else if (lag < t.fullFromMinutes) {
    score = t.endedEarly;
    reason = 'time_ended_early';
  } else if (lag <= t.fullToMinutes) {
    score = 1;
    reason = 'time_close';
  } else if (lag >= t.zeroAtMinutes) {
    score = 0;
    reason = 'time_too_late';
  } else {
    score = 1 - (lag - t.fullToMinutes) / (t.zeroAtMinutes - t.fullToMinutes);
    reason = 'time_late';
  }
  if (!anchor.signed) {
    return { score: round4(Math.min(score, t.unsignedAnchorCap)), reasons: [reason, 'time_unsigned_anchor'] };
  }
  return { score: round4(score), reasons: [reason] };
}

/**
 * M of one meeting for an anchor (see the module comment for the exact bands). The meeting times
 * must be valid instants (AppError invalid_input otherwise); decide() skips invalid candidates.
 */
export function timeScore(meeting: { startAt: string; endAt: string }, anchor: MatchAnchor | null): TimeScore {
  const startMs = toDate(meeting.startAt).getTime();
  const endMs = Math.max(startMs, toDate(meeting.endAt).getTime());
  return timeScoreMs(startMs, endMs, parseAnchor(anchor));
}

// ---------------------------------------------------------------------------------------------
// Conference link
// ---------------------------------------------------------------------------------------------

/**
 * Lowercased needles ("host/path", encoded and decoded) that identify a conference link in text.
 * Zoom's regional subdomains are dropped ("us02web.zoom.us/j/1" and "zoom.us/j/1" are one link).
 * Empty when the URL is not http(s) or its path is too short to identify a meeting. A match must
 * end at a boundary, so "zoom.us/j/123" never matches inside "zoom.us/j/1234".
 */
export function conferenceNeedles(url: string | null): string[] {
  if (typeof url !== 'string' || url.length === 0) return [];
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return [];
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return [];
  let host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host.endsWith('.zoom.us')) host = 'zoom.us';
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path.length < 5) return [];
  const needles = new Set<string>([`${host}${path}`.toLowerCase()]);
  try {
    needles.add(`${host}${decodeURIComponent(path)}`.toLowerCase());
  } catch {
    // Malformed escapes: the encoded needle alone.
  }
  return [...needles];
}

function containsBounded(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : haystack.charAt(at - 1);
    const after = haystack.charAt(at + needle.length);
    if (!/[a-z0-9-]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = at + 1;
  }
}

/** True when the meeting's conference link appears in the (already lowercased) text. */
function conferenceInLowerText(url: string | null, lowerText: string): boolean {
  if (lowerText.length === 0) return false;
  return conferenceNeedles(url).some((needle) => containsBounded(lowerText, needle));
}

/** True when the meeting's conference link appears in the summary text. */
export function conferenceLinkInText(url: string | null, text: string): boolean {
  return conferenceInLowerText(url, typeof text === 'string' ? text.toLowerCase() : '');
}

// ---------------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------------

/**
 * The zone in which the meeting's start falls on `summaryDate`: the meeting's own zone, then the
 * preferences zone, then UTC; null when none does. All-day meetings use their own zone only.
 * Invalid zone names are skipped, never thrown.
 */
export function summaryDateZone(
  meeting: { startAt: string; timezone: string; allDay: boolean },
  summaryDate: string,
  preferencesTimeZone: string | null,
): ZoneUsed | null {
  if (!isLocalDate(summaryDate) || !Number.isFinite(Date.parse(meeting.startAt))) return null;
  const order: { zone: string | null; used: ZoneUsed }[] = meeting.allDay
    ? [{ zone: meeting.timezone, used: 'meeting' }]
    : [
        { zone: meeting.timezone, used: 'meeting' },
        { zone: preferencesTimeZone, used: 'preferences' },
        { zone: 'UTC', used: 'utc' },
      ];
  for (const { zone, used } of order) {
    if (typeof zone !== 'string' || !isValidTimeZone(zone)) continue;
    if (toLocalDateTime(meeting.startAt, zone).date === summaryDate) return used;
  }
  return null;
}

const ZONE_REASON: Readonly<Record<ZoneUsed, MatchReason>> = {
  meeting: 'date_meeting_zone',
  preferences: 'date_preferences_zone',
  utc: 'date_utc',
};

/** Rows 8 to 10: the inbox reason the trust facts force, or null when rule A may file. */
export function trustInboxReason(facts: Pick<MatchInput, 'tier' | 'recipientBound' | 'fresh'>): SummaryInboxReason | null {
  if (facts.tier !== 'vendor_verified') return 'user_forwarded';
  if (!facts.recipientBound) return 'not_addressed_to_you';
  if (!facts.fresh) return 'old_summary';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Scoring and grouping
// ---------------------------------------------------------------------------------------------

interface ScoredCandidate {
  candidate: MatchCandidate;
  startMs: number;
  endMs: number;
  durationMinutes: number;
  normalizedTitle: string;
  titleScore: number;
  timeScore: number;
  score: number;
  reasons: MatchReason[];
  zoneUsed: ZoneUsed | null;
}

interface MatchGroup {
  representative: ScoredCandidate;
  members: ScoredCandidate[];
  /** The member with the best S (its scores are the group's). */
  best: ScoredCandidate;
  cancelled: boolean;
  allDay: boolean;
}

function sourceRank(source: string): number {
  const index = (SUMMARY_SOURCE_PRIORITY as readonly string[]).indexOf(source);
  return index === -1 ? SUMMARY_SOURCE_PRIORITY.length : index;
}

function compareText(a: string | null, b: string | null): number {
  const x = a ?? '';
  const y = b ?? '';
  return x < y ? -1 : x > y ? 1 : 0;
}

interface ScoringContext {
  summaryTitleLine: string;
  summarySubject: string;
  summaryDate: string | null;
  anchor: ParsedAnchor | null;
  lowerText: string;
  preferencesTimeZone: string | null;
}

/** Gates (deleted, signed-anchor start, summaryDate) and scores for one candidate; null when gated out. */
function scoreCandidate(candidate: MatchCandidate, ctx: ScoringContext): ScoredCandidate | null {
  if (candidate.deleted) return null;
  const startMs = Date.parse(candidate.startAt);
  const endMs = Math.max(startMs, Date.parse(candidate.endAt));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (ctx.anchor?.signed && startMs >= ctx.anchor.atMs + SUMMARIES_TUNING.startToleranceMinutes * MINUTE_MS) return null;

  let zoneUsed: ZoneUsed | null = null;
  if (ctx.summaryDate !== null) {
    zoneUsed = summaryDateZone(candidate, ctx.summaryDate, ctx.preferencesTimeZone);
    if (zoneUsed === null) return null;
  }

  const normalizedTitle = normalizeTitle(candidate.title);
  const line = normalizedPairScore(ctx.summaryTitleLine, normalizedTitle);
  const subject = normalizedPairScore(ctx.summarySubject, normalizedTitle);
  const title = subject.score > line.score ? subject : line;
  const time = timeScoreMs(startMs, endMs, ctx.anchor);
  const conference = conferenceInLowerText(candidate.conferenceUrl, ctx.lowerText);
  const w = SUMMARIES_TUNING.weights;
  const raw = w.title * title.score + w.time * time.score + (conference ? SUMMARIES_TUNING.conferenceBonus : 0);

  const reasons: MatchReason[] = [title.reason];
  if (subject.score > line.score) reasons.push('title_from_subject');
  reasons.push(...time.reasons);
  if (conference) reasons.push('conference_link');
  if (zoneUsed !== null) reasons.push(ZONE_REASON[zoneUsed]);
  if (candidate.cancelled) reasons.push('cancelled');
  if (candidate.allDay) reasons.push('all_day');

  return {
    candidate,
    startMs,
    endMs,
    durationMinutes: Math.round((endMs - startMs) / MINUTE_MS),
    normalizedTitle,
    titleScore: title.score,
    timeScore: time.score,
    score: round4(Math.min(1, raw)),
    reasons,
    zoneUsed,
  };
}

function sameMeeting(a: ScoredCandidate, b: ScoredCandidate): boolean {
  return (
    Math.abs(a.startMs - b.startMs) <= SUMMARIES_TUNING.groupStartToleranceMinutes * MINUTE_MS &&
    a.durationMinutes === b.durationMinutes &&
    a.normalizedTitle === b.normalizedTitle
  );
}

function compareScored(a: ScoredCandidate, b: ScoredCandidate): number {
  return (
    b.score - a.score ||
    b.titleScore - a.titleScore ||
    b.timeScore - a.timeScore ||
    a.startMs - b.startMs ||
    sourceRank(a.candidate.source) - sourceRank(b.candidate.source) ||
    compareText(a.candidate.meetingId, b.candidate.meetingId) ||
    compareText(a.candidate.occurrenceDate, b.candidate.occurrenceDate)
  );
}

/**
 * Duplicate groups, best first. Candidates are taken in source-priority order, so each group's
 * first member is its representative; a candidate joins the first group whose representative is
 * the same meeting.
 */
function groupCandidates(scored: readonly ScoredCandidate[]): MatchGroup[] {
  const ordered = [...scored].sort(
    (a, b) =>
      sourceRank(a.candidate.source) - sourceRank(b.candidate.source) ||
      a.startMs - b.startMs ||
      compareText(a.candidate.meetingId, b.candidate.meetingId) ||
      compareText(a.candidate.occurrenceDate, b.candidate.occurrenceDate),
  );
  const groups: { representative: ScoredCandidate; members: ScoredCandidate[] }[] = [];
  for (const item of ordered) {
    const group = groups.find((g) => sameMeeting(g.representative, item));
    if (group) group.members.push(item);
    else groups.push({ representative: item, members: [item] });
  }
  return groups
    .map((g) => {
      const best = [...g.members].sort(compareScored)[0] ?? g.representative;
      return {
        representative: g.representative,
        members: g.members,
        best,
        cancelled: g.members.some((m) => m.candidate.cancelled),
        allDay: g.members.some((m) => m.candidate.allDay),
      };
    })
    .sort(
      (a, b) =>
        compareScored(a.best, b.best) ||
        compareText(a.representative.candidate.meetingId, b.representative.candidate.meetingId),
    );
}

function duplicateIds(group: MatchGroup): string[] {
  const own = group.representative.candidate.meetingId;
  return [...new Set(group.members.map((m) => m.candidate.meetingId))].filter((id) => id !== own);
}

function groupReasons(group: MatchGroup): MatchReason[] {
  const reasons: MatchReason[] = group.best.reasons.filter((r) => r !== 'cancelled' && r !== 'all_day');
  if (group.cancelled) reasons.push('cancelled');
  if (group.allDay) reasons.push('all_day');
  if (group.members.length > 1) reasons.push('duplicates_grouped');
  return reasons;
}

function toSuggestion(group: MatchGroup): SummaryMatchCandidate {
  const rep = group.representative;
  return {
    meetingId: rep.candidate.meetingId,
    occurrenceDate: rep.candidate.occurrenceDate,
    duplicateMeetingIds: duplicateIds(group),
    title: truncate(rep.candidate.title, SUMMARY_LIMITS.maxTitleChars),
    startAt: new Date(rep.startMs).toISOString(),
    endAt: new Date(rep.endMs).toISOString(),
    timezone: rep.candidate.timezone,
    score: group.best.score,
    titleScore: group.best.titleScore,
    timeScore: group.best.timeScore,
    reasons: groupReasons(group),
    zoneUsed: rep.zoneUsed,
    cancelled: group.cancelled,
    allDay: group.allDay,
  };
}

/** What the scores alone say about the ranked groups. */
function scoreOutcome(groups: readonly MatchGroup[]): Exclude<MatchOutcome, 'no_date'> {
  const top = groups[0];
  if (top === undefined) return 'no_candidate';
  const second = groups[1];
  const { ruleA, ruleB, suggestions } = SUMMARIES_TUNING;
  const tie = second !== undefined && round4(top.best.score - second.best.score) <= ruleA.tieWithin;
  const strong = top.best.titleScore >= ruleA.minTitleScore && top.best.score >= ruleA.minScore;
  const suggestionOnly = top.cancelled || top.allDay;

  if (strong && !tie && !suggestionOnly) return 'confident';
  if (
    tie &&
    second !== undefined &&
    second.best.score >= suggestions.minScore &&
    (top.best.titleScore >= ruleA.minTitleScore || second.best.titleScore >= ruleA.minTitleScore)
  ) {
    return 'ambiguous';
  }
  if (groups.length === 1 && top.best.titleScore >= ruleB.minTitleScore && top.best.timeScore >= ruleB.minTimeScore) {
    return 'needs_confirmation';
  }
  if (strong && !tie && suggestionOnly) return 'needs_confirmation';
  return 'weak';
}

// ---------------------------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------------------------

/**
 * Scores every candidate, groups duplicates, and decides between filing (rule A) and the inbox.
 * Malformed candidates are skipped. Never throws on bad zones or dates.
 */
export function decide(input: MatchInput): MatchRecord {
  const rejectedMeetingIds = [...new Set(input.rejectedMeetingIds.filter((id) => typeof id === 'string'))];
  const trustReason = trustInboxReason(input);
  const summaryDate = isLocalDate(input.summaryDate) ? input.summaryDate : null;
  const anchor = parseAnchor(input.anchor);

  if (summaryDate === null && anchor === null) {
    return {
      status: 'inbox',
      inboxReason: trustReason ?? 'no_date',
      outcome: 'no_date',
      match: null,
      candidates: [],
      rejectedMeetingIds,
      groupCount: 0,
    };
  }

  const preferencesTimeZone =
    typeof input.preferencesTimeZone === 'string' && isValidTimeZone(input.preferencesTimeZone) ? input.preferencesTimeZone : null;
  const ctx: ScoringContext = {
    summaryTitleLine: normalizeTitle(input.titleLine),
    summarySubject: normalizeTitle(input.subjectClean),
    summaryDate,
    anchor,
    lowerText: typeof input.text === 'string' ? input.text.toLowerCase() : '',
    preferencesTimeZone,
  };

  const scored: ScoredCandidate[] = [];
  for (const raw of input.candidates) {
    const parsed = matchCandidateSchema.safeParse(raw);
    if (!parsed.success) continue;
    const item = scoreCandidate(parsed.data, ctx);
    if (item !== null) scored.push(item);
  }

  const rejected = new Set(rejectedMeetingIds);
  const groups = groupCandidates(scored).filter((g) => !g.members.some((m) => rejected.has(m.candidate.meetingId)));
  const outcome = scoreOutcome(groups);
  const top = groups[0];

  const suggestions =
    trustReason === 'not_addressed_to_you'
      ? []
      : groups
          .filter((g) => g.best.score >= SUMMARIES_TUNING.suggestions.minScore)
          .slice(0, SUMMARIES_TUNING.suggestions.max)
          .map(toSuggestion);

  const ruleA =
    outcome === 'confident' &&
    top !== undefined &&
    input.tier === 'vendor_verified' &&
    input.recipientBound === true &&
    input.fresh === true &&
    anchor?.signed === true;

  if (ruleA) {
    const suggestion = toSuggestion(top);
    return {
      status: 'matched',
      inboxReason: null,
      outcome,
      match: {
        meetingId: suggestion.meetingId,
        occurrenceDate: suggestion.occurrenceDate,
        duplicateMeetingIds: suggestion.duplicateMeetingIds,
        method: 'auto',
        score: suggestion.score,
        titleScore: suggestion.titleScore,
        timeScore: suggestion.timeScore,
        reasons: [...suggestion.reasons, 'rule_a'],
        zoneUsed: suggestion.zoneUsed,
        matchedAt: input.now.toISOString(),
        meetingSnapshot: {
          title: suggestion.title,
          startAt: suggestion.startAt,
          endAt: suggestion.endAt,
          timezone: suggestion.timezone,
        },
      },
      candidates: suggestions,
      rejectedMeetingIds,
      groupCount: groups.length,
    };
  }

  return {
    status: 'inbox',
    // A confident score that may not file (no signed anchor) still asks the user, top first.
    inboxReason: trustReason ?? (outcome === 'confident' ? 'needs_confirmation' : outcome),
    outcome,
    match: null,
    candidates: suggestions,
    rejectedMeetingIds,
    groupCount: groups.length,
  };
}
