/**
 * Legal screens (owner: shell). Module-level components for the root stack: the Main group has
 * the stack header above them; the Auth / Onboarding groups use the standalone variants.
 */
import type { ReactElement } from 'react';

import { LegalDocumentScreen } from './LegalDocumentScreen';

export function PrivacyScreen(): ReactElement {
  return <LegalDocumentScreen document="privacy" />;
}

export function TermsScreen(): ReactElement {
  return <LegalDocumentScreen document="terms" />;
}

export function StandalonePrivacyScreen(): ReactElement {
  return <LegalDocumentScreen document="privacy" standalone />;
}

export function StandaloneTermsScreen(): ReactElement {
  return <LegalDocumentScreen document="terms" standalone />;
}

export { LegalDocumentScreen } from './LegalDocumentScreen';
export * from './legalContent';
