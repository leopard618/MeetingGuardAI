/**
 * Bot strings (functions/src/whatsapp/messages.ts): EN/ES snapshots, the plain-punctuation
 * product rule, and the WhatsApp interactive-message limits.
 */
import { MAX_BUTTON_TITLE_CHARS, MAX_INTERACTIVE_BODY_CHARS } from '../../src/whatsapp/send';
import { APP_LANGUAGES } from '../../src/shared/aiContract';
import { BOT_STRINGS, SUMMARY_BOT_STRINGS, bilingual, botStrings, formatConfirmPrompt, formatMeetingSummary, summaryBotStrings } from '../../src/whatsapp/messages';
import { isSummaryTrigger } from '../../src/whatsapp/summaryRoute';

// Built from code points so this file itself contains none of the banned characters
// (same list as src/i18n/__tests__/noTypographicChars.test.ts).
const BANNED_CODES = [0x2014, 0x2013, 0x2026, 0x2018, 0x2019, 0x201c, 0x201d];
const BANNED = new RegExp(`[${BANNED_CODES.map((code) => String.fromCodePoint(code)).join('')}]`);

function flatten(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) flatten(child, out);
  }
}

describe('bot strings', () => {
  it('cover EN and ES with identical key sets (and every other app language, below)', () => {
    expect(Object.keys(BOT_STRINGS.es).sort()).toEqual(Object.keys(BOT_STRINGS.en).sort());
  });

  it('contain no typographic characters (product rule: plain punctuation only)', () => {
    const all: string[] = [];
    flatten(BOT_STRINGS, all);
    expect(all.length).toBeGreaterThan(20);
    for (const text of all) {
      expect(text).not.toMatch(BANNED);
    }
  });

  it('EN snapshot', () => {
    expect(BOT_STRINGS.en).toMatchSnapshot();
  });

  it('ES snapshot', () => {
    expect(BOT_STRINGS.es).toMatchSnapshot();
  });

  it('button titles fit the WhatsApp 20-char limit in every app language', () => {
    for (const language of APP_LANGUAGES) {
      expect(botStrings(language).buttons.confirm.length).toBeLessThanOrEqual(MAX_BUTTON_TITLE_CHARS);
      expect(botStrings(language).buttons.cancel.length).toBeLessThanOrEqual(MAX_BUTTON_TITLE_CHARS);
    }
  });

  it('bilingual joins EN and ES', () => {
    const text = bilingual('linkPrompt');
    expect(text).toContain(BOT_STRINGS.en.linkPrompt);
    expect(text).toContain(BOT_STRINGS.es.linkPrompt);
  });
});

