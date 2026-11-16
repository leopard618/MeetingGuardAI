/**
 * Deterministic keys and ids of M11 (docs/v2/M11-DESIGN.md sections 2.7 and 3.4). PURE apart
 * from the keyed digests, which need the summaries keyring (sealed.ts contentDigest: an HMAC under
 * the digest subkey, never a bare hash of content).
 *
 * - extractionKey: 'x_' + 16 hex of sha256 of [contentDigest, parser version used, extractor
 *   version, mode]. Every input is structure (contentDigest is already an HMAC), so a plain hash.
 * - anchorKey: the first 24 hex of the keyed digest of 'mg-anchor:v1:' + summaryId + ':' + the
 *   normalized anchor text (the whole item, or the EXPANDED sentence) + '#' + its occurrence
 *   number. It survives a parser bump that moves item ids and an upgrade whose lines are the same.
 *   anchorKeyCandidates gives it under every key of the ring (carry-over after a rotation).
 * - textKey: the same keyed digest of 'mg-text:v1:' + the meeting id (or 'kept') + ':' + the
 *   normalized anchor text: the same line in ANOTHER summary of the same meeting (Duplicates).
 * - sentenceAnchorId: 'q_' + 12 hex of sha256 of [section id, start, end]: offsets, never text.
 * - commitmentTaskId: 'sm_' + the first 32 hex of sha256('mg-sumtask:v1:' + summaryId + ':' +
 *   anchorKey + ':' + gen): a second tap, device or WhatsApp reply for the same item finds the
 *   task already there. It matches MEETING_ID_PATTERN (isValidDocumentId).
 * - taskFieldsDigest (fd): the first 16 hex of the keyed digest of the task fields the user can
 *   see, for Undo (section 3.4 step 5): the To Do and Google Tasks write-back (external refs,
 *   updatedAt) does not change it, a rename does. taskFieldsDigestCandidates gives it under every
 *   key of the ring (Undo after a rotation).
 * Never log any of these with content; ids and keys are safe to log only as counts.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { createHash } from 'node:crypto';

import { MEETING_ID_PATTERN, type CommitmentMode } from '../shared/aiContract';
import { contentDigest, contentDigests, type Keyring } from '../shared/sealed';
import { normalizeAnchorText } from './text';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** The extraction stamp (section 2.7). */
export interface ExtractionKeyInput {
  contentDigest: string;
  /** The parser version the sections were read with (a re-parse in memory counts). */
  parserVersion: number;
  extractorVersion: number;
  mode: CommitmentMode;
}

/** 'x_' + 16 hex. */
export function extractionKey(input: ExtractionKeyInput): string {
  return `x_${sha256Hex(JSON.stringify(['mg-extraction:v1', input.contentDigest, input.parserVersion, input.extractorVersion, input.mode])).slice(0, 16)}`;
}

/**
 * The 1-based occurrence of the anchor's text in the summary text up to its end, counted on the
 * NORMALIZED text (normalizeAnchorText, the form the anchor key hashes): a line written twice,
 * also once in other case or spacing ("Send the deck" and "send the  deck"), gets 1 and 2, so two
 * listed lines never share an anchor key. Deterministic for one text, whatever the model picked.
 */
export function anchorOccurrence(text: string, start: number, end: number): number {
  const needle = normalizeAnchorText(text.slice(start, end));
  if (needle.length === 0) return 1;
  const before = normalizeAnchorText(text.slice(0, Math.max(start, end)));
  let count = 0;
  for (let at = before.indexOf(needle); at !== -1; at = before.indexOf(needle, at + 1)) count += 1;
  return Math.max(1, count);
}

function anchorPayload(summaryId: string, anchorText: string, occurrence: number): string {
  return `mg-anchor:v1:${summaryId}:${normalizeAnchorText(anchorText)}#${occurrence}`;
}

/** anchorKey under the primary key (24 hex). */
export function anchorKeyOf(keyring: Keyring, summaryId: string, anchorText: string, occurrence: number): string {
  return contentDigest(keyring, anchorPayload(summaryId, anchorText, occurrence)).slice(0, 24);
}

