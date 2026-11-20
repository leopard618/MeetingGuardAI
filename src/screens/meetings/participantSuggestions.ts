/**
 * Participant suggestions for the meeting form (pure; unit-tested): addresses the user already had
 * in their meetings (made in Meeting Guard or imported from a calendar), nothing from contacts.
 * Ranked by how often an address appears, then by its most recent meeting; the name is the one of
 * its most recent meeting that has one. The signed-in account's own address is left out.
 */
import type { Meeting } from '../../core/types';

export interface KnownParticipant {
  email: string;
  name: string | null;
}

interface Tally extends KnownParticipant {
  count: number;
  lastMs: number;
  nameMs: number;
}

export const PARTICIPANT_SUGGESTION_LIMIT = 4;

function normalized(email: string): string {
  return email.trim().toLowerCase();
}

export function knownParticipants(meetings: readonly Meeting[], ownEmail: string | null | undefined): KnownParticipant[] {
  const own = ownEmail ? normalized(ownEmail) : null;
  const tallies = new Map<string, Tally>();
  for (const meeting of meetings) {
    if (meeting.deletedAt !== null) continue;
    const ms = Date.parse(meeting.startAt);
    const at = Number.isFinite(ms) ? ms : 0;
    for (const participant of meeting.participants) {
      const key = normalized(participant.email);
      if (key.length === 0 || !key.includes('@') || key === own) continue;
      const name = participant.name?.trim() ? participant.name.trim() : null;
      const tally = tallies.get(key);
      if (!tally) {
        tallies.set(key, { email: key, name, count: 1, lastMs: at, nameMs: name ? at : -Infinity });
        continue;
      }
      tally.count += 1;
      tally.lastMs = Math.max(tally.lastMs, at);
      if (name && at >= tally.nameMs) {
        tally.name = name;
        tally.nameMs = at;
      }
    }
  }
  return [...tallies.values()]
    .sort((a, b) => b.count - a.count || b.lastMs - a.lastMs || a.email.localeCompare(b.email))
    .map(({ email, name }) => ({ email, name }));
}

/**
 * Known participants matching what is typed (email or name, case ignored; matches at the start
 * of the address or of a name word first). Addresses already in the meeting, and the exact
 * address typed, are left out. Empty for an empty query.
 */
export function suggestParticipants(
  known: readonly KnownParticipant[],
  query: string,
  taken: readonly string[],
  limit: number = PARTICIPANT_SUGGESTION_LIMIT,
): KnownParticipant[] {
  const needle = normalized(query);
  if (needle.length === 0) return [];
  const excluded = new Set(taken.map(normalized));
  const starts: KnownParticipant[] = [];
  const contains: KnownParticipant[] = [];
  for (const candidate of known) {
    if (candidate.email === needle || excluded.has(candidate.email)) continue;
    const name = candidate.name?.toLowerCase() ?? '';
    if (candidate.email.startsWith(needle) || name.split(/\s+/).some((word) => word.startsWith(needle))) starts.push(candidate);
    else if (candidate.email.includes(needle) || name.includes(needle)) contains.push(candidate);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