describe('suggested-tasks strings (M11; M12 adds PT, FR and DE)', () => {
  // M12 also bans the German low quotes and the no-break spaces French spacing would bring.
  const M12_BANNED = new RegExp(`[${[...BANNED_CODES, 0x201e, 0x201a, 0xa0, 0x202f].map((code) => String.fromCodePoint(code)).join('')}]`);

  it('cover every app language with identical key sets, the bot texts too', () => {
    expect(Object.keys(SUMMARY_BOT_STRINGS).sort()).toEqual([...APP_LANGUAGES].sort());
    for (const language of APP_LANGUAGES) expect(Object.keys(SUMMARY_BOT_STRINGS[language]).sort()).toEqual(Object.keys(SUMMARY_BOT_STRINGS.en).sort());
    expect(Object.keys(BOT_STRINGS).sort()).toEqual([...APP_LANGUAGES].sort());
    for (const language of APP_LANGUAGES) expect(Object.keys(BOT_STRINGS[language]).sort()).toEqual(Object.keys(BOT_STRINGS.en).sort());
  });

  it('PT, FR and DE bot texts: no typographic characters, no space before ? ! ; :, the app\'s Settings name', () => {
    const settings = { pt: 'Configura\u00e7\u00f5es > WhatsApp', fr: 'Param\u00e8tres > WhatsApp', de: 'Einstellungen > WhatsApp' } as const;
    for (const language of ['pt', 'fr', 'de'] as const) {
      const all: string[] = [];
      flatten(BOT_STRINGS[language], all);
      for (const text of all) {
        expect(text).not.toMatch(M12_BANNED);
        expect([language, text, / [:;?!]/.test(text)]).toEqual([language, text, false]);
      }
      expect(BOT_STRINGS[language].linkPrompt).toContain(settings[language]);
      expect(botStrings(language)).toBe(BOT_STRINGS[language]);
    }
    expect(botStrings('it')).toBe(BOT_STRINGS.en);
    expect(botStrings('toString')).toBe(BOT_STRINGS.en);
  });

  it('contain no typographic characters or no-break spaces, and fit one interactive body', () => {
    const all: string[] = [];
    flatten(SUMMARY_BOT_STRINGS, all);
    expect(all.length).toBe(APP_LANGUAGES.length * 6);
    for (const text of all) {
      expect(text).not.toMatch(M12_BANNED);
      expect(text.length).toBeLessThanOrEqual(MAX_INTERACTIVE_BODY_CHARS);
      expect(text).not.toMatch(/ [:;?!]/);
    }
  });

  it('name the trigger word of their own language, and that word asks for the list', () => {
    const trigger: Record<string, string> = { en: 'commitments', es: 'compromisos', pt: 'compromissos', fr: 'engagements', de: 'Zusagen' };
    for (const language of APP_LANGUAGES) {
      const word = trigger[language] ?? '';
      expect(isSummaryTrigger(word)).toBe(true);
      for (const key of ['stillPreparing', 'replyTimeout', 'expired'] as const) {
        expect([language, key, SUMMARY_BOT_STRINGS[language][key].includes(word)]).toEqual([language, key, true]);
      }
    }
  });

  it('PT, FR and DE texts (pt-BR "voce", French "vous", German "Sie")', () => {
    const ch = (code: number): string => String.fromCodePoint(code);
    expect(SUMMARY_BOT_STRINGS.pt.nothingMarked).toBe(`Nada est${ch(0xe1)} marcado. Responda com os n${ch(0xfa)}meros que voc${ch(0xea)} quer.`);
    expect(SUMMARY_BOT_STRINGS.fr.closed).toBe(`Ferm${ch(0xe9)}. Rien n'a ${ch(0xe9)}t${ch(0xe9)} modifi${ch(0xe9)}.`);
    expect(SUMMARY_BOT_STRINGS.de.expired).toBe('Diese Liste ist abgelaufen. Schreiben Sie Zusagen f\u00fcr eine neue Liste.');
  });

  it('read English for an unknown language', () => {
    expect(summaryBotStrings('it')).toBe(SUMMARY_BOT_STRINGS.en);
    expect(summaryBotStrings('toString')).toBe(SUMMARY_BOT_STRINGS.en);
    expect(summaryBotStrings('de')).toBe(SUMMARY_BOT_STRINGS.de);
  });
});

describe('formatting', () => {
  const meeting = {
    title: 'Design review',
    date: '2026-10-06',
    time: '14:30',
    timezone: 'Europe/Madrid',
    durationMinutes: 45,
    place: 'https://zoom.us/j/123',
  };

  it('formats a forwardable meeting summary (EN and ES)', () => {
    const en = formatMeetingSummary('en', meeting);
    expect(en).toContain('*Design review*');
    expect(en).toContain('When: 2026-10-06 14:30 (Europe/Madrid)');
    expect(en).toContain('Duration: 45 min');
    expect(en).toContain('Where: https://zoom.us/j/123');
    const es = formatMeetingSummary('es', meeting);
    expect(es).toContain('Cuándo: 2026-10-06 14:30 (Europe/Madrid)');
  });

  it('marks all-day meetings and omits a missing place', () => {
    const text = formatMeetingSummary('en', { ...meeting, time: null, place: null });
    expect(text).toContain('2026-10-06 (all day)');
    expect(text).not.toContain('Where:');
  });

  it('builds a confirm prompt that fits the interactive body limit for max-size summaries', () => {
    const summaries = ['Create "Team sync" tomorrow at 9:00', 'Delete "Old standup"'];
    const prompt = formatConfirmPrompt('en', summaries);
    expect(prompt).toContain('- Create "Team sync" tomorrow at 9:00');
    expect(prompt).toContain(BOT_STRINGS.en.confirmPrompt);
    expect(formatConfirmPrompt('es', ['x'.repeat(90)]).length).toBeLessThanOrEqual(MAX_INTERACTIVE_BODY_CHARS);
  });

  it('the 1/2 instruction ALWAYS survives: bullets are capped and collapsed, never the tail', () => {
    // Worst case the contract allows: maxActions x maxSummaryChars (10 x 500).
    const summaries = Array.from({ length: 10 }, (_, index) => `${index} ${'y'.repeat(499)}`);
    for (const language of APP_LANGUAGES) {
      const prompt = formatConfirmPrompt(language, summaries);
      expect(prompt.length).toBeLessThanOrEqual(MAX_INTERACTIVE_BODY_CHARS); // sendButtons never truncates it
      expect(prompt.endsWith(BOT_STRINGS[language].confirmPrompt)).toBe(true);
      // Per-summary cap: three plain dots, no 500-char bullet.
      expect(prompt).toContain('...');
      // Omitted bullets collapse into the "and N more" line instead of vanishing silently.
      expect(prompt).toContain(BOT_STRINGS[language].confirmMore.replace('{count}', '4'));
    }
  });
});
