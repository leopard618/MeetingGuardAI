// Fails when functions/src/shared/aiContract.ts is not a verbatim copy of src/core/aiContract.ts.
// Usage (from functions/): npm run check:contract        Fix: copy the app file over the functions copy.
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const functionsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const appContract = join(functionsDir, '..', 'src', 'core', 'aiContract.ts');
const functionsContract = join(functionsDir, 'src', 'shared', 'aiContract.ts');

const normalize = (text) => text.replace(/\r\n/g, '\n');
const app = normalize(readFileSync(appContract, 'utf8'));
const copy = normalize(readFileSync(functionsContract, 'utf8'));

if (app !== copy) {
  const appLines = app.split('\n');
  const copyLines = copy.split('\n');
  const line = appLines.findIndex((text, index) => text !== copyLines[index]);
  const where = line === -1 ? Math.min(appLines.length, copyLines.length) + 1 : line + 1;
  console.error(
    `AI contract drift: ${relative(process.cwd(), functionsContract)} differs from ${relative(process.cwd(), appContract)} (first difference at line ${where}).\n` +
      'Copy src/core/aiContract.ts to functions/src/shared/aiContract.ts verbatim.',
  );
  process.exit(1);
}
process.stdout.write('AI contract: functions copy matches src/core/aiContract.ts\n');
