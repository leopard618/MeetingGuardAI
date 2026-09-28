import fs from 'fs';
import path from 'path';

import { translations } from '../translations';

// Every static t('a.b.c') key used in the app must exist in English and Spanish; a missing key
// renders the raw key (e.g. "common.close") on screen.
const SRC_DIR = path.join(__dirname, '..', '..');
const KEY_PATTERN = /\bt\(\s*['"`]([A-Za-z0-9_.]+)['"`]\s*[,)]/g;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(fullPath);
    }
    return /\.(js|jsx|ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function usedKeys() {
  const keys = new Set();
  sourceFiles(SRC_DIR).forEach((file) => {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(KEY_PATTERN)) keys.add(match[1]);
  });
  return [...keys].sort();
}

function lookup(table, key) {
  return key.split('.').reduce((value, part) => (value == null ? undefined : value[part]), table);
}

describe('translations', () => {
  const keys = usedKeys();

  it('finds the keys used by the app', () => {
    expect(keys.length).toBeGreaterThan(100);
  });

  it.each(['en', 'es'])('defines every used key in "%s"', (language) => {
    const missing = keys.filter((key) => lookup(translations[language], key) === undefined);
    expect(missing).toEqual([]);
  });
});
