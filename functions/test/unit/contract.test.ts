import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * functions/src/shared/aiContract.ts must be a VERBATIM copy of the app's src/core/aiContract.ts
 * (same check as `npm run check:contract` and the CI step). Line endings are normalized so a
 * Windows checkout with autocrlf does not produce a false positive.
 */
describe('shared AI contract', () => {
  it('is identical to src/core/aiContract.ts', () => {
    const normalize = (text: string) => text.replace(/\r\n/g, '\n');
    const app = normalize(readFileSync(join(__dirname, '..', '..', '..', 'src', 'core', 'aiContract.ts'), 'utf8'));
    const functionsCopy = normalize(readFileSync(join(__dirname, '..', '..', 'src', 'shared', 'aiContract.ts'), 'utf8'));
    expect(functionsCopy).toBe(app);
  });
});
