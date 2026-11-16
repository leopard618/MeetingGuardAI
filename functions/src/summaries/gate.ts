/**
 * Ship-dark gate of meeting summaries (docs/v2/M10-DESIGN.md decision 7, section 4 step 4).
 *
 * - summariesEnabledAtLoad: whether SUMMARIES_ENABLED is true while the module is LOADED (CLI
 *   discovery and runtime read the same env var that backs the param), exactly like
 *   whatsappEnabledAtLoad. Deploy-time only: summaryInbound and summaryRead are exported only when
 *   it is true, so a deploy with the switch off never validates the SUMMARIES_* secrets. Handlers
 *   read SUMMARIES_ENABLED.value() instead.
 * - The pilot list (SUMMARIES_PILOT_UIDS) is a comma list of Firebase uids. Entries are trimmed;
 *   empty entries and anything that is not a plain uid of 1 to 128 characters of [A-Za-z0-9_-]
 *   (auto ids are 28 alphanumerics, Microsoft sign-in uids are "ms_" plus a lowercase GUID) are
 *   dropped, so a typo can never widen the pilot. Matching is exact and case-sensitive.
 * - summariesServiceAccountAtLoad: the dedicated runtime service account of the functions that
 *   bind SUMMARIES_DATA_KEY (design section 7, finding 13): summaryInbound (inboundFunction.ts)
 *   and summaryRead (readFunction.ts) both import it from here.
 *
 * SUMMARIES_SERVICE_ACCOUNT is a PLAIN KEY in functions/.env.<projectId>, read only at deploy time
 * (CLI discovery loads the code with that file in process.env) and at load time (the runtime
 * gets the same values), never at request time. It is deliberately NOT a declared param
 * (defineString): firebase-tools resolves declared params AFTER discovery
 * (deploy/functions/params.js resolveParams), so a value typed at a deploy prompt would never
 * reach this load-time read, the shared default compute account would get the secret grant, and
 * every non-interactive deploy would fail until the dotenv line existed. Without the line the
 * function simply deploys under the default account (see inboundFunction.ts).
 *
 * Pure: no Firebase imports. Never log the list itself; counts only. Never log the account.
 */

/** A uid the pilot list accepts (the admin callables' uid shape). */
export const PILOT_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Whether the SUMMARIES_ENABLED param is true while this module is loaded (deploy gating). */
export function summariesEnabledAtLoad(): boolean {
  const raw = process.env.SUMMARIES_ENABLED;
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}

/**
 * The SUMMARIES_SERVICE_ACCOUNT value while the module is LOADED (the plain key in
 * functions/.env.<projectId>, see the file comment), trimmed; null when unset or blank. The
 * "name@" shorthand is expanded here with GCLOUD_PROJECT (set by the CLI during discovery and by
 * the runtime): firebase-tools 15 grants the secret access to the endpoint's value as written, so
 * a shorthand would reach IAM as an invalid member. Without GCLOUD_PROJECT the value is passed as
 * written. Deploy-time only: it decides the runtime identity of the function, nothing at request
 * time reads it. Never logged.
 */
export function summariesServiceAccountAtLoad(): string | null {
  const raw = process.env.SUMMARIES_SERVICE_ACCOUNT;
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  const project = process.env.GCLOUD_PROJECT?.trim() ?? '';
  const shorthand = value.length > 1 && value.indexOf('@') === value.length - 1;
  return shorthand && project.length > 0 ? `${value}${project}.iam.gserviceaccount.com` : value;
}

export interface PilotList {
  uids: ReadonlySet<string>;
  /** Non-empty entries that were dropped because they are not a plain uid (for a setup log). */
  invalid: number;
}

/** Parses SUMMARIES_PILOT_UIDS and counts the entries it dropped. */
export function parsePilotList(raw: string): PilotList {
  const uids = new Set<string>();
  let invalid = 0;
  if (typeof raw !== 'string') return { uids, invalid };
  for (const entry of raw.split(',')) {
    const uid = entry.trim();
    if (uid.length === 0) continue;
    if (PILOT_UID_PATTERN.test(uid)) uids.add(uid);
    else invalid += 1;
  }
  return { uids, invalid };
}

/** The pilot uids of SUMMARIES_PILOT_UIDS (empty set = nobody). */
export function parsePilotUids(raw: string): ReadonlySet<string> {
  return parsePilotList(raw).uids;
}

