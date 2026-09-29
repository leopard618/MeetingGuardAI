import { I18N_NAMESPACE_LIST } from '../../core/contracts';
import { APP_ERROR_CODES } from '../../core/errors';
import { RESOURCES } from '../resources';

type Tree = { readonly [key: string]: unknown };

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

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

describe('bundled translation resources', () => {
  it.each(I18N_NAMESPACE_LIST)('namespace "%s" has the same keys in English and Spanish', (namespace) => {
    const en = unique(leafKeys(RESOURCES.en[namespace]));
    const es = unique(leafKeys(RESOURCES.es[namespace]));
    expect({ missingInSpanish: en.filter((key) => !es.includes(key)), missingInEnglish: es.filter((key) => !en.includes(key)) }).toEqual({
      missingInSpanish: [],
      missingInEnglish: [],
    });
  });

  it.each(I18N_NAMESPACE_LIST)('namespace "%s" has no empty or non-string values', (namespace) => {
    expect(emptyLeaves(RESOURCES.en[namespace])).toEqual([]);
    expect(emptyLeaves(RESOURCES.es[namespace])).toEqual([]);
  });

  it.each(['en', 'es'] as const)('common.json (%s) has a message for every AppError code', (language) => {
    const errors = (RESOURCES[language].common as { errors?: Record<string, unknown> }).errors ?? {};
    expect(APP_ERROR_CODES.filter((code) => typeof errors[code] !== 'string')).toEqual([]);
  });
});
