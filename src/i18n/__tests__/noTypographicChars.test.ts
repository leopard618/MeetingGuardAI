/**
 * Product-text rule: no em dash, en dash, ellipsis or curly quotes anywhere in app source or
 * locale strings (user requirement, 2026-10-01). Use "-", "..." and straight quotes instead.
 * The assistant prompt (functions/src/assistant/prompt.ts) carries the same rule for AI output,
 * and the admin web app (public/admin) is swept separately.
 */
import * as fs from 'fs';
import * as path from 'path';

// Built from code points so this file itself contains none of the banned characters.
const BANNED_CODES = [0x2014, 0x2013, 0x2026, 0x2018, 0x2019, 0x201c, 0x201d];
const BANNED = new RegExp(`[${BANNED_CODES.map((c) => String.fromCodePoint(c)).join('')}]`);
const SRC_ROOT = path.resolve(__dirname, '..', '..');

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
  for (const extra of ['public/admin', 'functions/src']) {
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