/** True when `uid` is exactly one of the pilot uids. */
export function isPilotUid(uid: string, raw: string): boolean {
  if (typeof uid !== 'string' || !PILOT_UID_PATTERN.test(uid)) return false;
  return parsePilotUids(raw).has(uid);
}

// ---------------------------------------------------------------------------------------------
// M11: the WhatsApp worker's plain keys (docs/v2/M11-DESIGN.md section 4.3, section 15 finding 2)
// ---------------------------------------------------------------------------------------------

/** A service account address ("name@project.iam.gserviceaccount.com", "123-compute@developer...") or the "name@" shorthand. */
const SERVICE_ACCOUNT_RE = /^[a-z0-9][a-z0-9._-]{0,99}@(?:(?:[a-z0-9-]+\.)+gserviceaccount\.com)?$/i;

/**
 * Whether `value` names ONE service account. Anything else is refused: firebase-tools turns an
 * invoker list holding "public" into allUsers (anyone on the internet) and "private" into nobody,
 * and a user, a group or a domain is no runtime identity.
 */
export function isServiceAccountAddress(value: string | null): boolean {
  return typeof value === 'string' && SERVICE_ACCOUNT_RE.test(value.trim());
}

/**
 * The default compute account ("<number>-compute@developer.gserviceaccount.com") or the App Engine
 * default ("<project>@appspot.gserviceaccount.com"): the identities every function without its own
 * account runs as, the WhatsApp webhook included.
 */
export function isDefaultServiceAccount(value: string | null): boolean {
  if (typeof value !== 'string') return false;
  const address = value.trim().toLowerCase();
  return /^\d+-compute@developer\.gserviceaccount\.com$/.test(address) || address.endsWith('@appspot.gserviceaccount.com');
}

/**
 * SUMMARIES_WHATSAPP_INVOKER while the module is LOADED: the webhook's runtime service account, the
 * only identity allowed to invoke summaryWhatsApp (today the default compute account). A plain key
 * in functions/.env.<projectId>, read at deploy and load time like SUMMARIES_SERVICE_ACCOUNT, for
 * the same reason (a declared param would be resolved after discovery). The "name@" shorthand is
 * expanded the same way. Null when unset or blank, and when it is not one service account address
 * (isServiceAccountAddress: never "public", "private", allUsers, a user or a group): summaryWhatsApp
 * is then not exported. Never logged.
 */
export function summariesWhatsAppInvokerAtLoad(): string | null {
  const raw = process.env.SUMMARIES_WHATSAPP_INVOKER;
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  const project = process.env.GCLOUD_PROJECT?.trim() ?? '';
  const shorthand = value.length > 1 && value.indexOf('@') === value.length - 1;
  const expanded = shorthand && project.length > 0 ? `${value}${project}.iam.gserviceaccount.com` : value;
  return isServiceAccountAddress(expanded) ? expanded : null;
}

/** Whether two service account values name the same account (trimmed, case-insensitive). */
export function sameServiceAccount(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The summaries service account of the two M11 functions (summaryCommitments, summaryWhatsApp), or
 * null: they are not exported without a DEDICATED account (section 15 finding 2). Null also when
 * the value is not one service account address, names a default account (isDefaultServiceAccount)
 * or names the webhook's invoker account: the CLI grants the bound data key to the runtime account,
 * so each of those would put the key in the webhook's hands. M10's two functions keep
 * summariesServiceAccountAtLoad and its documented fallback. Never logged.
 */
export function dedicatedSummariesServiceAccountAtLoad(): string | null {
  const value = summariesServiceAccountAtLoad();
  if (value === null || !isServiceAccountAddress(value) || isDefaultServiceAccount(value)) return null;
  if (sameServiceAccount(value, summariesWhatsAppInvokerAtLoad())) return null;
  return value;
}

/**
 * SUMMARIES_WHATSAPP_URL while the module is LOADED: the worker's URL the webhook calls and asks its
 * ID token for, when the default cloudfunctions.net URL is refused as an ID token audience (the
 * run.app URL, section 4.3, UNVERIFIED until deploy day). Only an https URL without credentials,
 * query or fragment is accepted; anything else reads as unset. Never logged.
 */
export function summariesWhatsAppUrlAtLoad(): string | null {
  const raw = process.env.SUMMARIES_WHATSAPP_URL;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null;
  // The audience is the service URL as Cloud Run knows it: no trailing slash for the root path.
  return url.pathname === '/' ? url.origin : `${url.origin}${url.pathname}`;
}
