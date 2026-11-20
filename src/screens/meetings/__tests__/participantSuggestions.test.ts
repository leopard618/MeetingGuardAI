import { buildMeeting, type Meeting } from '../../../core/types';
import { knownParticipants, suggestParticipants } from '../participantSuggestions';

function meeting(id: string, startAt: string, participants: { email: string; name?: string }[], deletedAt: string | null = null): Meeting {
  const built = buildMeeting(
    { title: id, startAt, timezone: 'UTC', source: 'manual', participants },
    { id, userId: 'u1', now: '2026-10-01T00:00:00.000Z', defaultTimezone: 'UTC', defaultLanguage: 'en' },
  );
  return { ...built, deletedAt };
}

describe('participant suggestions', () => {
  const meetings = [
    meeting('m1', '2026-10-01T09:00:00.000Z', [{ email: 'Ana@Example.com', name: 'Ana' }, { email: 'me@own.com' }]),
    meeting('m2', '2026-10-03T09:00:00.000Z', [{ email: 'ana@example.com', name: 'Ana López' }, { email: 'bob@example.com' }]),
    meeting('m3', '2026-10-02T09:00:00.000Z', [{ email: 'bob@example.com', name: 'Bob' }, { email: 'carla@other.org' }]),
    meeting('m4', '2026-10-04T09:00:00.000Z', [{ email: 'gone@example.com' }], '2026-10-05T00:00:00.000Z'),
  ];

  it('ranks by meetings shared, then by the latest; the newest name wins; own and deleted left out', () => {
    expect(knownParticipants(meetings, 'ME@own.com')).toEqual([
      { email: 'ana@example.com', name: 'Ana López' },
      { email: 'bob@example.com', name: 'Bob' },
      { email: 'carla@other.org', name: null },
    ]);
  });

  it('matches the start of the address or of a name word first, skips taken and exact addresses', () => {
    const known = knownParticipants(meetings, 'me@own.com');
    expect(suggestParticipants(known, 'lóp', []).map((item) => item.email)).toEqual(['ana@example.com']);
    expect(suggestParticipants(known, 'example', []).map((item) => item.email)).toEqual(['ana@example.com', 'bob@example.com']);
    expect(suggestParticipants(known, 'c', []).map((item) => item.email)).toEqual(['carla@other.org', 'ana@example.com', 'bob@example.com']);
    expect(suggestParticipants(known, 'b', ['BOB@example.com'])).toEqual([]);
    expect(suggestParticipants(known, 'bob@example.com', [])).toEqual([]);
    expect(suggestParticipants(known, '  ', [])).toEqual([]);
    expect(suggestParticipants(known, 'e', [], 1)).toHaveLength(1);
  });
});