/** anchorKey under every key of the ring, primary first (element 0 equals anchorKeyOf). */
export function anchorKeyCandidates(keyring: Keyring, summaryId: string, anchorText: string, occurrence: number): string[] {
  return contentDigests(keyring, anchorPayload(summaryId, anchorText, occurrence)).map((digest) => digest.slice(0, 24));
}

function textPayload(meetingId: string | null, anchorText: string): string {
  return `mg-text:v1:${meetingId ?? 'kept'}:${normalizeAnchorText(anchorText)}`;
}

/** textKey under the primary key (24 hex); `meetingId` null for a kept summary. */
export function textKeyOf(keyring: Keyring, meetingId: string | null, anchorText: string): string {
  return contentDigest(keyring, textPayload(meetingId, anchorText)).slice(0, 24);
}

/** textKey under every key of the ring, primary first. */
export function textKeyCandidates(keyring: Keyring, meetingId: string | null, anchorText: string): string[] {
  return contentDigests(keyring, textPayload(meetingId, anchorText)).map((digest) => digest.slice(0, 24));
}

/** A sentence anchor's id: 'q_' + 12 hex of its section and offsets (no text). */
export function sentenceAnchorId(sectionId: string, start: number, end: number): string {
  return `q_${sha256Hex(JSON.stringify(['q', sectionId, start, end])).slice(0, 12)}`;
}

/** The deterministic task id of an accepted suggestion ('sm_' + 32 hex). */
export function commitmentTaskId(summaryId: string, anchorKey: string, gen: number): string {
  if (!Number.isInteger(gen) || gen < 0) throw new Error('commitments.ids: gen must be a non-negative integer');
  const id = `sm_${sha256Hex(`mg-sumtask:v1:${summaryId}:${anchorKey}:${gen}`).slice(0, 32)}`;
  if (!MEETING_ID_PATTERN.test(id)) throw new Error('commitments.ids: task id does not match the document id pattern');
  return id;
}

/** The task fields the user sees (section 3.4 step 5); external refs and updatedAt are not among them. */
export interface TaskVisibleFields {
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  timezone: string;
  reminderMinutesBefore: number | null;
  status: string;
  people: readonly { name: string; email: string | null }[];
  meetingId: string | null;
}

/**
 * fd: 16 hex of the keyed digest of the visible fields, read leniently from a task document (a
 * missing field reads as the app's default), so a document the app rewrote with the same values
 * gives the same digest.
 */
export function taskFieldsDigest(keyring: Keyring, fields: TaskVisibleFields): string {
  return contentDigest(keyring, taskFieldsPayload(fields)).slice(0, 16);
}

/**
 * fd under every key of the ring, primary first (element 0 equals taskFieldsDigest): Undo of a task
 * accepted before a data-key rotation compares against all of them, as the anchor keys do.
 */
export function taskFieldsDigestCandidates(keyring: Keyring, fields: TaskVisibleFields): string[] {
  return contentDigests(keyring, taskFieldsPayload(fields)).map((digest) => digest.slice(0, 16));
}

function taskFieldsPayload(fields: TaskVisibleFields): string {
  const people = fields.people.map((person) => [person.name, person.email ?? null]);
  return JSON.stringify([
    'mg-fd:v1',
    fields.title,
    fields.description,
    fields.dueDate ?? null,
    fields.dueTime ?? null,
    fields.timezone,
    fields.reminderMinutesBefore ?? null,
    fields.status,
    people,
    fields.meetingId ?? null,
  ]);
}

/** The visible fields of a raw task document (as the app's parseTaskDoc defaults them). */
export function taskVisibleFieldsOf(raw: unknown): TaskVisibleFields {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);
  const strOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  const people = Array.isArray(data.people)
    ? data.people.map((person) => {
        const entry = (typeof person === 'object' && person !== null ? person : {}) as Record<string, unknown>;
        return { name: str(entry.name, ''), email: strOrNull(entry.email) };
      })
    : [];
  return {
    title: str(data.title, ''),
    description: str(data.description, ''),
    dueDate: strOrNull(data.dueDate),
    dueTime: strOrNull(data.dueTime),
    timezone: str(data.timezone, 'UTC'),
    reminderMinutesBefore: typeof data.reminderMinutesBefore === 'number' ? data.reminderMinutesBefore : null,
    status: str(data.status, 'open'),
    people,
    meetingId: strOrNull(data.meetingId),
  };
}
