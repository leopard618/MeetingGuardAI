/**
 * Product-text rule: no em dash, en dash, ellipsis or curly quotes anywhere in app source or
 * locale strings (user requirement, 2026-10-01). Use "-", "..." and straight quotes instead.
 * The assistant prompt (functions/src/assistant/prompt.ts) carries the same rule for AI output,
 * and the admin web app (public/admin) is swept separately.
 */
import * as fs from 'fs';
import * as path from 'path';

const BANNED = /[—–…‘’“”]/;
const SRC_ROOT = path.resolve(__dirname, '..', '..');

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
