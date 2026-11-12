/**
 * App-wide translation key check (all namespaces, both languages).
 *
 * Scans every non-test source file for namespace-qualified key literals ('home:greeting',
 * `insights:tabs.${tab}`) and fails when:
 * - a static key is missing in English or Spanish (plural families `_one` / `_other` count);
 * - the static part of a dynamic key (`ns:a.b.${x}`) is not an object in both languages;
 * - `t()` is called with an unqualified key (no namespace).
 * Key parity between EN and ES (keys present in one language only) is checked per namespace in
 * resources.test.ts.
 */
import fs from 'fs';
import path from 'path';

import { I18N_NAMESPACE_LIST, type I18nNamespace } from '../../core/contracts';
import type { AppEventName } from '../../core/events';
import type { Language } from '../../core/types';
import { RESOURCES } from '../resources';

const REPO = path.join(__dirname, '..', '..', '..');
const SRC = path.join(REPO, 'src');

/** Event names look like namespaced keys ('meetings:changed'); they are not translations. */
const EVENT_NAMES = {
  'meetings:changed': true,
  'tasks:changed': true,
  'preferences:changed': true,
  'session:started': true,
  'session:ended': true,
  'alerts:fired': true,
  'calendar:synced': true,
  'language:changed': true,
} satisfies Record<AppEventName, true>;

const LANGUAGES: readonly Language[] = ['en', 'es'];
const NAMESPACES: ReadonlySet<string> = new Set(I18N_NAMESPACE_LIST);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['__tests__', '__fixtures__', 'locales'].includes(entry.name) ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Drops comments (doc examples such as t('alerts:max.title') are not real keys). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/\s.*$/gm, '');
}

function lookup(tree: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree);
}

function isLeaf(value: unknown): boolean {
  return typeof value === 'string' || (Array.isArray(value) && value.length > 0);
}

function defined(language: Language, namespace: I18nNamespace, key: string): boolean {
  const tree = RESOURCES[language][namespace];
  if (isLeaf(lookup(tree, key))) return true;
  // Plural family, or an object read whole with returnObjects (legal sections).
  return (isLeaf(lookup(tree, `${key}_one`)) && isLeaf(lookup(tree, `${key}_other`))) || isObject(lookup(tree, key));
}

function isObject(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface KeyUse {
  file: string;
  namespace: I18nNamespace;
  key: string;
  dynamic: boolean;
}

function keyUses(): { uses: KeyUse[]; unqualified: string[] } {
  const uses: KeyUse[] = [];
  const unqualified: string[] = [];
  const files = [...sourceFiles(SRC), path.join(REPO, 'App.js')];
  for (const file of files) {
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    const relative = path.relative(REPO, file).replace(/\\/g, '/');
    const literals = [
      ...source.matchAll(/'([a-zA-Z]+):([^'\n]*)'/g),
      ...source.matchAll(/"([a-zA-Z]+):([^"\n]*)"/g),
      ...source.matchAll(/`([a-zA-Z]+):([^`]*)`/g),
    ];
    for (const match of literals) {
      const namespace = match[1] ?? '';
      const rest = match[2] ?? '';
      if (!NAMESPACES.has(namespace) || `${namespace}:${rest}` in EVENT_NAMES) continue;
      if (rest.includes('${') || rest.endsWith('.')) {
        const prefix = (rest.split('${')[0] ?? '').replace(/\.$/, '');
        if (prefix !== '') uses.push({ file: relative, namespace: namespace as I18nNamespace, key: prefix, dynamic: true });
        continue;
      }
      if (/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(rest)) {
        uses.push({ file: relative, namespace: namespace as I18nNamespace, key: rest, dynamic: false });
      }
    }
    for (const match of source.matchAll(/\bt\(\s*(['"`])([^'"`]*)\1/g)) {
      const key = match[2] ?? '';
      if (!/^[a-zA-Z]+:/.test(key)) unqualified.push(`${relative}: t('${key}')`);
    }
  }
  return { uses, unqualified };
}

describe('translation keys used by the app', () => {
  const { uses, unqualified } = keyUses();

  it('finds the keys (the scan works)', () => {
    expect(uses.length).toBeGreaterThan(500);
    const namespacesUsed = new Set(uses.map((use) => use.namespace));
    expect(I18N_NAMESPACE_LIST.filter((namespace) => !namespacesUsed.has(namespace))).toEqual([]);
  });

  it.each(LANGUAGES)('defines every static key in "%s"', (language) => {
    const missing = uses
      .filter((use) => !use.dynamic && !defined(language, use.namespace, use.key))
      .map((use) => `${use.file}: ${use.namespace}:${use.key}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it.each(LANGUAGES)('defines the object behind every dynamic key in "%s"', (language) => {
    const missing = uses
      .filter((use) => use.dynamic && !isObject(lookup(RESOURCES[language][use.namespace], use.key)))
      .map((use) => `${use.file}: ${use.namespace}:${use.key}.*`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('never calls t() with a key without a namespace', () => {
    expect(unqualified).toEqual([]);
  });
});
