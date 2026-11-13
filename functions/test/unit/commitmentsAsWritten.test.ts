/**
 * M11 action items as written (functions/src/commitments/asWritten.ts, section 2.5) and the
 * pre-selection (preselect.ts, section 2.6, findings 13, 14 and 27). Synthetic recaps only.
 */
import { asWrittenProposals } from '../../src/commitments/asWritten';
import { itemPreselect, selectAllTargets, summaryPreselect, type PreselectItem } from '../../src/commitments/preselect';
import { selectModelInput } from '../../src/commitments/payload';
import { verifyProposals } from '../../src/commitments/verify';
import type { CommitmentFlag } from '../../src/shared/aiContract';
import type { SummaryTrust } from '../../src/summaries/model';
import { SPANISH_RECAP, SPECIMEN, itemOf, parsed, proposal, sectionOf } from './commitmentsFixtures';

const THU = '2026-10-15';
const SPEC = parsed(SPECIMEN);

function asWritten(text: string, userNames: string[] = ['Dana Lee'], referenceDay = THU) {
  const source = parsed(text);
  return asWrittenProposals({ text: source.text, sections: source.sections, referenceDay, userNames });
}

// ---------------------------------------------------------------------------------------------
// As written
// ---------------------------------------------------------------------------------------------

describe('asWrittenProposals', () => {
  it('on the specimen: the 8 open action items with owners Bish and Cristina Reyes Sierra and no dates, the waiting-on line, and the checklist', () => {
    const list = asWritten(SPECIMEN);
    const actions = list.filter((c) => c.sectionKind === 'action_items');
    expect(actions).toHaveLength(8);
    expect([...new Set(actions.map((c) => c.owner))].sort()).toEqual(['Bish', 'Cristina Reyes Sierra']);
    expect(actions.every((c) => c.due === null && c.confidence === null && c.titleFromAnchor && c.anchorKind === 'item')).toBe(true);
    expect(actions[0]?.title).toBe('Bish: Provide APK access/files to Urpayroll');
    expect(actions[2]?.title).toBe('Cristina Reyes Sierra: Confirm the launch date with the store team');
    // The done item, the TLDR, Updates, Decisions and Open questions are not action items.
    expect(list.map((c) => c.title).join('\n')).not.toMatch(/demo room|ships everything|Postmark|Who signs off/);

    const waiting = list.filter((c) => c.sectionKind === 'waiting_on');
    expect(waiting).toEqual([expect.objectContaining({ owner: 'Urpayroll', kind: 'waiting_on', title: 'Urpayroll to confirm the test devices' })]);

    const checklist = list.filter((c) => c.sectionKind === 'custom');
    expect(checklist.map((c) => [c.title, c.flags])).toEqual([
      ['Store listing reviewed', ['checklist']],
      ['Support inbox staffed', ['checklist']],
    ]);
    // A plain bullet of a custom section is not a checkbox: left out.
    expect(list.some((c) => c.title.includes('Marketing assets'))).toBe(false);
    expect(list).toHaveLength(11);
    // Document order; quotes are the whole items.
    expect(list.map((c) => c.quoteStart)).toEqual([...list.map((c) => c.quoteStart)].sort((a, b) => a - b));
    for (const c of list) expect(SPEC.text.slice(c.quoteStart, c.quoteEnd)).toBe(itemOf(SPEC, SPEC.text.slice(c.quoteStart, c.quoteStart + 12)).text);
  });

  it('removes the owner, waiting-on and due markers from titles; reads only an absolute date in the due text', () => {
    const text = [
      'Sync',
      '',
      'Next steps',
      '- Send the deck (owner: Bish) (due: 2026-11-20 15:00)',
      '- Book the venue (owner: Bish) (due: Friday)',
      '- Draft the FAQ, due by Nov 21 (owner: Dana Lee)',
      '- Order badges (due: 2030-01-01)',
    ].join('\n');
    const list = asWritten(text);
    expect(list.map((c) => [c.title, c.due?.date ?? null, c.due?.time ?? null, c.ownerRole])).toEqual([
      ['Bish: Send the deck', '2026-11-20', '15:00', 'other'],
      ['Bish: Book the venue', null, null, 'other'],
      ['Draft the FAQ', null, null, 'me'],
      ['Order badges', null, null, 'none'],
    ]);
    const source = parsed(text);
    const first = list[0];
    expect(source.text.slice(first?.due?.quoteStart ?? 0, first?.due?.quoteEnd ?? 0)).toBe('2026-11-20 15:00');
  });

  it('keeps Spanish owners and accents, and flags a payment line and the suggested section', () => {
    const list = asWritten(SPANISH_RECAP, ['Luis Ortega']);
    expect(list.map((c) => [c.title, c.ownerRole, c.flags])).toEqual([
      ['Ana de la Cruz: Enviar la propuesta al cliente', 'other', []],
      ['Revisar el contrato antes del viernes', 'me', ['owner_guess']],
      ['Ana de la Cruz: Transferir el anticipo de $500 al proveedor', 'other', ['payment_like']],
      ['Preparar una demo para marketing', 'none', ['suggested']],
    ]);
  });

  it('caps at 30 with the action-list items first', () => {
    const text = [
      'Sync',
      '',
      'Decisions',
      '- Keep the scope',
      '',
      'Launch Readiness',
      ...Array.from({ length: 10 }, (_, n) => `[ ] Check ${n}`),
      '',
      'Action items',
      ...Array.from({ length: 25 }, (_, n) => `- Task ${n}`),
    ].join('\n');
    const list = asWritten(text);
    expect(list).toHaveLength(30);
    expect(list.filter((c) => c.sectionKind === 'action_items')).toHaveLength(25);
    expect(list.filter((c) => c.sectionKind === 'custom').map((c) => c.title)).toEqual(['Check 0', 'Check 1', 'Check 2', 'Check 3', 'Check 4']);
    // Back in document order.
    expect(list[0]?.sectionKind).toBe('custom');
  });
});

