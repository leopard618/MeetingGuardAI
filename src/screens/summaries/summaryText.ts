/**
 * Shared, pure text helpers of the summary screens (M10 section 9; owner: summaries-app): which
 * "summaries" i18n key shows an error, a reason, a status or a setup step, the web pages the
 * setup tabs open, and the email provider's retention for the privacy lines. Every screen in
 * src/screens/summaries (and MeetingSummarySection) uses these; each screen keeps its own model
 * next to it. No React, no Firebase: unit tests import this file directly.
 */
import type {
  SummaryInboxReason,
  SummaryRefusedReason,
  SummaryStatus,
  SummaryTier,
} from '../../core/aiContract';
import { errorMessageKey, type AppError } from '../../core/errors';
import { summaryErrorReason } from '../../services/summaries/summaryCore';

/**
 * Days Postmark keeps each inbound email ({{providerDays}} in summaries:common.privacy.*). M10
 * section 2, day-0 check 8: 45 unless Francisco approves the retention add-on.
 */
export const SUMMARY_PROVIDER_RETENTION_DAYS = 45;

/** After this long with nothing received, the connect screen shows the Microsoft 365 hint. */
export const SUMMARY_MICROSOFT_HINT_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * i18n key for a failed summary call: the summary taxonomy reason when the server sent one
 * (summaries:errors.<reason>), the shared offline / timeout messages, else the generic one.
 */
export function summaryErrorMessageKey(error: AppError): string {
  const reason = summaryErrorReason(error);
  if (reason !== null) return `summaries:errors.${reason}`;
  if (error.code === 'offline' || error.code === 'timeout') return errorMessageKey(error.code);
  if (error.code === 'unauthenticated') return 'summaries:errors.unauthenticated';
  return 'summaries:errors.generic';
}

/** "Waiting for a meeting", "Filed under a meeting", ... */
export function summaryStatusKey(status: SummaryStatus): string {
  return `summaries:common.status.${status}`;
}

/** The origin chip on cards and rows ("From your notetaker" / "Forwarded"). */
export function summaryChipKey(tier: SummaryTier): string {
  return `summaries:common.chip.${tier}`;
}

/** Why a summary waits in the inbox, in plain language. */
export function inboxReasonKey(reason: SummaryInboxReason): string {
  return `summaries:common.inboxReason.${reason}`;
}

/** Why an email was refused: a short title, what happened, and what to do. */
export function refusedReasonKeys(reason: SummaryRefusedReason): { title: string; body: string; action: string } {
  return {
    title: `summaries:common.refusedReason.${reason}.title`,
    body: `summaries:common.refusedReason.${reason}.body`,
    action: `summaries:common.refusedReason.${reason}.action`,
  };
}

/** The setup tabs of the connect screen, in order. */
export const SUMMARY_SETUP_TABS = ['gmail', 'outlook', 'other'] as const;
export type SummarySetupTab = (typeof SUMMARY_SETUP_TABS)[number];

/** Tab labels (summaries:connect.setup.tabs.*). */
export function setupTabKey(tab: SummarySetupTab): string {
  return `summaries:connect.setup.tabs.${tab}`;
}

/** Each tab's numbered steps, in order. */
export const SUMMARY_SETUP_STEP_KEYS: Readonly<Record<SummarySetupTab, readonly string[]>> = {
  gmail: [
    'summaries:connect.setup.gmail.steps.step1',
    'summaries:connect.setup.gmail.steps.step2',
    'summaries:connect.setup.gmail.steps.step3',
    'summaries:connect.setup.gmail.steps.step4',
    'summaries:connect.setup.gmail.steps.step5',
  ],
  outlook: [
    'summaries:connect.setup.outlook.steps.step1',
    'summaries:connect.setup.outlook.steps.step2',
    'summaries:connect.setup.outlook.steps.step3',
  ],
  other: [
    'summaries:connect.setup.other.steps.step1',
    'summaries:connect.setup.other.steps.step2',
    'summaries:connect.setup.other.steps.step3',
  ],
};

/**
 * Web pages the setup tabs open with Linking.openURL (desktop web pages; the phone apps cannot
 * set up forwarding). Fixed URLs only: nothing from a summary is ever opened by the app.
 */
export const SUMMARY_SETUP_LINKS = {
  gmailForwarding: 'https://mail.google.com/mail/u/0/#settings/fwdandpop',
  gmailFilters: 'https://mail.google.com/mail/u/0/#settings/filters',
  outlookRules: 'https://outlook.office.com/mail/options/mail/rules',
} as const;
