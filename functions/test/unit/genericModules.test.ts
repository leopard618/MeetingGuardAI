/**
 * The generic modules shared by the M10 and M11 summaries and the assistant matters (A2):
 * functions/src/mail (headers.ts, auth.ts), the generic commitments modules (grounding.ts, due.ts,
 * taskDoc.ts, text.ts) and functions/src/shared text.ts and textDates.ts.
 * - none of them loads a summaries module or the summaries Keyring (shared/sealed.ts), nor a
 *   summary-specific commitments module (verify.ts, ids.ts, payload.ts and the rest), at run time;
 * - mail/headers.ts has no relative import, and mail/auth.ts reaches only mail/headers.ts;
 * - the compatibility re-exports (commitments/verify.ts, summaries/sanitize.ts and sections.ts)
 *   hand out the very same functions and objects as the generic modules.
 * - the entry point src/index.ts, which function discovery and every cold start of every function
 *   load whole, never loads mail/auth.ts, mailauth or the summaries mail pipeline at load time.
 * The graph is read from the sources (relative value imports, re-exports and requires), so nothing
 * here loads mailauth.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import * as ts from 'typescript';

import * as grounding from '../../src/commitments/grounding';
import * as verify from '../../src/commitments/verify';
import * as sharedText from '../../src/shared/text';
import * as textDates from '../../src/shared/textDates';
import * as sanitize from '../../src/summaries/sanitize';
import * as sections from '../../src/summaries/sections';

const SRC = join(__dirname, '..', '..', 'src');

/** Every module a source file loads at run time (relative value imports and requires). Copied from summariesWhatsAppIndex.test.ts. */
function runtimeGraph(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    const specs: string[] = [];
    for (const match of source.matchAll(/^(?:import|export)\s+(?!type\s)[^'";]*?from\s+'(\.[^']+)'/gm)) specs.push(match[1] as string);
    for (const match of source.matchAll(/^import\s+'(\.[^']+)'/gm)) specs.push(match[1] as string);
    for (const match of source.matchAll(/require\('(\.[^']+)'\)/g)) specs.push(match[1] as string);
    for (const spec of specs) {
      const base = resolve(dirname(file), spec);
      const target = existsSync(`${base}.ts`) ? `${base}.ts` : existsSync(join(base, 'index.ts')) ? join(base, 'index.ts') : null;
      if (target !== null) stack.push(target);
    }
  }
  return [...seen].map((file) => relative(join(__dirname, '..', '..', 'src'), file).split('\\').join('/')).sort();
}

/**
 * The specifiers a source file loads when it is loaded itself: top-level value imports, re-exports
 * and requires, read with the TypeScript parser. A require inside a function body runs on a call
 * (the lazy require('./inbound') of summaries/inboundFunction.ts), and `import type`, `export
 * type` and imports or re-exports of inline `type` names only are erased by tsc, so none of them
 * counts.
 */
function loadTimeSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);
  const specs: string[] = [];
  const onlyTypeNames = (elements: readonly { isTypeOnly: boolean }[]): boolean => elements.length > 0 && elements.every((e) => e.isTypeOnly);
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const arg = node.arguments[0];
      const loads = (ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (loads && arg !== undefined && ts.isStringLiteral(arg)) specs.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      const erased =
        clause !== undefined &&
        (clause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
          (clause.name === undefined && bindings !== undefined && ts.isNamedImports(bindings) && onlyTypeNames(bindings.elements)));
      if (!erased && ts.isStringLiteral(statement.moduleSpecifier)) specs.push(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      const erased = statement.isTypeOnly || (clause !== undefined && ts.isNamedExports(clause) && onlyTypeNames(clause.elements));
      if (!erased && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) specs.push(statement.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(statement)) {
      const ref = statement.moduleReference;
      if (!statement.isTypeOnly && ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression)) specs.push(ref.expression.text);
    } else {
      visit(statement);
    }
  }
  return specs;
}

/** Every source file and package that loading `entry` loads before any function runs. */
function loadTimeGraph(entry: string): { files: string[]; packages: string[] } {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of loadTimeSpecifiers(file)) {
      if (!spec.startsWith('.')) {
        packages.add(spec);
        continue;
      }
      const base = resolve(dirname(file), spec);
      const target = existsSync(`${base}.ts`) ? `${base}.ts` : existsSync(join(base, 'index.ts')) ? join(base, 'index.ts') : null;
      if (target !== null) stack.push(target);
    }
  }
  return { files: [...seen].map((file) => relative(SRC, file).split('\\').join('/')).sort(), packages: [...packages].sort() };
}

/** Loaded on the first request only (a require inside the handler), never by a deploy-time module. */
const FIRST_REQUEST_ONLY_FILES = ['mail/auth.ts', 'summaries/authenticity.ts', 'summaries/inbound.ts', 'summaries/mime.ts', 'summaries/htmlText.ts'];
const FIRST_REQUEST_ONLY_PACKAGES = ['mailauth', 'postal-mime', 'parse5'];

const GENERIC_MODULES = [
  'mail/headers.ts',
  'mail/auth.ts',
  'commitments/grounding.ts',
  'commitments/due.ts',
  'commitments/taskDoc.ts',
  'commitments/text.ts',
  'shared/text.ts',
  'shared/textDates.ts',
] as const;

/** The commitments modules a generic module may load; every other one is summary-specific. */
const GENERIC_COMMITMENTS: ReadonlySet<string> = new Set<string>(GENERIC_MODULES.filter((file) => file.startsWith('commitments/')));

/** What the generic commitments and shared text modules may load besides each other: the contract copies. */
const SHARED_ALLOWED: ReadonlySet<string> = new Set(['shared/text.ts', 'shared/textDates.ts', 'shared/aiContract.ts', 'shared/time.ts', 'shared/errors.ts']);