// ---------------------------------------------------------------------------------------------
// Pre-selection
// ---------------------------------------------------------------------------------------------

const ROW_7: Pick<SummaryTrust, 'tier' | 'recipientBound' | 'fresh'> = { tier: 'vendor_verified', recipientBound: true, fresh: true };
const ROW_8 = { ...ROW_7, fresh: false };
const ROW_9 = { ...ROW_7, recipientBound: false };
const ROW_10: Pick<SummaryTrust, 'tier' | 'recipientBound' | 'fresh'> = { tier: 'user_forwarded', recipientBound: false, fresh: false };

describe('summaryPreselect: the trust table', () => {
  it('rows 7, 8, 9 and 10 without instruction-like text', () => {
    expect(summaryPreselect(ROW_7, false)).toEqual({ allowed: true, selectAll: true, reason: null });
    expect(summaryPreselect(ROW_8, false)).toEqual({ allowed: false, selectAll: true, reason: 'old_summary' });
    expect(summaryPreselect(ROW_9, false)).toEqual({ allowed: false, selectAll: false, reason: 'not_addressed_to_you' });
    expect(summaryPreselect(ROW_10, false)).toEqual({ allowed: false, selectAll: true, reason: 'forwarded' });
  });

  it('possibleInstruction turns off pre-selection on every row; row 9 keeps no Select all', () => {
    expect(summaryPreselect(ROW_7, true)).toEqual({ allowed: false, selectAll: true, reason: 'possible_instruction' });
    expect(summaryPreselect(ROW_8, true)).toEqual({ allowed: false, selectAll: true, reason: 'possible_instruction' });
    expect(summaryPreselect(ROW_10, true)).toEqual({ allowed: false, selectAll: true, reason: 'possible_instruction' });
    expect(summaryPreselect(ROW_9, true)).toEqual({ allowed: false, selectAll: false, reason: 'not_addressed_to_you' });
  });

  it('is computed from the facts of the moment: the identical-bytes upgrade of a forward (row 10) to the vendor copy (row 7) ticks without a new extraction', () => {
    const list = asWritten(SPECIMEN);
    const ticks = (trust: typeof ROW_7) => list.map((c) => itemPreselect(c, summaryPreselect(trust, false)).preselected);
    expect(ticks(ROW_10).some(Boolean)).toBe(false);
    expect(ticks(ROW_7).filter(Boolean)).toHaveLength(9);
  });
});

