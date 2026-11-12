/**
 * M11 keys and ids (functions/src/commitments/ids.ts and extraction.ts; docs/v2/M11-DESIGN.md
 * sections 2.7 and 3.4) and the keyed digests under every key of a rotated ring
 * (shared/sealed.ts contentDigests). Synthetic keys and text only.
 */
import { createHash } from 'node:crypto';

import { MEETING_ID_PATTERN } from '../../src/shared/aiContract';
import { contentDigest, contentDigests, parseKeyring, type Keyring } from '../../src/shared/sealed';
import {
  anchorKeyCandidates,
  anchorKeyOf,
  anchorOccurrence,
  commitmentTaskId,
  extractionKey,
  sentenceAnchorId,
  taskFieldsDigest,
  taskFieldsDigestCandidates,
  taskVisibleFieldsOf,
  textKeyCandidates,
  textKeyOf,
} from '../../src/commitments/ids';
import { EXTRACTOR_VERSION, extractionListFactsOf, isCurrentStamp, parserVersionInUse } from '../../src/commitments/extraction';
import { SECTIONS_PARSER_VERSION } from '../../src/summaries/sections';

const KEY_1 = `k1:${Buffer.alloc(32, 7).toString('base64')}`;
const KEY_2 = `k2:${Buffer.alloc(32, 9).toString('base64')}`;
const OLD: Keyring = parseKeyring(KEY_1);
const ROTATED: Keyring = parseKeyring(`${KEY_2},${KEY_1}`);
const SUMMARY_ID = createHash('sha256').update('ids-test').digest('hex');
const DIGEST = 'a'.repeat(64);

describe('extractionKey', () => {
  it("is 'x_' + 16 hex, stable, and changes with the digest, the parser, the extractor and the mode", () => {
    const base = { contentDigest: DIGEST, parserVersion: 1, extractorVersion: 1, mode: 'ai' as const };
    const key = extractionKey(base);
    expect(key).toMatch(/^x_[0-9a-f]{16}$/);
    expect(extractionKey({ ...base })).toBe(key);
    for (const changed of [{ contentDigest: 'b'.repeat(64) }, { parserVersion: 2 }, { extractorVersion: 2 }, { mode: 'as_written' as const }]) {
      expect(extractionKey({ ...base, ...changed })).not.toBe(key);
    }
  });
});

