import { guestLinkUrl, hasGuestLink, newMeetingId, withGuestLink, withoutGuestLink } from '../guestLinks';
import { notificationTextOf, notifyNewAnswers, type GuestNotifierDeps } from '../notifier';
import type { GuestAnswer } from '../guestService';

jest.mock('firebase/firestore', () => ({}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('expo-notifications', () => ({ scheduleNotificationAsync: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ db: null, functions: null, isFirebaseReady: false }));
jest.mock('../../data', () => ({ meetingRepository: { get: jest.fn() }, dataService: { getActiveUid: () => null } }));

const TOKEN = 'a'.repeat(43);

describe('the reply line in the invitation', () => {
  it('adds one line at the end, replaces an old one and removes it', () => {
    const url = guestLinkUrl(TOKEN, 'es');
    expect(url).toBe(`https://meetingguard-ai-app.web.app/g#t=${TOKEN}&l=es`);
    const once = withGuestLink('Agenda: budget', 'Reply to this invitation', url);
    expect(once).toBe(`Agenda: budget\n\nReply to this invitation: ${url}`);
    expect(hasGuestLink(once)).toBe(true);
    const again = withGuestLink(once, 'Responde a esta invitación', guestLinkUrl('b'.repeat(43)));
    expect(again).toBe(`Agenda: budget\n\nResponde a esta invitación: https://meetingguard-ai-app.web.app/g#t=${'b'.repeat(43)}`);
    expect(withoutGuestLink(again)).toBe('Agenda: budget');
    expect(withGuestLink('', 'Reply', url)).toBe(`Reply: ${url}`);
    expect(hasGuestLink('no link here')).toBe(false);
  });

  it('makes valid meeting ids', () => {
    expect(newMeetingId()).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(newMeetingId()).not.toBe(newMeetingId());
  });
});

function answer(overrides: Partial<GuestAnswer> = {}): GuestAnswer {
  return {
    id: 'r1',
    v: 1,
    meetingId: 'm1',
    kind: 'accepted',
    guestName: 'Ana',
    guestEmail: null,
    proposedStartAt: null,
    message: null,
    meetingStartAtSeen: '2026-11-25T15:00:00.000Z',
    createdAt: '2026-11-23T10:00:00.000Z',
    updatedAt: '2026-11-23T10:00:00.000Z',
    state: 'new',
    decidedAt: null,
    ...overrides,
  };
}

describe('guest answer notifications', () => {
  const t = (key: string, values?: Record<string, unknown>) => `${key}${values?.name ? `:${String(values.name)}` : ''}`;

  function deps() {
    const store = new Map<string, string>();
    const shown: { id: string; title: string; body: string; url: string }[] = [];
    const value: GuestNotifierDeps = {
      service: {} as GuestNotifierDeps['service'],
      storage: {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, item: string) => {
          store.set(key, item);
        },
      } as GuestNotifierDeps['storage'],
      getMeeting: async () => ({ title: 'Kickoff' }),
      present: async (id, title, body, url) => {
        shown.push({ id, title, body, url });
      },
      t,
    };
    return { value, shown };
  }

  it('names the guest and the meeting', () => {
    expect(notificationTextOf(answer({ kind: 'proposed' }), 'Kickoff', t)).toEqual({ title: 'meetings:guests.notify.proposed:Ana', body: 'Kickoff' });
    expect(notificationTextOf(answer({ guestName: null, guestEmail: 'ana@x.com' }), 'Kickoff', t).title).toBe('meetings:guests.notify.accepted:ana@x.com');
  });

  it('notifies each new answer once, again when the guest changes it', async () => {
    const d = deps();
    expect(await notifyNewAnswers('u1', [answer(), answer({ id: 'r2', state: 'seen' })], d.value)).toBe(1);
    expect(d.shown[0]).toEqual({ id: 'guest-reply-r1', title: 'meetings:guests.notify.accepted:Ana', body: 'Kickoff', url: 'meetingguardai://meeting/m1' });
    expect(await notifyNewAnswers('u1', [answer()], d.value)).toBe(0);
    expect(await notifyNewAnswers('u1', [answer({ kind: 'declined', updatedAt: '2026-11-23T11:00:00.000Z' })], d.value)).toBe(1);
  });
});
