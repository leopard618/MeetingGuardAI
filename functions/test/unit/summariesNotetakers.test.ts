/**
 * The accepted notetakers in summaryStatus (functions/src/summaries/notetakers.ts).
 */
import { SUMMARY_LIMITS } from '../../src/shared/aiContract';
import { notetakerName, notetakersOf } from '../../src/summaries/notetakers';

describe('notetakersOf', () => {
  it('lists each SUMMARIES_SENDERS address once, normalized, in order, with its name', () => {
    expect(notetakersOf(' No-Reply@Fathom.video , notes@mail.otter.ai,no-reply@fathom.video,acme.com, bad, x@unknown.example ')).toEqual([
      { name: 'Fathom', sender: 'no-reply@fathom.video' },
      { name: 'Otter', sender: 'notes@mail.otter.ai' },
      { name: 'unknown.example', sender: 'x@unknown.example' },
    ]);
  });

  it('is empty for an empty or missing list', () => {
    expect(notetakersOf('')).toEqual([]);
    expect(notetakersOf(undefined)).toEqual([]);
    expect(notetakersOf(null)).toEqual([]);
  });

  it('stops at SUMMARY_LIMITS.maxNotetakers', () => {
    const raw = Array.from({ length: SUMMARY_LIMITS.maxNotetakers + 5 }, (_, i) => `n${i}@vendor.example`).join(',');
    expect(notetakersOf(raw)).toHaveLength(SUMMARY_LIMITS.maxNotetakers);
  });
});

describe('notetakerName', () => {
  it('uses the domain or a parent domain, else the domain itself', () => {
    expect(notetakerName('no-reply@fathom.video')).toBe('Fathom');
    expect(notetakerName('recap@mail.read.ai')).toBe('Read.ai');
    expect(notetakerName('a@notes.example.org')).toBe('notes.example.org');
  });
});
