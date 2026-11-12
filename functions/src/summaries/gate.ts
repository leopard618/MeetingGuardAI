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
