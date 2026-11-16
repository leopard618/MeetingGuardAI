/**
 * The WhatsApp messages of suggested tasks (functions/src/summaries/whatsappRender.ts;
 * docs/v2/M11-DESIGN.md section 4.2, section 15 findings 10 and 23). Pure; the inputs are contract
 * shapes built here. Special characters are built from code points, so this file stays ASCII.
 */
import { APP_LANGUAGES, summaryCommitmentsSchema, type AppLanguage, type CommitmentItem, type SummaryCommitments } from '../../src/shared/aiContract';
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

function render(list: SummaryCommitments, options: { language?: AppLanguage; ai?: 'none' | 'offered' | 'prepared'; zone?: boolean } = {}) {
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

  it('M12: writes the dates day-first in PT, FR and DE', () => {
    expect(shortDateOf('2026-10-16', 'pt')).toBe('16 out');
    expect(dueDateOf('2026-10-16', 'pt')).toBe('sex, 16 out');
    expect(dueDateOf('2026-10-17', 'pt')).toBe(`s${ch(0xe1)}b, 17 out`);
    expect(shortDateOf('2026-10-16', 'fr')).toBe('16 oct.');
    expect(shortDateOf('2026-08-01', 'fr')).toBe(`1 ao${ch(0xfb)}t`);
    expect(dueDateOf('2026-10-16', 'fr')).toBe('ven. 16 oct.');
    expect(shortDateOf('2026-10-16', 'de')).toBe('16. Okt.');
    expect(shortDateOf('2026-03-02', 'de')).toBe(`2. M${ch(0xe4)}rz`);
    expect(dueDateOf('2026-10-16', 'de')).toBe('Fr., 16. Okt.');
    // Any other language reads English.
    expect(shortDateOf('2026-10-16', 'it' as AppLanguage)).toBe('Oct 16');
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
    expect(rendered.text).toContain('Escritas por IA; Meeting Guard AI no asisti\u00f3.');
    expect(rendered.text).toContain('Responde TODOS para agregar las 12 marcadas');
    expect(rendered.text).not.toMatch(BANNED);
    for (const button of rendered.buttons?.items ?? []) expect(button.title.length).toBeLessThanOrEqual(MAX_BUTTON_TITLE_CHARS);
    expect(rendered.buttons?.items[0]?.title).toBe('Agregar (12)');
    expect((rendered.buttons?.body.length ?? 0) <= MAX_INTERACTIVE_BODY_CHARS).toBe(true);
  });
});