describe('anchor keys', () => {
  it('are keyed digests (24 hex) of the normalized anchor text and its occurrence, never a bare hash', () => {
    const key = anchorKeyOf(OLD, SUMMARY_ID, 'Provide APK access (owner: Bish)', 1);
    expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(anchorKeyOf(OLD, SUMMARY_ID, '  provide   APK\naccess (OWNER: Bish) ', 1)).toBe(key);
    expect(anchorKeyOf(OLD, SUMMARY_ID, 'Provide APK access (owner: Bish)', 2)).not.toBe(key);
    expect(anchorKeyOf(OLD, 'b'.repeat(64), 'Provide APK access (owner: Bish)', 1)).not.toBe(key);
    const bare = createHash('sha256').update(`mg-anchor:v1:${SUMMARY_ID}:provide apk access (owner: bish)#1`).digest('hex');
    expect(bare.startsWith(key)).toBe(false);
    expect(anchorKeyOf(parseKeyring(KEY_2), SUMMARY_ID, 'Provide APK access (owner: Bish)', 1)).not.toBe(key);
  });

  it('after a rotation the candidates hold the key written under the old primary, so decisions carry over', () => {
    const before = anchorKeyOf(OLD, SUMMARY_ID, 'Send the deck', 1);
    const candidates = anchorKeyCandidates(ROTATED, SUMMARY_ID, 'Send the deck', 1);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toBe(anchorKeyOf(ROTATED, SUMMARY_ID, 'Send the deck', 1));
    expect(candidates[1]).toBe(before);
    expect(contentDigests(ROTATED, 'x')[0]).toBe(contentDigest(ROTATED, 'x'));
    expect(contentDigests(ROTATED, 'x')[1]).toBe(contentDigest(OLD, 'x'));
  });

  it('counts repeated lines: the same text twice gets occurrences 1 and 2', () => {
    const text = 'Notes\n- Follow up\n- Other\n- Follow up\n';
    const first = text.indexOf('Follow up');
    const second = text.indexOf('Follow up', first + 1);
    expect(anchorOccurrence(text, first, first + 9)).toBe(1);
    expect(anchorOccurrence(text, second, second + 9)).toBe(2);
    expect(anchorOccurrence(text, 3, 3)).toBe(1);
  });

  it('counts on the normalized text the key hashes: lines that differ only in case or spacing get 1 and 2, so their keys differ (review S4)', () => {
    const a = 'Send the deck to Acme';
    const b = 'send the deck  to\nAcme';
    const text = `Action items\n- ${a}\n- Other\n- ${b}\n`;
    const first = text.indexOf(a);
    const second = text.indexOf(b);
    expect(anchorOccurrence(text, first, first + a.length)).toBe(1);
    expect(anchorOccurrence(text, second, second + b.length)).toBe(2);
    const keyA = anchorKeyOf(OLD, SUMMARY_ID, a, anchorOccurrence(text, first, first + a.length));
    const keyB = anchorKeyOf(OLD, SUMMARY_ID, b, anchorOccurrence(text, second, second + b.length));
    expect(keyA).not.toBe(keyB);
    // A later twin never changes the key of the first line.
    expect(anchorOccurrence(`${text}- SEND THE DECK TO ACME\n`, first, first + a.length)).toBe(1);
  });

  it('textKey finds the same line in another summary of the same meeting, not of another meeting or a kept one', () => {
    const line = 'Send the deck (owner: Bish)';
    const key = textKeyOf(OLD, 'mtgA', line);
    expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(textKeyOf(OLD, 'mtgA', ' send the  deck (owner: bish)')).toBe(key);
    expect(textKeyOf(OLD, 'mtgB', line)).not.toBe(key);
    expect(textKeyOf(OLD, null, line)).not.toBe(key);
    expect(textKeyCandidates(ROTATED, 'mtgA', line)[1]).toBe(key);
  });

  it("a sentence anchor id is 'q_' + 12 hex of its section and offsets, never its text", () => {
    const id = sentenceAnchorId('s_0123456789ab', 10, 60);
    expect(id).toMatch(/^q_[0-9a-f]{12}$/);
    expect(sentenceAnchorId('s_0123456789ab', 10, 60)).toBe(id);
    expect(sentenceAnchorId('s_0123456789ab', 10, 61)).not.toBe(id);
  });
});

describe('commitmentTaskId', () => {
  it("is 'sm_' + 32 hex, a valid document id, deterministic per summary, anchor key and generation", () => {
    const id = commitmentTaskId(SUMMARY_ID, '0123456789abcdef01234567', 0);
    expect(id).toMatch(/^sm_[0-9a-f]{32}$/);
    expect(MEETING_ID_PATTERN.test(id)).toBe(true);
    expect(commitmentTaskId(SUMMARY_ID, '0123456789abcdef01234567', 0)).toBe(id);
    expect(commitmentTaskId(SUMMARY_ID, '0123456789abcdef01234567', 1)).not.toBe(id);
    expect(commitmentTaskId('c'.repeat(64), '0123456789abcdef01234567', 0)).not.toBe(id);
    expect(() => commitmentTaskId(SUMMARY_ID, 'k', -1)).toThrow();
    expect(() => commitmentTaskId(SUMMARY_ID, 'k', 1.5)).toThrow();
  });
});

