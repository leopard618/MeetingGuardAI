/**
 * MEETING SUMMARIES area public API (owner: summaries-app; M10, docs/v2/M10-DESIGN.md section 9),
 * layer L5 (the summary* callables; UI hooks on top). The summary the user's own notetaker emails
 * to a private forwarding address, read and changed through the callables only.
 * Pure pieces (no Firebase) live in ./summaryCore for screen models and their tests.
 */
export {
  SUMMARIES_DISABLED_STATUS,
  isSummariesAvailable,
  isSummariesUnavailableError,
  mapSummaryError,
  summaryAppError,
  summaryErrorReason,
} from './summaryCore';
export {
  belongsInList,
  createSummariesService,
  summariesService,
  type AttachSummaryRequest,
  type SummariesCallableName,
  type SummariesService,
  type SummariesServiceDeps,
  type SummariesTransport,
  type SummaryListSnapshot,
} from './summariesService';
export {
  SUMMARY_STATUS_POLL_MS,
  SUMMARY_STATUS_STALE_MS,
  SUMMARY_STATUS_UNAVAILABLE_STALE_MS,
  useSummaryStatus,
  type UseSummaryStatusOptions,
  type UseSummaryStatusResult,
} from './useSummaryStatus';
export { useSummaryList, type UseSummaryListOptions, type UseSummaryListResult } from './useSummaryList';
export { useSummary, type UseSummaryOptions, type UseSummaryResult } from './useSummary';
