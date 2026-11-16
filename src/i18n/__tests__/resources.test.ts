import { I18N_EN_ES_ONLY_NAMESPACES, I18N_NAMESPACE_LIST, type I18nNamespace } from '../../core/contracts';
import { APP_ERROR_CODES } from '../../core/errors';
import { APP_LANGUAGES, type AppLanguage } from '../../core/types';
import { RESOURCES } from '../resources';

type Tree = { readonly [key: string]: unknown };

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{\{\s*([^}\s,]+)[^}]*\}\}/g;

/** Every language other than English, checked against English. */
const TRANSLATED_LANGUAGES = APP_LANGUAGES.filter((language) => language !== 'en');
/** M12: the languages that leave out the en/es-only namespaces (they fall back to English). */
const LANGUAGES_WITHOUT_EN_ES_ONLY = APP_LANGUAGES.filter((language) => language !== 'en' && language !== 'es');
const EN_ES_ONLY: readonly I18nNamespace[] = I18N_EN_ES_ONLY_NAMESPACES;

/** The namespace tree of a language, or undefined when that language does not carry it. */
function treeOf(language: AppLanguage, namespace: I18nNamespace): Tree | undefined {
  return (RESOURCES[language] as Partial<Record<I18nNamespace, Tree>>)[namespace];
}

/** The namespaces a language must carry: all of them for en and es, all but the en/es-only ones otherwise. */
function namespacesOf(language: AppLanguage): readonly I18nNamespace[] {
  if (language === 'en' || language === 'es') return I18N_NAMESPACE_LIST;
  return I18N_NAMESPACE_LIST.filter((namespace) => !EN_ES_ONLY.includes(namespace));
}

/** [language, namespace] pairs every translated language must match English on. */
const TRANSLATED_PAIRS: [AppLanguage, I18nNamespace][] = TRANSLATED_LANGUAGES.flatMap((language) =>
  namespacesOf(language).map((namespace): [AppLanguage, I18nNamespace] => [language, namespace]),
);
const ALL_PAIRS: [AppLanguage, I18nNamespace][] = APP_LANGUAGES.flatMap((language) =>
  namespacesOf(language).map((namespace): [AppLanguage, I18nNamespace] => [language, namespace]),
);

/** Flattened leaf keys ("a.b.c"); arrays are leaves; plural suffixes are folded into the base key. */
function leafKeys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return leafKeys(value as Tree, path);
    }
    return [path.replace(PLURAL_SUFFIX, '')];
  });
}

function unique(keys: string[]): string[] {
  return [...new Set(keys)].sort();
}

function emptyLeaves(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') return value.trim() === '' ? [path] : [];
    if (Array.isArray(value)) return value.length === 0 ? [path] : [];
    if (value !== null && typeof value === 'object') return emptyLeaves(value as Tree, path);
    return [path];
  });
}

/**
 * The {{placeholders}} used under each folded key (plural forms merged, array items merged), so
 * a translation can drop {{count}} from a singular form without failing.
 */
function placeholdersByKey(tree: Tree, prefix = '', out = new Map<string, Set<string>>()): Map<string, Set<string>> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      placeholdersByKey(value as Tree, path, out);
      continue;
    }
    const folded = path.replace(PLURAL_SUFFIX, '');
    const names = out.get(folded) ?? new Set<string>();
    const texts = Array.isArray(value) ? value : [value];
    for (const text of texts) {
      if (typeof text !== 'string') continue;
      for (const match of text.matchAll(PLACEHOLDER)) names.add(match[1] ?? '');
    }
    out.set(folded, names);
  }
  return out;
}

describe('bundled translation resources', () => {
  it.each(TRANSLATED_PAIRS)('%s: namespace "%s" has the same keys as English', (language, namespace) => {
    const en = unique(leafKeys(RESOURCES.en[namespace]));
    const tree = treeOf(language, namespace);
    expect(tree).toBeDefined();
    const other = unique(leafKeys(tree ?? {}));
    expect({ missingInTranslation: en.filter((key) => !other.includes(key)), missingInEnglish: other.filter((key) => !en.includes(key)) }).toEqual({
      missingInTranslation: [],
      missingInEnglish: [],
    });
  });

  it.each(LANGUAGES_WITHOUT_EN_ES_ONLY)('%s leaves out the en/es-only namespaces (they fall back to English)', (language) => {
    expect(EN_ES_ONLY.filter((namespace) => treeOf(language, namespace) !== undefined)).toEqual([]);
  });

  it.each(ALL_PAIRS)('%s: namespace "%s" has no empty or non-string values', (language, namespace) => {
    expect(emptyLeaves(treeOf(language, namespace) ?? {})).toEqual([]);
  });

  it.each(TRANSLATED_PAIRS)('%s: namespace "%s" keeps every English {{placeholder}}', (language, namespace) => {
    const en = placeholdersByKey(RESOURCES.en[namespace]);
    const other = placeholdersByKey(treeOf(language, namespace) ?? {});
    const missing = [...en.entries()].flatMap(([key, names]) =>
      [...names].filter((name) => !(other.get(key)?.has(name) ?? false)).map((name) => `${key}: {{${name}}}`),
    );
    const unknown = [...other.entries()].flatMap(([key, names]) =>
      [...names].filter((name) => !(en.get(key)?.has(name) ?? false)).map((name) => `${key}: {{${name}}}`),
    );
    expect({ missing, unknown }).toEqual({ missing: [], unknown: [] });
  });

  it.each(APP_LANGUAGES)('common.json (%s) has a message for every AppError code', (language) => {
    const errors = (RESOURCES[language].common as { errors?: Record<string, unknown> }).errors ?? {};
    expect(APP_ERROR_CODES.filter((code) => typeof errors[code] !== 'string')).toEqual([]);
  });

  it.each(APP_LANGUAGES)('common.json (%s) names every app language by its own name', (language) => {
    const names = (RESOURCES[language].common as { language?: Record<string, unknown> }).language ?? {};
    expect(APP_LANGUAGES.map((code) => names[code])).toEqual(['English', 'Español', 'Português', 'Français', 'Deutsch']);
  });
});