describe('itemPreselect', () => {
  const allowed = summaryPreselect(ROW_7, false);
  const base: PreselectItem = { anchorKind: 'item', sectionKind: 'action_items', flags: [], confidence: 90 };

  it('ticks a clean action-list item of a trusted recap, also someone else\'s, also an owner guess', () => {
    for (const sectionKind of ['action_items', 'next_steps', 'waiting_on'] as const) {
      expect(itemPreselect({ ...base, sectionKind }, allowed)).toEqual({ preselected: true, reason: null });
    }
    expect(itemPreselect({ ...base, flags: ['owner_guess'] }, allowed).preselected).toBe(true);
    expect(itemPreselect({ ...base, confidence: null }, allowed).preselected).toBe(true);
  });

  it('confidence 59 is unticked, 60 is ticked', () => {
    expect(itemPreselect({ ...base, confidence: 59 }, allowed)).toEqual({ preselected: false, reason: 'low_confidence' });
    expect(itemPreselect({ ...base, confidence: 60 }, allowed).preselected).toBe(true);
    expect(itemPreselect({ ...base, confidence: 70 }, allowed, 80).preselected).toBe(false);
  });

  it('every blocking flag keeps it unticked with its reason', () => {
    const blocking: CommitmentFlag[] = ['possible_instruction', 'has_link', 'truncated', 'payment_like', 'suggested', 'checklist', 'similar_added'];
    for (const flag of blocking) expect(itemPreselect({ ...base, flags: [flag] }, allowed)).toEqual({ preselected: false, reason: flag });
  });

  it('sentence anchors and items of the other sections are unticked; so is anything not open', () => {
    expect(itemPreselect({ ...base, anchorKind: 'sentence', sectionKind: 'notes' }, allowed).reason).toBe('sentence');
    for (const sectionKind of ['updates', 'decisions', 'open_questions', 'notes', 'body', 'custom', 'preamble'] as const) {
      expect(itemPreselect({ ...base, sectionKind }, allowed)).toEqual({ preselected: false, reason: 'section' });
    }
    expect(itemPreselect({ ...base, status: 'accepted' }, allowed).reason).toBe('not_open');
    expect(itemPreselect({ ...base, status: 'dropped' }, allowed).reason).toBe('not_open');
  });

  it('on rows 8, 9 and 10 nothing is ticked', () => {
    for (const trust of [ROW_8, ROW_9, ROW_10]) expect(itemPreselect(base, summaryPreselect(trust, false))).toEqual({ preselected: false, reason: 'summary' });
  });

  it('as written: custom checkboxes, "Suggested next steps" and payment lines are proposed unticked with their reason', () => {
    const text = [
      'Sync',
      '',
      'Action items',
      '- Send the deck (owner: Bish)',
      '- Pay the caterer $500 (owner: Bish)',
      '',
      'Suggested next steps',
      '- Draft a FAQ',
      '',
      'Launch Readiness',
      '[ ] Store listing reviewed',
    ].join('\n');
    const reasons = asWritten(text).map((c) => [c.title, itemPreselect(c, allowed).reason]);
    expect(reasons).toEqual([
      ['Bish: Send the deck', null],
      ['Bish: Pay the caterer $500', 'payment_like'],
      ['Draft a FAQ', 'suggested'],
      ['Store listing reviewed', 'checklist'],
    ]);
  });

  it('AI proposals from updates, decisions and prose stay unticked on a trusted recap', () => {
    const source = parsed(['Sync', '', 'Decisions', '- Review the pricing page next sprint', '', 'Notes', 'Dana will review the onboarding flow by Friday.'].join('\n'));
    const result = verifyProposals({
      text: source.text,
      sections: source.sections,
      input: selectModelInput(source.text, source.sections),
      proposals: [
        proposal(itemOf(source, 'Review the pricing').id, { title: 'Review the pricing page' }),
        proposal(sectionOf(source, 'notes').id, { quote: 'Dana will review the onboarding flow', title: 'Review the onboarding flow', owner: 'Dana' }),
      ],
      referenceDay: THU,
      language: 'en',
      userNames: [],
    });
    expect(result.commitments.map((c) => itemPreselect(c, allowed).reason)).toEqual(['section', 'sentence']);
  });
});

describe('selectAllTargets', () => {
  it('nothing on row 9; otherwise every open suggestion except those flagged possible_instruction', () => {
    const items = [
      { flags: [] as CommitmentFlag[] },
      { flags: ['possible_instruction'] as CommitmentFlag[] },
      { flags: ['payment_like'] as CommitmentFlag[] },
      { flags: [] as CommitmentFlag[], status: 'accepted' as const },
    ];
    expect(selectAllTargets(items, summaryPreselect(ROW_9, false))).toEqual([]);
    expect(selectAllTargets(items, summaryPreselect(ROW_7, true))).toEqual([0, 2]);
    // A flagged item is never ticked by Select all, whatever the row.
    expect(selectAllTargets(items, summaryPreselect(ROW_10, false))).toEqual([0, 2]);
  });
});
