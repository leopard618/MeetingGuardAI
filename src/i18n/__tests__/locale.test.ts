import { APP_LANGUAGES } from '../../core/types';
import { weekStartsOn } from '../../screens/calendar/calendarModel';
import { weekStartForLanguage } from '../../screens/insights/meetingInsights';
import { DATE_FNS_LOCALES, DEFAULT_24_HOUR, LOCALE_TAGS, speechLocale, weekStartsOnFor } from '../locale';

describe('per-language locale data (M12)', () => {
  it('has a BCP-47 tag per app language (Portuguese is Brazilian)', () => {
    expect(LOCALE_TAGS).toEqual({ en: 'en-US', es: 'es-ES', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE' });
    expect(APP_LANGUAGES.map((language) => speechLocale(language))).toEqual(['en-US', 'es-ES', 'pt-BR', 'fr-FR', 'de-DE']);
  });

  it('has a date-fns locale per app language', () => {
    expect(APP_LANGUAGES.map((language) => DATE_FNS_LOCALES[language].code)).toEqual(['en-US', 'es', 'pt-BR', 'fr', 'de']);
  });

  it('keeps the en/es week start and the 24-hour defaults', () => {
    expect(APP_LANGUAGES.map((language) => weekStartsOnFor(language))).toEqual([0, 1, 0, 1, 1]);
    expect(APP_LANGUAGES.map((language) => DEFAULT_24_HOUR[language])).toEqual([false, true, true, true, true]);
  });

  it.each(APP_LANGUAGES)('the calendar and the insights agree on the week start (%s)', (language) => {
    expect(weekStartForLanguage(language)).toBe(weekStartsOn(language));
  });

  it('starts unknown languages on Sunday in the insights', () => {
    expect(weekStartForLanguage('it')).toBe(0);
  });
});
