/**
 * The shared text helpers of the summary screens point at keys that exist in English and
 * Spanish for every contract value (inbox and refused reasons, statuses, tiers, error codes,
 * setup steps).
 */
import {
  SUMMARY_ERROR_CODES,
  SUMMARY_INBOX_REASONS,
  SUMMARY_REFUSED_REASONS,
  SUMMARY_STATUSES,
  SUMMARY_TIERS,
} from '../../../core/aiContract';
import { AppError } from '../../../core/errors';
import { RESOURCES } from '../../../i18n/resources';
import { summaryAppError } from '../../../services/summaries/summaryCore';
import {
  SUMMARY_SETUP_LINKS,
  SUMMARY_SETUP_STEP_KEYS,
  SUMMARY_SETUP_TABS,
  inboxReasonKey,
  refusedReasonKeys,
  setupTabKey,
  summaryChipKey,
  summaryErrorMessageKey,
  summaryStatusKey,
} from '../summaryText';

function translation(language: 'en' | 'es', qualifiedKey: string): unknown {
  const [namespace, key] = qualifiedKey.split(':') as [keyof (typeof RESOURCES)['en'], string];
  return key.split('.').reduce<unknown>(
    (node, part) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    RESOURCES[language][namespace],
  );
}

function expectDefined(keys: readonly string[]): void {
  for (const language of ['en', 'es'] as const) {
    const missing = keys.filter((key) => typeof translation(language, key) !== 'string');
    expect({ language, missing }).toEqual({ language, missing: [] });
  }
}

it('has a message for every summary error reason, plus the shared transport messages', () => {
  expectDefined(SUMMARY_ERROR_CODES.map((reason) => summaryErrorMessageKey(summaryAppError(reason))));
  expect(summaryErrorMessageKey(summaryAppError('rate_limited'))).toBe('summaries:errors.rate_limited');
  expect(summaryErrorMessageKey(new AppError('offline'))).toBe('common:errors.offline');
  expect(summaryErrorMessageKey(new AppError('timeout'))).toBe('common:errors.timeout');
  expect(summaryErrorMessageKey(new AppError('unauthenticated'))).toBe('summaries:errors.unauthenticated');
  expect(summaryErrorMessageKey(new AppError('unknown'))).toBe('summaries:errors.generic');
  expectDefined(['summaries:errors.generic']);
});

it('explains every inbox and refused reason, status and origin chip', () => {
  expectDefined(SUMMARY_INBOX_REASONS.map(inboxReasonKey));
  expectDefined(SUMMARY_REFUSED_REASONS.flatMap((reason) => Object.values(refusedReasonKeys(reason))));
  expectDefined(SUMMARY_STATUSES.map(summaryStatusKey));
  expectDefined(SUMMARY_TIERS.map(summaryChipKey));
});

it('lists the setup steps of every tab and opens only fixed https pages', () => {
  expectDefined(SUMMARY_SETUP_TABS.map(setupTabKey));
  for (const tab of SUMMARY_SETUP_TABS) {
    expect(SUMMARY_SETUP_STEP_KEYS[tab].length).toBeGreaterThan(0);
    expectDefined(SUMMARY_SETUP_STEP_KEYS[tab]);
  }
  for (const url of Object.values(SUMMARY_SETUP_LINKS)) expect(url.startsWith('https://')).toBe(true);
});
