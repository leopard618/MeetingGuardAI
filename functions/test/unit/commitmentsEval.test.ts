/**
 * The commitments eval fixtures and scoring (functions/scripts/eval-commitments/recaps.json and
 * functions/src/commitments/evalScore.ts; docs/v2/M11-DESIGN.md section 8 "Eval"). The real
 * prompt and the real checks run offline with a "perfect model" built from the fixture's own
 * expectations, so a fixture typo, a date the code reads differently or a scoring bug fails here,
 * before anyone spends an OpenAI call. Never calls the network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { asWrittenProposals } from '../../src/commitments/asWritten';
import { referenceDayOf } from '../../src/commitments/due';
import { parseEvalFile, perfectProposals, recapText, scoreRecap, summarizeScores, titleHasContact, type EvalRecap } from '../../src/commitments/evalScore';
import { selectModelInput } from '../../src/commitments/payload';
import { buildCommitmentsPrompt } from '../../src/commitments/prompt';
import { verifyProposals } from '../../src/commitments/verify';
import { parseSections } from '../../src/summaries/sections';

const FIXTURE_PATH = join(__dirname, '..', '..', 'scripts', 'eval-commitments', 'recaps.json');
const RAW = readFileSync(FIXTURE_PATH, 'utf8');
const RECAPS = parseEvalFile(JSON.parse(RAW));

function pipeline(recap: EvalRecap, proposals: (text: string, sections: ReturnType<typeof parseSections>['sections']) => unknown[]) {
  const text = recapText(recap);
  const sections = parseSections(text).sections;
  const reference = referenceDayOf({
    meetingSnapshot: recap.meeting === null ? null : { startAt: recap.meeting.startAt, timezone: recap.meeting.timezone },
    summaryDate: recap.summaryDate,
    anchorAt: null,
    receivedAt: recap.meeting?.startAt ?? `${recap.summaryDate ?? '2026-11-01'}T12:00:00.000Z`,
    preferencesTimeZone: null,
  });
  const input = selectModelInput(text, sections);
  const prompt = buildCommitmentsPrompt({ input, reference, meetingTitle: recap.meeting?.title ?? null, language: recap.language, nonce: 'evalnonce' });
  const verified = verifyProposals({ text, sections, input, proposals: proposals(text, sections), referenceDay: reference.day, language: recap.language, userNames: recap.userNames });
  return { text, sections, reference, input, prompt, verified };
}

describe('the eval fixtures', () => {
  it('hold ten recaps in English and Spanish, ASCII punctuation only', () => {
    expect(RECAPS).toHaveLength(10);
    expect(new Set(RECAPS.map((recap) => recap.language))).toEqual(new Set(['en', 'es']));
    expect(new Set(RECAPS.map((recap) => recap.id)).size).toBe(10);
    const banned = [0x2013, 0x2014, 0x2026, 0x2018, 0x2019, 0x201c, 0x201d, 0xfffd].map((code) => String.fromCharCode(code));
    for (const character of banned) expect(RAW.includes(character)).toBe(false);
  });

  it.each(RECAPS.map((recap) => [recap.id, recap] as const))('%s passes with a perfect model (fixture and checks agree)', (_id, recap) => {
    const run = pipeline(recap, (text, sections) => perfectProposals(recap, text, sections));
    const score = scoreRecap(recap, {
      text: run.text,
      commitments: run.verified.commitments,
      counts: run.verified.counts,
      failure: null,
      finishReason: 'tool_calls',
      promptTokens: null,
      completionTokens: null,
    });
    expect({ id: recap.id, missing: score.missing, wrongOwner: score.wrongOwner, wrongDue: score.wrongDue, wrongKind: score.wrongKind, missingFlags: score.missingFlags, forbiddenHits: score.forbiddenHits, titlesWithContact: score.titlesWithContact }).toEqual({
      id: recap.id,
      missing: [],
      wrongOwner: [],
      wrongDue: [],
      wrongKind: [],
      missingFlags: [],
      forbiddenHits: 0,
      titlesWithContact: 0,
    });
    expect(score.pass).toBe(true);
    // A forbidden text inside a derived section (TLDR, summary) never even reaches the model.
    for (const text of recap.forbidden) {
      const inDerived = run.sections.some((section) => section.derived && run.text.slice(section.start, section.end).includes(text));
      if (inDerived) expect([text, run.prompt.messages[1]?.content.includes(text)]).toEqual([text, false]);
    }
  });

  it('the near-caps recap is cut to 30 suggestions and the ambiguous numeric date is cleared', () => {
    const recap = RECAPS.find((entry) => entry.id === 'near_caps') as EvalRecap;
    const text = recapText(recap);
    const sections = parseSections(text).sections;
    expect(sections.flatMap((section) => section.items).length).toBeGreaterThan(30);
    const asWritten = asWrittenProposals({ text, sections, referenceDay: '2026-11-11', userNames: recap.userNames });
    expect(asWritten).toHaveLength(30);
    const run = pipeline(recap, (body, parsed) => perfectProposals(recap, body, parsed));
    expect(run.verified.counts.cleared.due_ambiguous).toBe(1);
  });
});

describe('the scoring', () => {
  const recap = RECAPS.find((entry) => entry.id === 'links') as EvalRecap;

  it('counts a missing expectation, a forbidden quote and a title with contact details by position only', () => {
    const run = pipeline(recap, (text, sections) => perfectProposals(recap, text, sections).slice(1));
    const score = scoreRecap({ ...recap, forbidden: ['Call the partner hotline'] }, {
      text: run.text,
      commitments: run.verified.commitments.map((commitment, index) => (index === 0 ? { ...commitment, title: 'Call +1 555 010 2233 now' } : commitment)),
      counts: run.verified.counts,
      failure: null,
      finishReason: 'length',
      promptTokens: 100,
      completionTokens: 50,
    });
    expect(score).toMatchObject({ missing: [1], forbiddenHits: 1, titlesWithContact: 1, pass: false });
    expect(summarizeScores([score])).toMatchObject({ recaps: 1, passed: 0, lengthFinishes: 1, promptTokens: 100, completionTokens: 50 });
    expect(JSON.stringify(score)).not.toContain('hotline');
  });

  it('titleHasContact sees links, email addresses, phone numbers and bare hosts, not ISO dates', () => {
    expect(titleHasContact('Share https://docs.example.com/guide')).toBe(true);
    expect(titleHasContact('Email ops@partner.example')).toBe(true);
    expect(titleHasContact('Call +1 555 010 2233')).toBe(true);
    expect(titleHasContact('Update pay-here.example copy')).toBe(true);
    expect(titleHasContact('Ship the build by 2026-11-21')).toBe(false);
    expect(titleHasContact('Kim: Share the onboarding guide with the partner')).toBe(false);
  });
});