describe('M12: the list in PT (pt-BR), FR and DE', () => {
  const sample = () =>
    commitments(
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
        item(5, { status: 'accepted', taskId: 'sm_' + 'b'.repeat(32), taskExists: true, via: 'app' }),
      ],
      { mode: 'ai' },
    );

  it('PT: header, day-first dates, suffixes, replies and buttons', () => {
    const rendered = render(sample(), { language: 'pt', ai: 'none' });
    expect(rendered.text).toBe(
      [
        `Tarefas sugeridas do resumo do seu assistente de anota${ch(0xe7)}${ch(0xf5)}es sobre "Urpayroll weekly sync" (16 out).`,
        `Escritas por IA; o Meeting Guard AI n${ch(0xe3)}o participou. Nada ${ch(0xe9)} adicionado at${ch(0xe9)} voc${ch(0xea)} responder.`,
        '',
        '1. [x] Bish: Task number 1 for the team',
        '2. [x] Cristina Reyes Sierra: Confirm the launch date - vence sex, 16 out',
        '   Do resumo: "Cristina to confirm the launch date by Friday"',
        '3. [ ] Review the pricing page (de Decisions)',
        '5. (adicionada) Bish: Task number 5 for the team',
        '',
        `Responda TODAS para adicionar as 2 marcadas, n${ch(0xfa)}meros para adicionar s${ch(0xf3)} essas (por exemplo 1 2), REMOVER e n${ch(0xfa)}meros para remover algumas, ou NENHUMA.`,
        `As que n${ch(0xe3)}o t${ch(0xea)}m data lembram voc${ch(0xea)} amanh${ch(0xe3)} ${ch(0xe0)}s 9:00. Edite-as no app.`,
      ].join('\n'),
    );
    expect(rendered.buttons).toEqual({
      body: 'Adicionar as 2 tarefas marcadas?',
      items: [
        { id: `wa_sum_all:${IDS.offerId}`, title: 'Adicionar (2)' },
        { id: `wa_sum_none:${IDS.offerId}`, title: 'Nenhuma' },
      ],
    });
  });

  it('FR: header, day-first dates, suffixes, replies and buttons (no space before a colon or question mark)', () => {
    const rendered = render(sample(), { language: 'fr', ai: 'none' });
    expect(rendered.text).toBe(
      [
        `T${ch(0xe2)}ches sugg${ch(0xe9)}r${ch(0xe9)}es ${ch(0xe0)} partir du compte rendu de votre assistant de prise de notes sur "Urpayroll weekly sync" (16 oct.).`,
        `R${ch(0xe9)}dig${ch(0xe9)}es par IA; Meeting Guard AI n'a pas assist${ch(0xe9)} ${ch(0xe0)} la r${ch(0xe9)}union. Rien n'est ajout${ch(0xe9)} avant votre r${ch(0xe9)}ponse.`,
        '',
        '1. [x] Bish: Task number 1 for the team',
        `2. [x] Cristina Reyes Sierra: Confirm the launch date - ${ch(0xe9)}ch${ch(0xe9)}ance ven. 16 oct.`,
        '   Du compte rendu: "Cristina to confirm the launch date by Friday"',
        '3. [ ] Review the pricing page (de Decisions)',
        `5. (ajout${ch(0xe9)}e) Bish: Task number 5 for the team`,
        '',
        `R${ch(0xe9)}pondez TOUTES pour ajouter les 2 coch${ch(0xe9)}es, des num${ch(0xe9)}ros pour n'ajouter que celles-ci (par exemple 1 2), RETIRER et des num${ch(0xe9)}ros pour en retirer, ou AUCUNE.`,
        `Celles sans date vous rappellent demain ${ch(0xe0)} 9h00. Modifiez-les dans l'application.`,
      ].join('\n'),
    );
    expect(rendered.text).not.toMatch(/ [:;?!]/);
    expect(rendered.buttons).toEqual({
      body: `Ajouter les 2 t${ch(0xe2)}ches coch${ch(0xe9)}es?`,
      items: [
        { id: `wa_sum_all:${IDS.offerId}`, title: `Ajouter coch${ch(0xe9)}es (2)` },
        { id: `wa_sum_none:${IDS.offerId}`, title: 'Aucune' },
      ],
    });
  });

  it('DE: header, day-first dates, suffixes, replies and buttons (formal Sie)', () => {
    const rendered = render(sample(), { language: 'de', ai: 'none' });
    expect(rendered.text).toBe(
      [
        'Vorgeschlagene Aufgaben aus dem Protokoll Ihres Notizassistenten zu "Urpayroll weekly sync" (16. Okt.).',
        `Von KI geschrieben; Meeting Guard AI hat nicht teilgenommen. Nichts wird hinzugef${ch(0xfc)}gt, bevor Sie antworten.`,
        '',
        '1. [x] Bish: Task number 1 for the team',
        `2. [x] Cristina Reyes Sierra: Confirm the launch date - f${ch(0xe4)}llig Fr., 16. Okt.`,
        '   Aus dem Protokoll: "Cristina to confirm the launch date by Friday"',
        '3. [ ] Review the pricing page (aus Decisions)',
        `5. (hinzugef${ch(0xfc)}gt) Bish: Task number 5 for the team`,
        '',
        `Antworten Sie ALLE, um die 2 markierten hinzuzuf${ch(0xfc)}gen, Nummern, um nur diese hinzuzuf${ch(0xfc)}gen (zum Beispiel 1 2), ENTFERNEN und Nummern, um einige zu entfernen, oder KEINE.`,
        'Aufgaben ohne Datum erinnern Sie morgen um 9:00 Uhr. Bearbeiten Sie sie in der App.',
      ].join('\n'),
    );
    expect(rendered.buttons).toEqual({
      body: `Die 2 markierten Aufgaben hinzuf${ch(0xfc)}gen?`,
      items: [
        { id: `wa_sum_all:${IDS.offerId}`, title: `Hinzuf${ch(0xfc)}gen (2)` },
        { id: `wa_sum_none:${IDS.offerId}`, title: 'Keine' },
      ],
    });
  });

  it('every language: banners, the kept-summary header, the owner guess, overdue, the AI lines and the empty lines', () => {
    const guess = item(4, { title: 'Send the invoice', quote: 'Send the invoice (owner: Francisco)', owner: { name: 'Francisco', isUser: true, guess: true }, flags: ['owner_guess'] });
    const overdue = item(6, { title: 'Pay the vendor', owner: null, quote: 'Pay the vendor', due: { date: '2026-10-01', time: '15:00', zone: 'Europe/Berlin', quote: 'Oct 1', overdue: true }, preselected: false });
    const kept = { meetingId: null, meetingTitle: null, occurrenceDate: null, localDate: '2026-10-16', tier: 'vendor_verified' as const, senderDomain: null, forwardedBy: null };
    const expected: Record<'pt' | 'fr' | 'de', string[]> = {
      pt: [
        `Nada est${ch(0xe1)} marcado: este resumo foi encaminhado`,
        `S${ch(0xf3)} a primeira parte de um resumo longo foi lida.`,
        `As tarefas de um resumo do assistente de anota${ch(0xe7)}${ch(0xf5)}es (16 out), exatamente como est${ch(0xe3)}o escritas.`,
        `(voc${ch(0xea)}? o resumo diz: Francisco)`,
        ' - venceu qui, 1 out 15:00 (Europe/Berlin)',
        'Responda IA para o Meeting Guard AI ler todo o resumo',
        `As que n${ch(0xe3)}o t${ch(0xea)}m data ficam sem lembrete`,
      ],
      fr: [
        `Rien n'est coch${ch(0xe9)}: ce compte rendu a ${ch(0xe9)}t${ch(0xe9)} transf${ch(0xe9)}r${ch(0xe9)}`,
        `Seule la premi${ch(0xe8)}re partie d'un long compte rendu a ${ch(0xe9)}t${ch(0xe9)} lue.`,
        `Les t${ch(0xe2)}ches d'un compte rendu d'assistant de prise de notes (16 oct.), exactement telles qu'${ch(0xe9)}crites.`,
        '(vous? le compte rendu indique: Francisco)',
        ` - ${ch(0xe9)}ch${ch(0xe9)}ance pass${ch(0xe9)}e jeu. 1 oct. 15:00 (Europe/Berlin)`,
        `R${ch(0xe9)}pondez IA pour que Meeting Guard AI lise tout le compte rendu`,
        "Celles sans date n'ont pas de rappel",
      ],
      de: [
        'Nichts ist markiert: Dieses Protokoll wurde weitergeleitet',
        'Nur der erste Teil eines langen Protokolls wurde gelesen.',
        'Die Aufgaben aus dem Protokoll eines Notizassistenten (16. Okt.), genau wie geschrieben.',
        '(Sie? das Protokoll nennt: Francisco)',
        ` - war f${ch(0xe4)}llig Do., 1. Okt. 15:00 (Europe/Berlin)`,
        'Antworten Sie KI, damit Meeting Guard AI das ganze Protokoll liest',
        'Aufgaben ohne Datum erhalten keine Erinnerung',
      ],
    };
    for (const language of ['pt', 'fr', 'de'] as const) {
      const rendered = render(commitments([guess, overdue], { origin: kept, truncated: true, preselect: { allowed: false, selectAll: true, reason: 'forwarded' } }), { language, zone: false });
      for (const part of expected[language]) expect([language, rendered.text.includes(part) ? part : rendered.text]).toEqual([language, part]);
      expect(rendered.text).not.toMatch(BANNED);
      expect(rendered.buttons).toBeNull();
      const prepared = render(commitments([item(1, { status: 'accepted' })]), { language, ai: 'prepared' });
      expect(prepared.text.split('\n\n').at(-1)?.split('\n')).toHaveLength(2);
      const emptyAi = render(commitments([], { mode: 'ai' }), { language, ai: 'none' });
      expect(emptyAi.text.split('\n\n')[1]).toBe(
        { pt: `O Meeting Guard AI n${ch(0xe3)}o encontrou compromissos neste resumo.`, fr: `Meeting Guard AI n'a trouv${ch(0xe9)} aucun engagement dans ce compte rendu.`, de: 'Meeting Guard AI hat in diesem Protokoll keine Zusagen gefunden.' }[language],
      );
      expect(emptyAi.offer).toBeNull();
    }
  });

  it('stays under the WhatsApp limits in every language with 30 long items; buttons fit 20 characters', () => {
    const items = Array.from({ length: 30 }, (_, index) =>
      item(index + 1, { title: `T${index + 1} ${'long title words '.repeat(12)}`.slice(0, 200), quote: `Q${index + 1} ${'the whole item text '.repeat(50)}`.slice(0, 1000) }),
    );
    const more: Record<AppLanguage, (n: number) => string> = {
      en: (n) => `And ${n} more in the app.`,
      es: (n) => `Y ${n} m${ch(0xe1)}s en la app.`,
      pt: (n) => `E mais ${n} no app.`,
      fr: (n) => `Et ${n} de plus dans l'application.`,
      de: (n) => `Und ${n} weitere in der App.`,
    };
    for (const language of APP_LANGUAGES) {
      const rendered = render(commitments(items), { language, ai: 'offered', zone: false });
      expect([language, rendered.text.length <= MAX_TEXT_CHARS]).toEqual([language, true]);
      expect(rendered.counts.more).toBeGreaterThan(0);
      expect(rendered.text).toContain(more[language](rendered.counts.more));
      expect(rendered.offer?.anchors).toHaveLength(30 - rendered.counts.more);
      for (const line of rendered.text.split('\n')) expect(line.length).toBeLessThanOrEqual(400);
      expect(rendered.text).not.toMatch(BANNED);
      for (const count of [1, 12, 30]) {
        const marked = render(commitments(Array.from({ length: count }, (_, index) => item(index + 1))), { language });
        for (const button of marked.buttons?.items ?? []) expect([language, button.title, button.title.length <= MAX_BUTTON_TITLE_CHARS]).toEqual([language, button.title, true]);
        expect((marked.buttons?.body.length ?? 0) <= MAX_INTERACTIVE_BODY_CHARS).toBe(true);
      }
    }
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

  it('M12: names what was added and every other outcome in PT, FR and DE', () => {
    const request = {
      requested: [
        { n: 1, anchorId: anchor(1), decision: 'accept' as const },
        { n: 3, anchorId: anchor(3), decision: 'accept' as const },
        { n: 2, anchorId: anchor(2), decision: 'drop' as const },
      ],
      results: [
        { anchorId: anchor(1), outcome: 'added' as const, taskId: 'sm_' + 'c'.repeat(32) },
        { anchorId: anchor(3), outcome: 'added' as const, taskId: 'sm_' + 'd'.repeat(32) },
        { anchorId: anchor(2), outcome: 'dropped' as const, taskId: null },
      ],
      items,
      unknown: [9],
    };
    expect(renderResult({ language: 'pt', ...request }).text).toBe(
      [
        `2 tarefas adicionadas: Bish: Task number 1 for the team; Bish: Task number 3 for the team. Seu celular define os lembretes na pr${ch(0xf3)}xima vez que o Meeting Guard AI sincronizar; abra o app para ter certeza.`,
        `Removidas da lista: 2. Voc${ch(0xea)} pode restaur${ch(0xe1)}-las no app.`,
        `N${ch(0xe3)}o est${ch(0xe3)}o na lista: 9.`,
      ].join('\n'),
    );
    expect(renderResult({ language: 'fr', ...request }).text).toBe(
      [
        `2 t${ch(0xe2)}ches ajout${ch(0xe9)}es: Bish: Task number 1 for the team; Bish: Task number 3 for the team. Votre t${ch(0xe9)}l${ch(0xe9)}phone programme leurs rappels ${ch(0xe0)} la prochaine synchronisation de Meeting Guard AI; ouvrez l'application pour en ${ch(0xea)}tre s${ch(0xfb)}r.`,
        `Retir${ch(0xe9)}es de la liste: 2. Vous pouvez les restaurer dans l'application.`,
        'Pas dans la liste: 9.',
      ].join('\n'),
    );
    expect(renderResult({ language: 'de', ...request }).text).toBe(
      [
        `2 Aufgaben hinzugef${ch(0xfc)}gt: Bish: Task number 1 for the team; Bish: Task number 3 for the team. Ihr Telefon stellt die Erinnerungen bei der n${ch(0xe4)}chsten Synchronisierung von Meeting Guard AI ein; ${ch(0xf6)}ffnen Sie die App, um sicherzugehen.`,
        `Aus der Liste entfernt: 2. Sie k${ch(0xf6)}nnen sie in der App wiederherstellen.`,
        'Nicht in der Liste: 9.',
      ].join('\n'),
    );
    const single = { ...request, requested: request.requested.slice(0, 1), results: request.results.slice(0, 1), unknown: [] };
    expect(renderResult({ language: 'de', ...single }).text.startsWith(`1 Aufgabe hinzugef${ch(0xfc)}gt: Bish: Task number 1 for the team. Ihr Telefon stellt die Erinnerung `)).toBe(true);
    // Nothing to change, and an unknown language reads English.
    expect(renderResult({ language: 'fr', requested: [], results: [], items, unknown: [] }).text).toBe(`Rien ${ch(0xe0)} modifier.`);
    expect(renderResult({ language: 'it' as AppLanguage, requested: [], results: [], items, unknown: [] }).text).toBe('Nothing to change.');
  });

  it('every fixed text, in every app language, is free of typographic characters and no-break spaces', () => {
    const all: string[] = [];
    for (const language of APP_LANGUAGES) {
      all.push(...Object.values(workerTexts(language)), ...Object.values(SUMMARY_BOT_STRINGS[language]));
      all.push(quotaText(language, null));
      for (const period of ['day', 'window', 'month'] as const) {
        all.push(quotaText(language, { used: 3, limit: 3, plan: 'free', resetsAt: '2026-11-18T00:00:00.000Z', period }));
      }
    }
    expect(all.length).toBeGreaterThan(75);
    const noBreak = new RegExp(`[${ch(0xa0)}${ch(0x202f)}${ch(0x201e)}${ch(0x201a)}]`);
    for (const text of all) {
      expect(text).not.toMatch(BANNED);
      expect(text).not.toMatch(noBreak);
    }
    // Every language has the same worker texts.
    for (const language of APP_LANGUAGES) expect(Object.keys(workerTexts(language)).sort()).toEqual(Object.keys(workerTexts('en')).sort());
    expect(quotaText('en', { used: 100, limit: 100, plan: 'pro', resetsAt: '2026-11-18T00:00:00.000Z', period: 'month' })).toBe(
      'You used the 100 AI actions of this month. They renew on Nov 18. The action items as written stay free. You can still reply with numbers from the list above.',
    );
    // M12: the renewal date day-first, and a French or German abbreviation ends the sentence once.
    const month = { used: 100, limit: 100, plan: 'pro' as const, resetsAt: '2026-11-18T00:00:00.000Z', period: 'month' as const };
    expect(quotaText('pt', month)).toBe(
      `Voc${ch(0xea)} usou as 100 a${ch(0xe7)}${ch(0xf5)}es de IA deste m${ch(0xea)}s. Elas se renovam em 18 nov. As tarefas como est${ch(0xe3)}o escritas continuam gr${ch(0xe1)}tis. Voc${ch(0xea)} ainda pode responder com n${ch(0xfa)}meros da lista acima.`,
    );
    expect(quotaText('fr', month)).toContain('Elles se renouvellent le 18 nov. Les t');
    expect(quotaText('de', month)).toContain('Sie erneuern sich am 18. Nov. Die Aufgaben');
    expect(quotaText('de', { ...month, resetsAt: '2026-06-18T00:00:00.000Z' })).toContain('Sie erneuern sich am 18. Juni. Die Aufgaben');
    for (const language of APP_LANGUAGES) expect(quotaText(language, month)).not.toMatch(/\.\./);
  });
});
