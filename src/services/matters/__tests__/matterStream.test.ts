/**
 * A5: the client of matterStream (lines as they arrive, a body read whole where a stream is not
 * available, characters split between chunks), the service's streamed calls, the briefing
 * notifications planned from the digest, and the deep link a briefing notification opens.
 */
import { MATTER_CONSENT_VERSION } from '../../../core/aiContract';
import { parseDeepLink } from '../../../core/identifiers';
import { plannedBriefings, matterBriefingUrl } from '../assistantNotifications';
import { createMatterService } from '../matterService';
import { LineReader, Utf8Stream, createHttpStreamTransport, streamUrl, type FetchLike } from '../matterStream';

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false, auth: null }));
jest.mock('expo-notifications', () => ({ SchedulableTriggerInputTypes: { DATE: 'date' } }));

const encode = (text: string) => new TextEncoder().encode(text);

function fakeFetch(chunks: Uint8Array[] | null, status = 200): { fetch: FetchLike; calls: { url: string; init: unknown }[] } {
  const calls: { url: string; init: unknown }[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      let i = 0;
      return {
        ok: status === 200,
        status,
        body: chunks ? { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }) }) } : null,
        text: async () => new TextDecoder().decode(Buffer.concat((chunks ?? []).map((c) => Buffer.from(c)))),
      };
    },
  };
}

describe('reading the stream', () => {
  it('lines arrive in pieces; a character split between chunks waits for its end', () => {
    const utf8 = new Utf8Stream();
    const bytes = encode('reunión');
    expect(utf8.decode(bytes.slice(0, 5)) + utf8.decode(bytes.slice(5))).toBe('reunión');
    const lines: unknown[] = [];
    const reader = new LineReader((line) => lines.push(line));
    reader.push('{"t":"text","v":"Hel');
    reader.push('lo"}\n{"t":"text","v":" there"}\nnot json\n{"t":"done"}');
    reader.end();
    expect(lines).toEqual([{ t: 'text', v: 'Hello' }, { t: 'text', v: ' there' }, { t: 'done' }]);
  });

  it('posts with the ID token; reads the body as it arrives, or whole when it cannot', async () => {
    const body = '{"t":"text","v":"Carlos "}\n{"t":"text","v":"replied."}\n{"t":"done","briefing":{"text":"Carlos replied.","matterId":null,"title":null}}\n';
    const bytes = encode(body);
    for (const chunks of [[bytes.slice(0, 7), bytes.slice(7, 30), bytes.slice(30)], null]) {
      const net = chunks ? fakeFetch(chunks) : { ...fakeFetch([bytes]), fetch: (async (url: string, init: unknown) => ({ ...(await fakeFetch([bytes]).fetch(url, init as never)), body: null })) as FetchLike };
      const lines: unknown[] = [];
      const transport = createHttpStreamTransport({ url: () => 'https://x/matterStream', token: async () => 'id-token', fetch: net.fetch });
      await transport.open({ kind: 'briefing' }, (line) => lines.push(line));
      expect(lines).toHaveLength(3);
    }
    const net = fakeFetch([bytes]);
    await createHttpStreamTransport({ url: () => 'https://x/matterStream', token: async () => 'id-token', fetch: net.fetch }).open({ a: 1 }, () => undefined);
    expect(net.calls[0]).toEqual({ url: 'https://x/matterStream', init: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer id-token' }, body: '{"a":1}' } });
    expect(streamUrl('us-central1', 'meetingguard-ai-app')).toBe('https://us-central1-meetingguard-ai-app.cloudfunctions.net/matterStream');
  });

  it('a request that cannot start is "unavailable" (the screen asks the callable instead)', async () => {
    const failing = createHttpStreamTransport({ url: () => 'https://x', token: async () => 't', fetch: async () => Promise.reject(new Error('offline')) });
    await expect(failing.open({}, () => undefined)).rejects.toMatchObject({ details: { stream: 'unavailable' } });
    const refused = createHttpStreamTransport({ url: () => 'https://x', token: async () => 't', fetch: fakeFetch([], 404).fetch });
    await expect(refused.open({}, () => undefined)).rejects.toMatchObject({ details: { stream: 'unavailable' } });
  });
});

describe('matterService streamed calls', () => {
  function service(lines: object[]) {
    const stream = { open: jest.fn(async (_body: unknown, onLine: (line: never) => void) => lines.forEach((l) => onLine(l as never))) };
    return { stream, service: createMatterService({ getTransport: () => null, enabled: () => true, getStream: () => stream }) };
  }

  it('pieces go to onText; the done line resolves', async () => {
    const { stream, service: s } = service([{ t: 'text', v: 'Carlos ' }, { t: 'text', v: 'replied.' }, { t: 'done', ask: { intent: 'status', matterId: 'm1', title: 'T', answer: 'Carlos replied.' } }]);
    const pieces: string[] = [];
    await expect(s.streamAsk({ text: ' How is Carlos? ', language: 'en', timeZone: 'Europe/Madrid' }, (p) => pieces.push(p))).resolves.toEqual({
      ask: { intent: 'status', matterId: 'm1', title: 'T', answer: 'Carlos replied.' },
      briefing: null,
    });
    expect(pieces.join('')).toBe('Carlos replied.');
    expect(stream.open).toHaveBeenCalledWith({ kind: 'ask', text: 'How is Carlos?', language: 'en', timeZone: 'Europe/Madrid' }, expect.any(Function));
  });

  it('an error line rejects like a callable; consent_required keeps its reason', async () => {
    const { service: s } = service([{ t: 'error', reason: 'consent_required' }]);
    await expect(s.streamBriefing({ language: 'en', matterId: 'm1', timeZone: 'Europe/Madrid' }, () => undefined)).rejects.toMatchObject({
      code: 'permission_denied',
      details: { reason: 'consent_required' },
    });
    expect(MATTER_CONSENT_VERSION).toBe(1);
  });
});

describe('briefing notifications and their link', () => {
  it('one per booked meeting ahead, its minutes before, the soonest three; none when off', () => {
    const now = new Date('2026-11-25T08:00:00.000Z');
    const briefings = ['2026-11-25T08:20:00.000Z', '2026-11-26T09:00:00.000Z', '2026-11-25T12:00:00.000Z', '2026-11-27T09:00:00.000Z', '2026-11-28T09:00:00.000Z'].map((start, i) => ({
      matterId: `m${i}`,
      title: `T${i}`,
      start,
    }));
    const planned = plannedBriefings({ briefings, briefingMinutes: 30 }, now);
    // 08:20 minus 30 minutes is already past
    expect(planned.map((p) => p.matterId)).toEqual(['m2', 'm1', 'm3']);
    expect(planned[0]!.fireAt).toBe(Date.parse('2026-11-25T11:30:00.000Z'));
    expect(plannedBriefings({ briefings, briefingMinutes: 0 }, now)).toEqual([]);
  });

  it('the notification opens the matter and starts its briefing', () => {
    expect(parseDeepLink(matterBriefingUrl('m1'))).toEqual({ type: 'matters', matterId: 'm1', brief: true });
    expect(parseDeepLink('meetingguardai://matters')).toEqual({ type: 'matters', matterId: null, brief: false });
    expect(parseDeepLink('meetingguardai://matters?matter=bad%20id&brief=1')).toEqual({ type: 'matters', matterId: null, brief: false });
    // the mailbox sign-in return address stays unknown (it only closes the browser)
    expect(parseDeepLink('meetingguardai://matters/mailbox?result=connected')).toEqual({ type: 'unknown' });
  });
});