describe('taskFieldsDigest (Undo)', () => {
  const task = {
    userId: 'uid1',
    title: 'Bish: Provide APK access',
    description: "From your notetaker's summary of Sync (Oct 16, 2026). Suggested by Meeting Guard AI, added by you.",
    dueDate: '2026-10-16',
    dueTime: '09:00',
    timezone: 'America/Mexico_City',
    reminderMinutesBefore: 0,
    status: 'open',
    meetingId: 'mtgA',
    people: [{ name: 'Bish', email: null }],
    completedAt: null,
    source: 'ai_chat',
    pushPending: true,
    createdAt: '2026-10-15T10:00:00.000Z',
    updatedAt: '2026-10-15T10:00:00.000Z',
  };

  it('ignores the To Do and Google Tasks write-back (external refs, pushPending, updatedAt), sees a rename', () => {
    const fd = taskFieldsDigest(OLD, taskVisibleFieldsOf(task));
    expect(fd).toMatch(/^[0-9a-f]{16}$/);
    const writtenBack = {
      ...task,
      pushPending: false,
      updatedAt: '2026-10-15T10:00:05.000Z',
      external: { todoListId: 'L', todoTaskId: 'T', todoUpdatedAt: '2026-10-15T10:00:05.000Z', gtasksListId: null, gtasksTaskId: null, gtasksUpdatedAt: null },
    };
    expect(taskFieldsDigest(OLD, taskVisibleFieldsOf(writtenBack))).toBe(fd);
    expect(taskFieldsDigest(OLD, taskVisibleFieldsOf({ ...task, title: 'Renamed' }))).not.toBe(fd);
    expect(taskFieldsDigest(OLD, taskVisibleFieldsOf({ ...task, status: 'done' }))).not.toBe(fd);
    expect(taskFieldsDigest(OLD, taskVisibleFieldsOf({ ...task, people: [] }))).not.toBe(fd);
  });

  it('gives fd under every key of a rotated ring, primary first (Undo after a rotation; review P2)', () => {
    const fields = taskVisibleFieldsOf(task);
    const candidates = taskFieldsDigestCandidates(ROTATED, fields);
    expect(candidates).toEqual([taskFieldsDigest(ROTATED, fields), taskFieldsDigest(OLD, fields)]);
    expect(taskFieldsDigestCandidates(OLD, fields)).toEqual([taskFieldsDigest(OLD, fields)]);
  });

  it('reads a document the app rewrote with defaults the same way', () => {
    const fields = taskVisibleFieldsOf({ title: 'x' });
    expect(fields).toEqual({ title: 'x', description: '', dueDate: null, dueTime: null, timezone: 'UTC', reminderMinutesBefore: null, status: 'open', people: [], meetingId: null });
    expect(taskVisibleFieldsOf(null).title).toBe('');
  });
});

describe('extraction stamp and list facts', () => {
  const summary = { contentDigest: DIGEST, parserVersion: SECTIONS_PARSER_VERSION };
  const stored = { v: 1, state: 'ready', contentDigest: DIGEST, parserVersion: SECTIONS_PARSER_VERSION, extractorVersion: EXTRACTOR_VERSION, counts: { open: 4, accepted: 2, dropped: 1 } };

  it('the parser in use is the newer of the stored and the current one', () => {
    expect(parserVersionInUse(0)).toBe(SECTIONS_PARSER_VERSION);
    expect(parserVersionInUse(SECTIONS_PARSER_VERSION + 3)).toBe(SECTIONS_PARSER_VERSION + 3);
  });

  it('is current only while the digest, the parser in use and the extractor match', () => {
    expect(isCurrentStamp(stored, summary)).toBe(true);
    expect(isCurrentStamp({ ...stored, contentDigest: 'b'.repeat(64) }, summary)).toBe(false);
    expect(isCurrentStamp({ ...stored, extractorVersion: EXTRACTOR_VERSION + 1 }, summary)).toBe(false);
    expect(isCurrentStamp({ ...stored, parserVersion: SECTIONS_PARSER_VERSION - 1 }, summary)).toBe(false);
  });

  it('gives {state, open, accepted}, stale on a mismatch, null for anything it cannot read', () => {
    expect(extractionListFactsOf(stored, summary)).toEqual({ state: 'ready', open: 4, accepted: 2 });
    expect(extractionListFactsOf({ ...stored, state: 'empty', counts: { open: 0, accepted: 0, dropped: 0 } }, summary)).toEqual({ state: 'empty', open: 0, accepted: 0 });
    expect(extractionListFactsOf(stored, { ...summary, contentDigest: 'c'.repeat(64) })).toEqual({ state: 'stale', open: 4, accepted: 2 });
    for (const junk of [null, undefined, 'x', { ...stored, v: 2 }, { ...stored, state: 'preparing' }, { ...stored, counts: { open: 99, accepted: 0, dropped: 0 } }]) {
      expect(extractionListFactsOf(junk, summary)).toBeNull();
    }
  });
});
