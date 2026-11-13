// Fails when a functions/src/shared copy is not a verbatim copy of its app original in src/core.
// Pairs: aiContract, errors, time, recurrence (docs/v2/M10-DESIGN.md section 4). Line endings are
// normalized (CRLF to LF) so a Windows checkout with autocrlf does not produce a false positive.
// Usage (from functions/): npm run check:contract        Fix: copy the app file over the functions copy.
// functions/test/unit/contract.test.ts runs the same check inside Jest.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Keep in sync with PAIRS in functions/test/unit/contract.test.ts. */
const PAIRS = ['aiContract', 'errors', 'time', 'recurrence'];

const functionsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = join(functionsDir, '..');

const normalize = (text) => text.replace(/\r\n/g, '\n');
const preview = (text) => JSON.stringify(text === undefined ? '<end of file>' : text.length > 120 ? `${text.slice(0, 120)}...` : text);

function read(path) {
  try {
    return normalize(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** 1-based number of the first line that differs, or 0 when the texts are identical. */
function firstDifferentLine(app, copy) {
  if (app === copy) return 0;
  const appLines = app.split('\n');
  const copyLines = copy.split('\n');
  const length = Math.max(appLines.length, copyLines.length);
  for (let index = 0; index < length; index += 1) {
    if (appLines[index] !== copyLines[index]) return index + 1;
  }
  return length;
}

const failures = [];
for (const name of PAIRS) {
  const appRel = `src/core/${name}.ts`;
  const copyRel = `functions/src/shared/${name}.ts`;
  const app = read(join(repoDir, 'src', 'core', `${name}.ts`));
  const copy = read(join(functionsDir, 'src', 'shared', `${name}.ts`));
  if (app === null || copy === null) {
    failures.push(`[${name}] ${app === null ? appRel : copyRel} is missing.`);
    continue;
  }
  const line = firstDifferentLine(app, copy);
  if (line !== 0) {
    failures.push(
      `[${name}] ${copyRel} differs from ${appRel}, first at line ${line}:\n` +
        `    app:  ${preview(app.split('\n')[line - 1])}\n` +
        `    copy: ${preview(copy.split('\n')[line - 1])}`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `Shared copy drift in ${failures.length} of ${PAIRS.length} pairs:\n${failures.join('\n')}\n` +
      'Copy each src/core file over its functions/src/shared copy verbatim.',
  );
  process.exit(1);
}
process.stdout.write(`Shared copies: all ${PAIRS.length} pairs match src/core (${PAIRS.join(', ')})\n`);
