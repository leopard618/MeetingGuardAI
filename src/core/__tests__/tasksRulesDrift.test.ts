/**
 * Same guard as preferencesRulesDrift.test.ts, for tasks: firestore.rules validates task documents
 * with `keys().hasOnly([...])`, so a Task field the app writes but the list does not name is
 * rejected by the server and silently rolled back on the next load. The To Do link (M7) added
 * `source` and `external`; this test keeps the two sides from drifting again.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildTask, EMPTY_TASK_EXTERNAL_REFS } from '../types';

function rulesText(): string {
  return readFileSync(join(__dirname, '..', '..', '..', 'firestore.rules'), 'utf8');
}

function hasOnlyKeys(functionName: string): string[] {
  const rules = rulesText();
  const start = rules.indexOf(`function ${functionName}(`);
  expect(start).toBeGreaterThan(-1);
  const hasOnly = rules.indexOf('hasOnly([', start);
  expect(hasOnly).toBeGreaterThan(-1);
  const end = rules.indexOf('])', hasOnly);
  expect(end).toBeGreaterThan(-1);
  return [...rules.slice(hasOnly, end).matchAll(/'([A-Za-z0-9_]+)'/g)].map((match) => match[1] as string);
}

const CTX = { id: 'task1', userId: 'u1', timezone: 'Europe/Madrid', now: '2030-03-10T09:00:00.000Z' };

describe('firestore.rules task allowlist', () => {
  it('names every field a built task stores', () => {
    const { id: _id, ...doc } = buildTask({ title: 'Prepare the proposal' }, CTX);
    const allowed = new Set(hasOnlyKeys('isValidTask'));
    expect(Object.keys(doc).filter((key) => !allowed.has(key))).toEqual([]);
  });

  it('names nothing the app does not store, except the website push flag', () => {
    const { id: _id, ...doc } = buildTask({ title: 'Prepare the proposal' }, CTX);
    const stored = new Set(Object.keys(doc));
    // pushPending is written by the website and dropped by the read schema (ARCHITECTURE 32).
    expect(hasOnlyKeys('isValidTask').filter((key) => !stored.has(key))).toEqual(['pushPending']);
  });

  it('names every To Do and Google Tasks link field and nothing else', () => {
    expect(hasOnlyKeys('isValidTaskExternal').sort()).toEqual(Object.keys(EMPTY_TASK_EXTERNAL_REFS).sort());
  });

  it('accepts every task source the app can write', () => {
    expect(rulesText()).toContain("d.get('source', 'manual') in ['manual', 'ai_chat', 'whatsapp', 'todo', 'gtasks']");
  });
});
