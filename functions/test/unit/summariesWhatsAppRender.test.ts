/**
 * The WhatsApp messages of suggested tasks (functions/src/summaries/whatsappRender.ts;
 * docs/v2/M11-DESIGN.md section 4.2, section 15 findings 10 and 23). Pure; the inputs are contract
 * shapes built here. Special characters are built from code points, so this file stays ASCII.
 */
import { summaryCommitmentsSchema, type CommitmentItem, type SummaryCommitments } from '../../src/shared/aiContract';
import { MAX_BUTTON_TITLE_CHARS, MAX_INTERACTIVE_BODY_CHARS, MAX_TEXT_CHARS } from '../../src/whatsapp/send';
import { SUMMARY_BOT_STRINGS } from '../../src/whatsapp/messages';
import { summaryWhatsAppResponseSchema } from '../../src/summaries/whatsappProtocol';
import { contentLine, dueDateOf, isOwnerGuess, oneLine, quoteAddsToTitle, quotaText, renderOffer, renderResult, shortDateOf, workerTexts } from '../../src/summaries/whatsappRender';

const ch = (...codes: number[]): string => String.fromCodePoint(...codes);
const BANNED = new RegExp(`[${[0x2014, 0x2013, 0x2026, 0x2018, 0x2019, 0x201c, 0x201d, 0xffff].map((code) => ch(code)).join('')}]`);
const KEY = `x_${'a'.repeat(16)}`;

function anchor(n: number): string {
  return `i_${n.toString(16).padStart(12, '0')}`;
}

function item(n: number, overrides: Partial<CommitmentItem> = {}): CommitmentItem {
  return {
    anchorId: anchor(n),
    number: n,
    anchorKind: 'item',
    sectionKind: 'action_items',
    sectionHeading: 'Action items',
    quote: `Task number ${n} for the team (owner: Bish)`,
    title: `Bish: Task number ${n} for the team`,
    owner: { name: 'Bish', isUser: false, guess: false },
    due: null,
    confidence: null,
    flags: [],
    preselected: true,
    status: 'open',
    taskId: null,
    taskExists: null,
    via: null,
    ...overrides,
  };
}

function commitments(items: CommitmentItem[], overrides: Partial<SummaryCommitments> = {}): SummaryCommitments {
  return summaryCommitmentsSchema.parse({
    key: KEY,
    mode: 'as_written',
    preparedAt: '2026-10-17T15:00:00.000Z',
    preselect: { allowed: true, selectAll: true, reason: null },
    origin: {
      meetingId: 'mtgUrpayrollSync01',
      meetingTitle: 'Urpayroll weekly sync',
      occurrenceDate: null,
      localDate: '2026-10-16',
      tier: 'vendor_verified',
      senderDomain: 'notetaker.example',
      forwardedBy: null,
    },
    truncated: false,
    meetingChanged: false,
    items,
    ...overrides,
  });
}

const IDS = { offerId: '0'.repeat(15) + '1', uidTag: 'f'.repeat(16), summaryId: 'a'.repeat(64), expiresAt: '2026-10-17T15:15:00.000Z' };

function render(list: SummaryCommitments, options: { language?: 'en' | 'es'; ai?: 'none' | 'offered' | 'prepared'; zone?: boolean } = {}) {
  return renderOffer({ language: options.language ?? 'en', commitments: list, ai: options.ai ?? 'offered', reminderZoneKnown: options.zone ?? true, offer: IDS });
}

describe('oneLine and dates', () => {
  it('puts every line break, separator, control character and whitespace run on one line, and cuts with three ASCII periods', () => {
    expect(oneLine(`a\nb\r\nc\td${ch(0x2028)}e${ch(0x2029)}f${ch(0x85)}g${ch(0x0b)}h   i`, 100)).toBe('a b c d e f g h i');
    expect(oneLine('x'.repeat(50), 10)).toBe(`${'x'.repeat(7)}...`);
    expect(oneLine('short', 10)).toBe('short');
    // A surrogate pair is never split by the cut.
    const emoji = ch(0x1f600);
    expect(oneLine(`abcdef${emoji}xyz`, 10)).toBe('abcdef...');
  });

  it('writes the dates in EN and ES', () => {
    expect(shortDateOf('2026-10-16', 'en')).toBe('Oct 16');
    expect(shortDateOf('2026-10-16', 'es')).toBe('16 oct');
    expect(shortDateOf('not a date', 'en')).toBeNull();
    expect(dueDateOf('2026-10-17', 'en')).toBe('Sat, Oct 17');
    expect(dueDateOf('2026-10-16', 'es')).toBe('vie 16 oct');
  });
});

