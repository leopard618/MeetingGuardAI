/**
 * Microsoft Graph calendar endpoints for the Outlook sync, on the shared Graph HTTP core
 * (src/services/microsoft/graphHttp.ts: Bearer token, 401 refresh-once, 429/5xx backoff,
 * AppError mapping). Delta paging works on absolute URLs (@odata.nextLink / @odata.deltaLink),
 * so `getDeltaPage` accepts only URLs on the Graph origin.
 */
import { createGraphHttp, type GraphTokenProvider } from '../../microsoft/graphHttp';
import type { GraphDeltaPage, GraphEvent, GraphEventWrite, GraphInstancesPage, GraphUser } from './types';

export { GRAPH_API_BASE, graphErrorCode, graphHttpStatus, type GraphTokenProvider } from '../../microsoft/graphHttp';

/** Event fields Meeting Guard reads (smaller payloads; delta supports $select). */
export const EVENT_SELECT =
  'id,changeKey,lastModifiedDateTime,type,seriesMasterId,subject,body,bodyPreview,start,end,isAllDay,' +
  'isCancelled,location,attendees,organizer,responseStatus,isOnlineMeeting,onlineMeetingProvider,onlineMeeting,onlineMeetingUrl,' +
  'transactionId';

/** Instances of a series master additionally carry the generated start (override matching). */
export const INSTANCE_SELECT = `${EVENT_SELECT},originalStart`;
/** Instance listings are bounded by the override span; this caps a runaway series. */
export const MAX_INSTANCE_PAGES = 20;

/** UTC times + plain-text bodies + bounded pages. */
const PREFER_HEADER = 'outlook.timezone="UTC", outlook.body-content-type="text", odata.maxpagesize=100';

export interface GraphApiOptions {
  tokens: GraphTokenProvider;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** 0..1 (jitter). */
  random?: () => number;
  /** Per-request timeout (default 30 s). */
  timeoutMs?: number;
  /** Retries for 429/5xx (default 3). */
  maxRetries?: number;
  baseUrl?: string;
}

export interface OutlookGraphApi {
  /** First delta page of /me/calendarView over [startIso, endIso). */
  startDelta(startIso: string, endIso: string): Promise<GraphDeltaPage>;
  /** Follows an @odata.nextLink or @odata.deltaLink (absolute Graph URL). */
  getDeltaPage(url: string): Promise<GraphDeltaPage>;
  getEvent(eventId: string): Promise<GraphEvent>;
  createEvent(body: GraphEventWrite): Promise<GraphEvent>;
  patchEvent(eventId: string, body: GraphEventWrite): Promise<GraphEvent>;
  deleteEvent(eventId: string): Promise<void>;
  /**
   * Occurrences and exceptions of a series master whose start falls in [startIso, endIso)
   * (GET /me/events/{id}/instances), every page followed. Used to find the Graph instance of a
   * cancelled or modified Meeting Guard occurrence.
   */
  listInstances(masterId: string, startIso: string, endIso: string): Promise<GraphEvent[]>;
  /** Signed-in Microsoft account (mail / userPrincipalName). */
  getMe(): Promise<GraphUser>;
}

export function createOutlookGraphApi(options: GraphApiOptions): OutlookGraphApi {
  const http = createGraphHttp({ ...options, prefer: PREFER_HEADER });
  const base = http.base;

  return {
    startDelta(startIso, endIso) {
      const url =
        `${base}/me/calendarView/delta?startDateTime=${encodeURIComponent(startIso)}` +
        `&endDateTime=${encodeURIComponent(endIso)}&$select=${encodeURIComponent(EVENT_SELECT)}`;
      return http.required<GraphDeltaPage>('GET', url, 'delta page');
    },
    async getDeltaPage(url) {
      http.assertGraphUrl(url, 'a delta link');
      return http.required<GraphDeltaPage>('GET', url, 'delta page');
    },
    getEvent(eventId) {
      return http.required<GraphEvent>(
        'GET',
        `${base}/me/events/${encodeURIComponent(eventId)}?$select=${encodeURIComponent(EVENT_SELECT)}`,
        'event',
      );
    },
    createEvent(body) {
      return http.required<GraphEvent>('POST', `${base}/me/events`, 'event', body);
    },
    patchEvent(eventId, body) {
      return http.required<GraphEvent>('PATCH', `${base}/me/events/${encodeURIComponent(eventId)}`, 'event', body);
    },
    async deleteEvent(eventId) {
      await http.request<void>('DELETE', `${base}/me/events/${encodeURIComponent(eventId)}`);
    },
    async listInstances(masterId, startIso, endIso) {
      const instances: GraphEvent[] = [];
      let url: string | undefined =
        `${base}/me/events/${encodeURIComponent(masterId)}/instances?startDateTime=${encodeURIComponent(startIso)}` +
        `&endDateTime=${encodeURIComponent(endIso)}&$select=${encodeURIComponent(INSTANCE_SELECT)}`;
      for (let count = 0; url !== undefined && count < MAX_INSTANCE_PAGES; count += 1) {
        http.assertGraphUrl(url, 'an instances link');
        const page: GraphInstancesPage = await http.required<GraphInstancesPage>('GET', url, 'instances page');
        instances.push(...(page.value ?? []));
        url = page['@odata.nextLink'];
      }
      return instances;
    },
    getMe() {
      return http.required<GraphUser>('GET', `${base}/me?$select=mail,userPrincipalName`, 'user');
    },
  };
}