describe('generic modules', () => {
  it.each(GENERIC_MODULES)('%s never loads a summaries module, the summaries Keyring or a summary-specific commitments module', (entry) => {
    const graph = runtimeGraph(join(SRC, entry));
    expect(graph).toContain(entry);
    const forbidden = graph.filter(
      (file) => file.startsWith('summaries/') || file === 'shared/sealed.ts' || (file.startsWith('commitments/') && !GENERIC_COMMITMENTS.has(file)),
    );
    expect([entry, forbidden]).toEqual([entry, []]);
  });

  it('control: the walker sees the summaries and Keyring edges of the summary-specific modules', () => {
    expect(runtimeGraph(join(SRC, 'commitments', 'verify.ts'))).toEqual(
      expect.arrayContaining(['commitments/grounding.ts', 'commitments/due.ts', 'commitments/ids.ts', 'summaries/sections.ts', 'shared/sealed.ts', 'shared/textDates.ts']),
    );
    expect(runtimeGraph(join(SRC, 'summaries', 'sanitize.ts'))).toContain('shared/text.ts');
  });

  it('mail/headers.ts has no relative import, and mail/auth.ts reaches only mail/headers.ts', () => {
    expect(runtimeGraph(join(SRC, 'mail', 'headers.ts'))).toEqual(['mail/headers.ts']);
    expect(runtimeGraph(join(SRC, 'mail', 'auth.ts'))).toEqual(['mail/auth.ts', 'mail/headers.ts']);
  });

  it('the generic commitments modules and the shared text modules reach only each other and the contract copies', () => {
    for (const entry of ['commitments/grounding.ts', 'commitments/due.ts', 'commitments/taskDoc.ts', 'commitments/text.ts', 'shared/text.ts', 'shared/textDates.ts']) {
      const outside = runtimeGraph(join(SRC, entry)).filter((file) => !GENERIC_COMMITMENTS.has(file) && !SHARED_ALLOWED.has(file));
      expect([entry, outside]).toEqual([entry, []]);
    }
  });
});

describe('load-time graph of the entry point', () => {
  // A value import of mail/auth.ts from matters/inbound.ts (loaded through matters/index.ts and
  // ./handlers) would load mailauth in every function of the project; it must come through a
  // require inside the handler, as in summaries/inboundFunction.ts.
  it('src/index.ts never loads mail/auth.ts, mailauth or the summaries mail pipeline', () => {
    const { files, packages } = loadTimeGraph(join(SRC, 'index.ts'));
    expect(files.filter((file) => FIRST_REQUEST_ONLY_FILES.includes(file))).toEqual([]);
    expect(packages.filter((name) => FIRST_REQUEST_ONLY_PACKAGES.includes(name))).toEqual([]);
  });

  it('control: the walker reaches the deploy-time matters and summaries modules, stops at a lazy require, and sees mailauth behind summaries/inbound.ts', () => {
    expect(loadTimeGraph(join(SRC, 'index.ts')).files).toEqual(
      expect.arrayContaining(['matters/index.ts', 'matters/handlers.ts', 'matters/inbound.ts', 'summaries/index.ts', 'summaries/inboundFunction.ts']),
    );
    // inboundFunction.ts requires ./inbound inside its handler: a run-time edge, not a load-time one.
    expect(runtimeGraph(join(SRC, 'summaries', 'inboundFunction.ts'))).toContain('summaries/inbound.ts');
    expect(loadTimeGraph(join(SRC, 'summaries', 'inboundFunction.ts')).files).not.toContain('summaries/inbound.ts');
    const inbound = loadTimeGraph(join(SRC, 'summaries', 'inbound.ts'));
    expect(inbound.files).toEqual(expect.arrayContaining(FIRST_REQUEST_ONLY_FILES));
    expect(inbound.packages).toEqual(expect.arrayContaining(FIRST_REQUEST_ONLY_PACKAGES));
  });
});

describe('compatibility re-exports', () => {
  it('commitments/verify.ts re-exports the grounding functions themselves', () => {
    expect(verify.matchVerbatim).toBe(grounding.matchVerbatim);
    expect(verify.expandSentence).toBe(grounding.expandSentence);
    expect(verify.hasBareHost).toBe(grounding.hasBareHost);
    expect(verify.defangLinks).toBe(grounding.defangLinks);
    expect(verify.cleanTitle).toBe(grounding.cleanTitle);
    expect(verify.groundTitle).toBe(grounding.groundTitle);
    expect(verify.ownerPrefixed).toBe(grounding.ownerPrefixed);
  });

  it('summaries/sanitize.ts sliceSafe and summaries/sections.ts datesIn and MONTHS are the shared ones', () => {
    expect(sanitize.sliceSafe).toBe(sharedText.sliceSafe);
    expect(sections.datesIn).toBe(textDates.datesIn);
    expect(sections.MONTHS).toBe(textDates.MONTHS);
  });

  it('the shared helpers behave as before the move', () => {
    const pair = `${String.fromCharCode(0xd83d)}${String.fromCharCode(0xde00)}`;
    expect(sharedText.sliceSafe(`ab${pair}`, 3)).toBe('ab');
    expect(sharedText.sliceSafe('abc', 5)).toBe('abc');
    expect([...textDates.datesIn('Due Nov 21, 2026, 21 de noviembre de 2026 or 2026-11-22; not 2026-02-30')]).toEqual(['2026-11-22', '2026-11-21']);
    expect(textDates.stripDates('Sync Nov 21, 2026 at 10').replace(/\s+/g, ' ')).toBe('Sync at 10');
  });
});
