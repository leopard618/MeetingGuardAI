/**
 * Interactive Microsoft sign-in (PKCE) behind a small port, so the rest of the Outlook code and
 * its tests never touch expo-auth-session directly. The flow itself lives in
 * src/services/microsoft/authPrompt.ts, shared with "Continue with Microsoft"
 * (docs/v1/ARCHITECTURE.md section 31).
 */
import {
  MICROSOFT_CONSENT_URL,
  openMicrosoftConsentPage,
  promptMicrosoftCode,
  type MicrosoftPromptConfig,
  type PromptResult,
} from '../../microsoft/authPrompt';

export { MICROSOFT_CONSENT_URL, type PromptResult };

export interface MicrosoftAuthPort {
  /** Opens the Microsoft sign-in and resolves with the authorization code (PKCE). */
  promptForCode(config: MicrosoftPromptConfig): Promise<PromptResult>;
  /** Opens the Microsoft "manage app access" page (Graph has no programmatic consent revoke). */
  openConsentPage(): Promise<void>;
}

export function createMicrosoftAuthPort(): MicrosoftAuthPort {
  return {
    promptForCode: (config) => promptMicrosoftCode(config),
    openConsentPage: () => openMicrosoftConsentPage(),
  };
}
