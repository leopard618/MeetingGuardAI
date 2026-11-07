/**
 * Legal documents (owner: shell): which sections the Privacy Policy and the Terms of Service
 * have, in which order, and how a section is read from the `legal` namespace
 * (legal:<document>.sections.<id> = { title, body[], items[]?, note[]? }).
 *
 * The company details (LEGAL_ENTITY, legal:jurisdiction in both languages) are filled with the
 * real legal entity; have the texts reviewed by counsel before publishing material changes.
 */
import { AI_ALLOWANCES } from '../../core/aiContract';

export type LegalDocumentId = 'privacy' | 'terms';

/** Date shown as "Last updated" (a calendar date, formatted in the UI language). */
export const LEGAL_LAST_UPDATED = '2026-11-06';

/** Legal entity that provides the app. */
export const LEGAL_ENTITY = {
  name: 'AETERNUM TECH LTD',
  address: '128 City Road, London, United Kingdom, EC1V 2NX',
  email: 'support@meetingguard.ai',
} as const;

export const LEGAL_SECTIONS: Readonly<Record<LegalDocumentId, readonly string[]>> = {
  privacy: [
    'controller',
    'collect',
    'device',
    'use',
    'google',
    'microsoft',
    'deviceCalendars',
    'zoom',
    'whatsapp',
    'ai',
    'notifications',
    'sharing',
    'transfers',
    'retention',
    'security',
    'rights',
    'children',
    'changes',
  ],
  terms: [
    'agreement',
    'service',
    'account',
    'alerts',
    'ai',
    'plans',
    'content',
    'thirdParty',
    'acceptableUse',
    'ip',
    'termination',
    'disclaimers',
    'liability',
    'law',
    'changes',
  ],
};

/** "[SOMETHING]" = a value still to be filled in before release. */
export function isPlaceholder(value: string): boolean {
  return /^\[[^\]]+\]$/.test(value.trim());
}

/** A usable contact email (placeholders are not linked). */
export function contactEmail(): string | null {
  const email = LEGAL_ENTITY.email.trim();
  return !isPlaceholder(email) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export interface LegalSection {
  id: string;
  title: string;
  body: string[];
  items: string[];
  note: string[];
}

/** Translation lookup returning raw values (objects / arrays with `returnObjects`). */
export type RawTranslate = (key: string, options: Record<string, unknown>) => unknown;

function strings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
}

/** Values interpolated into the texts ({{company}}, {{email}}, ...). */
export function legalVariables(jurisdiction: string): Record<string, string | number> {
  return {
    company: LEGAL_ENTITY.name,
    address: LEGAL_ENTITY.address,
    email: LEGAL_ENTITY.email,
    jurisdiction,
    freeLimit: AI_ALLOWANCES.free.total,
    freeDays: AI_ALLOWANCES.free.windowDays,
    freePerDay: AI_ALLOWANCES.free.perDay,
    proLimit: AI_ALLOWANCES.pro.perMonth,
    premiumLimit: AI_ALLOWANCES.premium.perMonth,
  };
}

/** Reads one section; a section whose texts are missing comes back with an empty title and body. */
export function readLegalSection(
  translate: RawTranslate,
  document: LegalDocumentId,
  id: string,
  variables: Record<string, unknown>,
): LegalSection {
  const raw = translate(`legal:${document}.sections.${id}`, { ...variables, returnObjects: true });
  const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    id,
    title: typeof record.title === 'string' ? record.title : '',
    body: strings(record.body),
    items: strings(record.items),
    note: strings(record.note),
  };
}

export function readLegalDocument(
  translate: RawTranslate,
  document: LegalDocumentId,
  variables: Record<string, unknown>,
): LegalSection[] {
  return LEGAL_SECTIONS[document]
    .map((id) => readLegalSection(translate, document, id, variables))
    .filter((section) => section.title !== '' && section.body.length + section.items.length > 0);
}
