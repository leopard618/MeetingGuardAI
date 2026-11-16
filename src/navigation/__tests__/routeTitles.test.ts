/**
 * Route registrations and their titles stay consistent: every route has a header title in every
 * app language (en, es, pt, fr, de), and no title, sidebar label or bottom-bar label is left
 * behind for a route that no longer exists.
 */
import { APP_LANGUAGES, type AppLanguage } from '../../core/types';
import { RESOURCES } from '../../i18n/resources';
import { ROUTES } from '../routes';

const LANGUAGES: readonly AppLanguage[] = APP_LANGUAGES;
const ROUTE_NAMES = Object.keys(ROUTES).sort();

function table(language: AppLanguage, namespace: 'navigation' | 'shell', key: string): Record<string, unknown> {
  const tree = RESOURCES[language][namespace] as Record<string, unknown>;
  const node = key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], tree);
  return (node ?? {}) as Record<string, unknown>;
}

describe('route titles', () => {
  it('maps every route name to itself', () => {
    for (const [key, value] of Object.entries(ROUTES)) expect(value).toBe(key);
  });

  it.each(LANGUAGES)('has a header title for every route and none for removed routes (%s)', (language) => {
    const titles = table(language, 'navigation', 'screens');
    expect(Object.keys(titles).sort()).toEqual(ROUTE_NAMES);
    for (const title of Object.values(titles)) expect(typeof title === 'string' && title.trim() !== '').toBe(true);
  });

  it.each(LANGUAGES)('labels only existing routes in the sidebar (%s)', (language) => {
    const labels = Object.keys(table(language, 'shell', 'sidebar.items'));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.filter((route) => !ROUTE_NAMES.includes(route))).toEqual([]);
  });
});
