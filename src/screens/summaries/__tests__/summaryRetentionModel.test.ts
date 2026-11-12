/**
 * "How long we keep summaries" and Disconnect (M11 section 5): the retention lines in order with
 * their keys present in EN and ES, the "kept until" date of a filed or kept summary (365 days from
 * receipt, like the server's summaryExpiresAt), the create view's copy after a disconnect, and the
 * lists asked again after one.
 */
import { RESOURCES } from '../../../i18n/resources';
import {
  SUMMARY_KEEP_DAYS,
  SUMMARY_RETENTION_KEYS,
  createViewCopy,
  disconnectDoneKey,
  listsToRefreshAfterDisconnect,
  retentionLineKey,
  summaryKeptUntil,
} from '../summaryRetentionModel';

function lookup(language: 'en' | 'es', key: string): unknown {
  const [namespace, path] = key.split(':') as [string, string];
  const tree = (RESOURCES[language] as Record<string, unknown>)[namespace];
  return path.split('.').reduce<unknown>((node, part) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree);
}

describe('retention lines', () => {
  it('lists the section 5 rules in order, each worded in EN and ES', () => {
    expect(SUMMARY_RETENTION_KEYS).toEqual(['filed', 'inbox', 'refused', 'suggestions', 'tasks', 'deleting', 'openai', 'copies']);
    for (const key of SUMMARY_RETENTION_KEYS) {
      expect(typeof lookup('en', retentionLineKey(key))).toBe('string');
      expect(typeof lookup('es', retentionLineKey(key))).toBe('string');
    }
    // Our email provider's copy: the {{providerDays}} placeholder (45, Francisco's Nov 12 decision).
    expect(lookup('en', retentionLineKey('deleting'))).toContain('{{providerDays}}');
    expect(lookup('es', retentionLineKey('deleting'))).toContain('{{providerDays}}');
  });
});

describe('summaryKeptUntil', () => {
  it('is 365 days after receipt for a filed or kept summary', () => {
    expect(SUMMARY_KEEP_DAYS.filedOrKept).toBe(365);
    expect(summaryKeptUntil({ status: 'matched', receivedAt: '2026-10-16T20:20:00.000Z' })).toBe('2027-10-16T20:20:00.000Z');
    expect(summaryKeptUntil({ status: 'kept', receivedAt: '2028-02-29T08:00:00.000Z' })).toBe('2029-02-28T08:00:00.000Z');
  });

  it('is unknown for an inbox summary, a refused row or an unreadable time', () => {
    expect(summaryKeptUntil({ status: 'inbox', receivedAt: '2026-10-16T20:20:00.000Z' })).toBeNull();
    expect(summaryKeptUntil({ status: 'refused', receivedAt: '2026-10-16T20:20:00.000Z' })).toBeNull();
    expect(summaryKeptUntil({ status: 'matched', receivedAt: 'not a date' })).toBeNull();
  });
});

describe('disconnect', () => {
  it('words the result of each choice', () => {
    expect(disconnectDoneKey('keep')).toBe('summaries:connect.disconnect.doneKept');
    expect(disconnectDoneKey('delete')).toBe('summaries:connect.disconnect.doneDeleted');
  });

  it('offers the address again after a disconnect, with the daily cap reminder', () => {
    expect(createViewCopy(null)).toEqual({
      buttonKey: 'summaries:connect.create',
      noticeKey: null,
      hintKeys: ['summaries:connect.createHint'],
    });
    for (const choice of ['keep', 'delete'] as const) {
      expect(createViewCopy(choice)).toEqual({
        buttonKey: 'summaries:connect.disconnect.reconnect',
        noticeKey: 'summaries:connect.disconnect.disconnected',
        hintKeys: ['summaries:connect.createHint', 'summaries:connect.disconnect.reconnectHint'],
      });
    }
  });

  it('asks the inbox again, and after a delete every list a screen showed', () => {
    expect(listsToRefreshAfterDisconnect([], 'keep')).toEqual(['inbox']);
    expect(listsToRefreshAfterDisconnect(['recent', 'refused'], 'keep')).toEqual(['inbox']);
    expect(listsToRefreshAfterDisconnect([], 'delete')).toEqual(['inbox']);
    expect(listsToRefreshAfterDisconnect(['refused', 'inbox', 'recent'], 'delete')).toEqual(['inbox', 'recent', 'refused']);
  });
});
