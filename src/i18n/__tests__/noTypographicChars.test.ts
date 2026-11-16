/**
 * Product-text rule: no em dash, en dash, ellipsis or curly quotes anywhere in app source or
 * locale strings (user requirement, 2026-10-01). Use "-", "..." and straight quotes instead.
 * M12: German low quotes (U+201E, U+201A) are banned too, and the locale files of every language
 * also ban non-breaking spaces (U+00A0, U+202F: French spacing before ; : ! ?). Guillemets stay
 * allowed (Spanish already uses them).
 * The assistant prompt (functions/src/assistant/prompt.ts) carries the same rule for AI output,
 * and the admin web app (public/admin) is swept separately.
 */
import * as fs from 'fs';
import * as path from 'path';

// Built from code points so this file itself contains none of the banned characters.
const BANNED_CODES = [0x2014, 0x2013, 0x2026, 0x2018, 0x2019, 0x201c, 0x201d, 0x201e, 0x201a];
const BANNED = new RegExp(`[${BANNED_CODES.map((c) => String.fromCodePoint(c)).join('')}]`);
/** Locale strings only: no non-breaking spaces (translators type plain spaces). */
const LOCALE_BANNED_CODES = [...BANNED_CODES, 0x00a0, 0x202f];
const LOCALE_BANNED = new RegExp(`[${LOCALE_BANNED_CODES.map((c) => String.fromCodePoint(c)).join('')}]`);
const SRC_ROOT = path.resolve(__dirname, '..', '..');
const LOCALES_ROOT = path.resolve(__dirname, '..', 'locales');

function collectAny(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'lib') collectAny(p, out);
    } else if (/.(json|ts|tsx|js|html|css)$/.test(entry.name)) {
      out.push(p);
    }
  }
}

function collect(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') collect(p, out);
    } else if (/\.(json|ts|tsx)$/.test(entry.name)) {
      out.push(p);
    }
  }
}

test('no typographic AI characters in src files or locale strings', () => {
  const files: string[] = [];
  collect(SRC_ROOT, files);
  const REPO_ROOT = path.resolve(SRC_ROOT, '..');
  for (const extra of ['public', 'functions/src']) {
    const dir = path.join(REPO_ROOT, extra);
    if (fs.existsSync(dir)) collectAny(dir, files);
  }
  expect(files.length).toBeGreaterThan(100);
  const offenders: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const match = BANNED.exec(text);
    if (match) {
      const line = text.slice(0, match.index).split('\n').length;
      offenders.push(`${path.relative(SRC_ROOT, file)}:${line} (U+${match[0].codePointAt(0)!.toString(16).toUpperCase()})`);
    }
  }
  expect(offenders).toEqual([]);
});

test('no typographic characters or non-breaking spaces in any locale file (every language)', () => {
  const files: string[] = [];
  collect(LOCALES_ROOT, files);
  expect(files.length).toBeGreaterThan(100);
  const offenders: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const match = LOCALE_BANNED.exec(text);
    if (match) {
      const line = text.slice(0, match.index).split('\n').length;
      offenders.push(`${path.relative(SRC_ROOT, file)}:${line} (U+${match[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`);
    }
  }
  expect(offenders).toEqual([]);
});
