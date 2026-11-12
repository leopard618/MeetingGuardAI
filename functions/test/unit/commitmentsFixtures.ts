/**
 * Synthetic fixtures for the M11 commitments tests (functions/src/commitments). Every recap is a
 * copy of the specimen's LAYOUT with invented names and text, never real recap content. Special
 * characters are built from code points (ch), so this file stays plain ASCII apart from Spanish
 * letters. Not a test file itself (no *.test.ts suffix).
 */
import { parseSections, type SummaryItem, type SummarySection } from '../../src/summaries/sections';

export const ch = (...codes: number[]): string => String.fromCodePoint(...codes);
export const MIDDLE_DOT = ch(0xb7);

/** The specimen layout: title, date line, TLDR, Updates, Decisions, Action items (8 open, 1 done), Waiting on, Open questions, Launch Readiness. */
export const SPECIMEN_LINES = [
  'Urpayroll weekly sync',
  `Meeting notes ${MIDDLE_DOT} 2026-10-16`,
  '',
  'TLDR',
  'The team agreed Bish ships everything by Friday and Cristina owns the launch.',
  '',
  'Updates',
  '- Android build 1.6.0 is live on the store.',
  '- iOS build is waiting for review.',
  '',
  'Decisions',
  '- Use Postmark for inbound mail.',
  '- Review the pricing page next sprint.',
  '',
  'Action items',
  '[ ] Provide APK access/files to Urpayroll (owner: Bish)',
  '[ ] Share the release checklist with the client (owner: Bish)',
  '[ ] Confirm the launch date with the store team (owner: Cristina Reyes Sierra)',
  '[ ] Prepare the demo account (owner: Cristina Reyes Sierra)',
  '[ ] Send the support inbox address to Urpayroll (owner: Bish)',
  '[ ] Update the store listing screenshots (owner: Cristina Reyes Sierra)',
  '[ ] Check the crash reports from the beta (owner: Bish)',
  '[ ] Schedule the training session (owner: Cristina Reyes Sierra)',
  '[x] Book the demo room (owner: Lee)',
  '',
  'Waiting on',
  '- Urpayroll to confirm the test devices (waiting on: Urpayroll)',
  '',
  'Open questions',
  '- Who signs off on the launch date?',
  '',
  'Launch Readiness',
  '[ ] Store listing reviewed',
  '[ ] Support inbox staffed',
  '- Marketing assets ready',
];
export const SPECIMEN = SPECIMEN_LINES.join('\n');

/** A recap with prose only (sentence anchors), hard-wrapped mail, a "Do not ... until" sentence and a derived Summary. */
export const PROSE_RECAP = [
  'Acme sync',
  '2026-11-10',
  '',
  'Summary',
  'Everything is on track and Dana will pay the vendor today.',
  '',
  'Notes',
  'We reviewed the launch plan. Do not confirm the launch date until legal signs off. Cristina will send the',
  'pricing deck to the client by Friday; Bish owes the APK by Nov 21.',
  '',
  'Ok.',
].join('\n');

/** A Spanish recap (accents kept, the parser folds them for headings). */
export const SPANISH_RECAP = [
  'Sincronización semanal de Acme',
  'Minuta 2026-11-10',
  '',
  'Resumen',
  'Todo va bien.',
  '',
  'Compromisos',
  '[ ] Enviar la propuesta al cliente (responsable: Ana de la Cruz)',
  '[ ] Revisar el contrato antes del viernes (responsable: Luis)',
  '[ ] Transferir el anticipo de $500 al proveedor (responsable: Ana de la Cruz)',
  '',
  'Próximos pasos sugeridos',
  '- Preparar una demo para marketing',
].join('\n');

export interface Parsed {
  text: string;
  sections: SummarySection[];
}

export function parsed(text: string): Parsed {
  return { text, sections: parseSections(text).sections };
}

/** The item whose text starts with `prefix` (throws when there is none, so a fixture typo fails loudly). */
export function itemOf(source: Parsed, prefix: string): SummaryItem {
  for (const section of source.sections) {
    for (const item of section.items) if (item.text.startsWith(prefix)) return item;
  }
  throw new Error(`no item starts with ${JSON.stringify(prefix)}`);
}

/** The section of `kind` (the first one). */
export function sectionOf(source: Parsed, kind: SummarySection['kind']): SummarySection {
  const found = source.sections.find((section) => section.kind === kind);
  if (found === undefined) throw new Error(`no ${kind} section`);
  return found;
}

/** A model proposal with every field the tool requires; `overrides` sets the ones a test is about. */
export function proposal(anchorId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    anchor_id: anchorId,
    quote: null,
    title: 'Untitled',
    owner: null,
    kind: 'action',
    due_quote: null,
    due_date: null,
    due_time: null,
    confidence: 90,
    ...overrides,
  };
}
