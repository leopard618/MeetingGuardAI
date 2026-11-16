/**
 * The accepted notetakers for the app's setup steps (summaryStatus notetakers): one entry per
 * SUMMARIES_SENDERS address, with a display name from the sender's domain. PURE: no Firebase, no
 * mail verification code (callables load this; mail/headers.ts imports only node:url).
 *
 * SUMMARIES_SENDERS is the one list for every user: each address in it is a notetaker whose
 * signed summaries are checked and can file by themselves (calibrated on a real recap first,
 * docs/v2/M10-DESIGN.md section 21). A sender whose domain is not in NOTETAKER_NAMES shows its
 * domain as the name.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { SUMMARY_LIMITS, type SummaryNotetaker } from '../shared/aiContract';
import { normalizeAddress } from '../mail/headers';

/** Display names by sender domain (the domain itself or a parent of it). */
export const NOTETAKER_NAMES: Readonly<Record<string, string>> = {
  'fathom.video': 'Fathom',
  'otter.ai': 'Otter',
  'fireflies.ai': 'Fireflies',
  'read.ai': 'Read.ai',
  'tldv.io': 'tl;dv',
  'zoom.us': 'Zoom',
  'granola.so': 'Granola',
  'avoma.com': 'Avoma',
  'circleback.ai': 'Circleback',
  'meetgeek.ai': 'MeetGeek',
  'krisp.ai': 'Krisp',
  'notta.ai': 'Notta',
  'tactiq.io': 'Tactiq',
  'sembly.ai': 'Sembly',
  'bluedothq.com': 'Bluedot',
};

/** The display name for a normalized sender address: its domain or a parent in NOTETAKER_NAMES, else the domain. */
export function notetakerName(sender: string): string {
  const domain = sender.slice(sender.lastIndexOf('@') + 1);
  const labels = domain.split('.');
  for (let start = 0; start < labels.length - 1; start++) {
    const name = NOTETAKER_NAMES[labels.slice(start).join('.')];
    if (name !== undefined) return name;
  }
  return domain.slice(0, 40);
}

/** SUMMARIES_SENDERS (raw comma list) as the status's notetakers: normalized, deduplicated, in list order. */
export function notetakersOf(raw: string | null | undefined): SummaryNotetaker[] {
  if (typeof raw !== 'string') return [];
  const out: SummaryNotetaker[] = [];
  for (const entry of raw.split(',')) {
    const sender = normalizeAddress(entry);
    if (sender === null || out.some((n) => n.sender === sender)) continue;
    out.push({ name: notetakerName(sender), sender });
    if (out.length >= SUMMARY_LIMITS.maxNotetakers) break;
  }
  return out;
}