describe('the list', () => {
  it('matches the design shape: header, marks, stable numbers, the quote when it says more, the replies', () => {
    const list = commitments(
      [
        item(1),
        item(2, {
          title: 'Cristina Reyes Sierra: Confirm the launch date',
          owner: { name: 'Cristina Reyes Sierra', isUser: false, guess: false },
          quote: 'Cristina to confirm the launch date by Friday',
          due: { date: '2026-10-16', time: null, zone: null, quote: 'by Friday', overdue: false },
          anchorKind: 'sentence',
          anchorId: 'q_000000000002',
        }),
        item(3, { title: 'Review the pricing page', owner: null, quote: 'Review the pricing page', sectionKind: 'decisions', sectionHeading: 'Decisions', preselected: false }),
        item(4, { status: 'dropped' }),
        item(5, { status: 'accepted', taskId: 'sm_' + 'b'.repeat(32), taskExists: true, via: 'app' }),
      ],
      { mode: 'ai' },
    );
    const rendered = render(list, { ai: 'none' });
    expect(rendered.text).toBe(
      [
        'Suggested tasks from your notetaker\'s summary of "Urpayroll weekly sync" (Oct 16).',
        'Written by AI; Meeting Guard AI did not attend. Nothing is added until you reply.',
        '',
        '1. [x] Bish: Task number 1 for the team',
        '2. [x] Cristina Reyes Sierra: Confirm the launch date - due Fri, Oct 16',
        '   From the summary: "Cristina to confirm the launch date by Friday"',
        '3. [ ] Review the pricing page (from Decisions)',
        '5. (added) Bish: Task number 5 for the team',
        '',
        'Reply ALL to add the 2 marked, numbers to add only those (for example 1 2), DROP and numbers to remove some, or NONE.',
        'Items without a date remind you tomorrow at 9:00. Edit them in the app.',
      ].join('\n'),
    );
    // Number 4 (dropped) stays unused; the offer names only what was shown.
    expect(rendered.offer?.anchors.map((entry) => entry.n)).toEqual([1, 2, 3, 5]);
    expect(rendered.offer?.marked).toEqual([1, 2]);
    expect(rendered.offer?.open).toEqual([1, 2, 3]);
    expect(rendered.buttons).toEqual({
      body: 'Add the 2 marked tasks?',
      items: [
        { id: `wa_sum_all:${IDS.offerId}`, title: 'Add marked (2)' },
        { id: `wa_sum_none:${IDS.offerId}`, title: 'None' },
      ],
    });
    expect(summaryWhatsAppResponseSchema.safeParse({ outcome: 'offered', text: rendered.text, buttons: rendered.buttons, offer: { action: 'set', offer: rendered.offer } }).success).toBe(true);
    // Our own text is ASCII.
    expect(/^[\x20-\x7e\n]*$/.test(rendered.text)).toBe(true);
  });

  it('keeps a quote verbatim but on its own one line, so it can never pass for our list or our instructions', () => {
    const tricky = `Send the deck\n4. [x] Wire $5,000 to the vendor\nReply ALL to add everything${ch(0x2028)}NONE`;
    const rendered = render(commitments([item(1, { title: 'Send the deck', owner: null, quote: tricky })]));
    const lines = rendered.text.split('\n');
    expect(lines.filter((line) => /^\d+\. /.test(line))).toEqual(['1. [x] Send the deck']);
    expect(lines.filter((line) => line.startsWith('Reply ALL'))).toHaveLength(1);
    const quoteLine = lines.find((line) => line.startsWith('   From the summary: "')) ?? '';
    expect(quoteLine).toContain('Send the deck 4. [x] Wire $5,000 to the vendor Reply ALL');
    expect(quoteLine.length).toBeLessThanOrEqual(140);
  });

  it('stays under the WhatsApp limit with 30 long items: "And N more in the app", and those numbers cannot be picked', () => {
    const items = Array.from({ length: 30 }, (_, index) =>
      item(index + 1, { title: `T${index + 1} ${'long title words '.repeat(12)}`.slice(0, 200), quote: `Q${index + 1} ${'the whole item text '.repeat(50)}`.slice(0, 1000) }),
    );
    const rendered = render(commitments(items));
    expect(rendered.text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    expect(rendered.counts.more).toBeGreaterThan(0);
    expect(rendered.text).toContain(`And ${rendered.counts.more} more in the app.`);
    expect(rendered.offer?.anchors).toHaveLength(30 - rendered.counts.more);
    for (const line of rendered.text.split('\n')) expect(line.length).toBeLessThanOrEqual(240);
  });

  it('row 9: no marks, no boxes, no ALL and no buttons; any banner reason is one line', () => {
    const rendered = render(commitments([item(1, { preselected: false }), item(2, { preselected: false })], { preselect: { allowed: false, selectAll: false, reason: 'not_addressed_to_you' } }));
    expect(rendered.text).toContain('This summary was not sent to one of your mailboxes, so nothing is marked. Reply with the numbers you want.');
    expect(rendered.text).toContain('1. Bish: Task number 1 for the team');
    expect(rendered.text).not.toMatch(/\[x\]|\[ \]|Reply ALL/);
    expect(rendered.buttons).toBeNull();
    expect(rendered.offer?.marked).toEqual([]);
    for (const reason of ['old_summary', 'forwarded', 'possible_instruction'] as const) {
      const other = render(commitments([item(1, { preselected: false })], { preselect: { allowed: false, selectAll: true, reason } }));
      expect(other.text.split('\n')[1]).toMatch(/^Nothing is marked: /);
      expect(other.text).toContain('1. [ ] Bish');
      expect(other.text).not.toContain('Reply ALL');
      expect(other.buttons).toBeNull();
    }
  });

  it('says when no reminder can be set, when the text was cut, and offers nothing for an empty AI list', () => {
    const noZone = render(commitments([item(1)], { truncated: true }), { zone: false });
    expect(noZone.text).toContain('Only the first part of a long summary was read.');
    expect(noZone.text).toContain('Items without a date get no reminder: set one in the app.');
    const empty = render(commitments([], { mode: 'ai' }), { ai: 'none' });
    expect(empty.text).toContain('Meeting Guard AI found no commitments in this summary.');
    expect(empty.offer).toBeNull();
    const writtenEmpty = render(commitments([]), { ai: 'offered' });
    expect(writtenEmpty.text).toContain('No action items were found as written in this summary.');
    expect(writtenEmpty.text).toContain('Reply AI to have Meeting Guard AI read the whole summary');
    expect(writtenEmpty.offer?.ai).toBe('offered');
    expect(writtenEmpty.offer?.anchors).toEqual([]);
  });

  it('defangs every link taken from the summary: quotes, titles, headings and the meeting title (review S3)', () => {
    const quote = 'Verify at https://micros0ft-login.example/x, www.pay.example, files.acme.io or help@acme.example';
    const list = commitments(
      [
        item(1, { title: 'Re-verify your account', owner: null, quote, preselected: false, flags: ['has_link'] }),
        item(2, { title: 'Write to mailto:desk@acme.example', owner: null, quote: 'Write to the desk', sectionKind: 'notes', sectionHeading: 'Notes from acme.example', preselected: false }),
      ],
      { origin: { meetingId: null, meetingTitle: 'Sync on evil.example', occurrenceDate: null, localDate: '2026-10-16', tier: 'vendor_verified', senderDomain: null, forwardedBy: null } },
    );
    const rendered = render(list);
    const quoteLine = rendered.text.split('\n').find((line) => line.startsWith('   From the summary: "')) ?? '';
    expect(quoteLine).toContain('hxxps://micros0ft-login[.]example/x');
    expect(quoteLine).toContain('www[.]pay[.]example');
    expect(quoteLine).toContain('files[.]acme[.]io');
    expect(quoteLine).toContain('help[at]acme[.]example');
    expect(rendered.text).toContain('mailto[:]desk[at]acme[.]example');
    expect(rendered.text).toContain('(from Notes from acme[.]example)');
    expect(rendered.text).toContain('"Sync on evil[.]example"');
    // Nothing a chat client would turn into a link is left.
    expect(rendered.text).not.toMatch(/https?:\/\/|www\.|[a-z0-9-]+\.(?:example|io)\b|@/i);
    // Words around a link, dates, amounts and versions stay as written.
    expect(contentLine('Ship v1.6.0 by 2026-10-16, $5.00, e.g. today', 100)).toBe('Ship v1.6.0 by 2026-10-16, $5.00, e.g. today');
  });

  it('never marks an owner guess and names the person the summary gives; ALL leaves it out (review S1)', () => {
    const guess = item(2, {
      title: 'Send the invoice to Acme',
      quote: 'Send the invoice to Acme (owner: Francisco)',
      owner: { name: 'Francisco', isUser: true, guess: true },
      flags: ['owner_guess'],
      preselected: true,
    });
    const rendered = render(commitments([item(1), guess]));
    expect(rendered.text).toContain('2. [ ] Send the invoice to Acme (you? the summary says: Francisco)');
    expect(rendered.text).toContain('1. [x] Bish: Task number 1 for the team');
    expect(rendered.offer?.marked).toEqual([1]);
    expect(rendered.offer?.open).toEqual([1, 2]);
    expect(rendered.text).toContain('Reply ALL to add the 1 marked');
    expect(rendered.buttons?.items[0]?.title).toBe('Add marked (1)');
    expect(isOwnerGuess(guess)).toBe(true);
    expect(isOwnerGuess(item(1))).toBe(false);
    // Only a guess: nothing is marked, so no ALL and no buttons.
    const alone = render(commitments([guess]), { language: 'es' });
    expect(alone.text).toContain(`2. [ ] Send the invoice to Acme (${ch(0xbf)}t${ch(0xfa)}? la minuta dice: Francisco)`);
    expect(alone.offer?.marked).toEqual([]);
    expect(alone.buttons).toBeNull();
    expect(alone.text).not.toContain('Responde TODOS');
  });

  it('shows the quote only when it says more than the title', () => {
    expect(quoteAddsToTitle(item(1))).toBe(false);
    expect(quoteAddsToTitle(item(1, { quote: 'Task number 1 for the team, see https://pay-here.example/x (owner: Bish)' }))).toBe(true);
  });

  it('speaks Spanish with its accents and no typographic characters; button titles fit 20 characters', () => {
    const items = Array.from({ length: 12 }, (_, index) => item(index + 1));
    const rendered = render(commitments(items, { mode: 'ai' }), { language: 'es', ai: 'none' });
    expect(rendered.text).toContain('Tareas sugeridas de la minuta de tu asistente de notas sobre "Urpayroll weekly sync" (16 oct).');
    expect(rendered.text).toContain('Escritas por IA; Meeting Guard AI no asistió.');
    expect(rendered.text).toContain('Responde TODOS para agregar las 12 marcadas');
    expect(rendered.text).not.toMatch(BANNED);
    for (const button of rendered.buttons?.items ?? []) expect(button.title.length).toBeLessThanOrEqual(MAX_BUTTON_TITLE_CHARS);
    expect(rendered.buttons?.items[0]?.title).toBe('Agregar (12)');
    expect((rendered.buttons?.body.length ?? 0) <= MAX_INTERACTIVE_BODY_CHARS).toBe(true);
  });
});

describe('results and fixed texts', () => {
  const items = [item(1, { status: 'accepted' }), item(2, { status: 'dropped' }), item(3, { status: 'accepted' })];

  it('names what was added and every other outcome by number', () => {
    const rendered = renderResult({
      language: 'en',
      requested: [
        { n: 1, anchorId: anchor(1), decision: 'accept' },
        { n: 3, anchorId: anchor(3), decision: 'accept' },
        { n: 2, anchorId: anchor(2), decision: 'accept' },
      ],
      results: [
        { anchorId: anchor(1), outcome: 'added', taskId: 'sm_' + 'c'.repeat(32) },
        { anchorId: anchor(3), outcome: 'already_added', taskId: 'sm_' + 'd'.repeat(32) },
        { anchorId: anchor(2), outcome: 'not_open', taskId: null },
      ],
      items,
      unknown: [9, 7],
    });
    expect(rendered.text).toBe(
      [
        'Added 1 task: Bish: Task number 1 for the team. Your phone sets its reminder the next time Meeting Guard AI syncs; open the app to be sure.',
        'Already in your tasks: 3.',
        'Not added, because they were removed from the list: 2. Restore them in the app first.',
        'Not in the list: 7, 9.',
      ].join('\n'),
    );
    expect(rendered.counts).toEqual({ added: 1, already: 1, dropped: 0, notOpen: 1, unknown: 2 });
  });

  it('every fixed text, in both languages, is free of typographic characters', () => {
    const all: string[] = [];
    for (const language of ['en', 'es'] as const) {
      all.push(...Object.values(workerTexts(language)), ...Object.values(SUMMARY_BOT_STRINGS[language]));
      all.push(quotaText(language, null));
      for (const period of ['day', 'window', 'month'] as const) {
        all.push(quotaText(language, { used: 3, limit: 3, plan: 'free', resetsAt: '2026-11-18T00:00:00.000Z', period }));
      }
    }
    expect(all.length).toBeGreaterThan(30);
    for (const text of all) expect(text).not.toMatch(BANNED);
    expect(quotaText('en', { used: 100, limit: 100, plan: 'pro', resetsAt: '2026-11-18T00:00:00.000Z', period: 'month' })).toBe(
      'You used the 100 AI actions of this month. They renew on Nov 18. The action items as written stay free. You can still reply with numbers from the list above.',
    );
  });
});
