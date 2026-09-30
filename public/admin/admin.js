/**
 * MeetingGuard AI admin dashboard (build-free ES module; docs/ADMIN.md, docs/ARCHITECTURE.md §21).
 *
 * - Firebase JS SDK from the gstatic CDN (the version tracks functions/package.json devDeps).
 * - Config comes from Firebase Hosting's reserved /__/firebase/init.json; a local ./config.js
 *   (optional, for development outside Hosting) may override it.
 * - Sign-in is a Google popup. The page force-refreshes the ID token after sign-in because the
 *   `admin` custom claim travels inside the token; without the claim it only shows a block state.
 *   The real enforcement is server-side in every callable.
 * - All user data is rendered with textContent (never innerHTML): names/emails are untrusted.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';

/** Must match FUNCTIONS_REGION (functions/src/config.ts); override via config.js `region`. */
const DEFAULT_REGION = 'us-central1';
const PLANS = ['free', 'pro', 'premium'];
const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------------------------
// Tiny DOM helpers
// ---------------------------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const VIEWS = ['view-loading', 'view-config-error', 'view-sign-in', 'view-not-admin', 'view-dashboard'];
function showView(id) {
  for (const view of VIEWS) $(view).hidden = view !== id;
}

let toastTimer = null;
function toast(message, isError = false) {
  const node = $('toast');
  node.textContent = message;
  node.className = isError ? 'error' : '';
  node.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, isError ? 8000 : 4000);
}

function callableErrorMessage(error) {
  const code = typeof error?.code === 'string' ? error.code.replace(/^functions\//, '') : 'unknown';
  const message = typeof error?.message === 'string' && error.message ? error.message : 'Unexpected error.';
  return `${message} (${code})`;
}

function dateOnly(iso) {
  return typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : '—';
}

// ---------------------------------------------------------------------------------------------
// Configuration (Hosting reserved URL, with a local override for development)
// ---------------------------------------------------------------------------------------------

async function loadConfig() {
  try {
    const response = await fetch('/__/firebase/init.json');
    if (response.ok) return { firebaseConfig: await response.json(), region: DEFAULT_REGION };
  } catch {
    // Not served by Firebase Hosting (file:// or another static server); try config.js below.
  }
  // Optional, NOT required on Hosting: public/admin/config.js with
  //   export const firebaseConfig = { apiKey: ..., authDomain: ..., projectId: ..., appId: ... };
  //   export const region = 'us-central1'; // optional
  const local = await import('./config.js');
  if (!local?.firebaseConfig) throw new Error('config.js has no firebaseConfig export.');
  return { firebaseConfig: local.firebaseConfig, region: local.region || DEFAULT_REGION };
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

let auth = null;
let callables = null;
let currentUid = null;

const usersState = {
  rows: [],
  nextPageToken: null,
  query: '',
  loading: false,
};

// ---------------------------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------------------------

async function loadMetrics() {
  const button = $('metrics-refresh');
  button.disabled = true;
  try {
    const { data } = await callables.getMetrics({});
    $('metric-total').textContent = String(data.totalUsers);
    $('metric-free').textContent = String(data.planCounts.free);
    $('metric-pro').textContent = String(data.planCounts.pro);
    $('metric-premium').textContent = String(data.planCounts.premium);
    $('metric-ai-today').textContent = String(data.assistantRequests.today);
    $('metric-ai-week').textContent = String(data.assistantRequests.last7Days);
  } catch (error) {
    toast(`Could not load metrics: ${callableErrorMessage(error)}`, true);
  } finally {
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------------------------------
// Users table
// ---------------------------------------------------------------------------------------------

function rowMatches(row, query) {
  if (!query) return true;
  const haystack = `${row.email ?? ''}\n${row.displayName ?? ''}\n${row.uid}`.toLowerCase();
  return haystack.includes(query);
}

function userLabel(row) {
  return row.email || row.displayName || row.uid;
}

function buildUserCell(row) {
  const cell = el('td', 'user-cell');
  if (row.displayName) cell.appendChild(el('div', 'name', row.displayName));
  if (row.email) cell.appendChild(el('div', 'email', row.email));
  cell.appendChild(el('div', 'uid', row.uid));
  return cell;
}

function planMetaText(row) {
  const parts = [];
  if (row.entitlementStatus !== 'active') parts.push(row.entitlementStatus.replace('_', ' '));
  if (row.entitlementSource !== 'none') parts.push(`via ${row.entitlementSource}`);
  if (row.expiresAt) parts.push(`until ${dateOnly(row.expiresAt)}`);
  return parts.join(' · ');
}

function buildPlanCell(row) {
  const cell = el('td');
  const wrap = el('div', 'plan-cell');

  const line = el('div', 'plan-line');
  line.appendChild(el('span', `badge plan-${row.plan}`, row.plan));
  const meta = planMetaText(row);
  if (meta) line.appendChild(el('span', 'plan-meta', meta));
  wrap.appendChild(line);

  const editor = el('div', 'plan-edit');
  const select = el('select');
  select.setAttribute('aria-label', `Plan for ${userLabel(row)}`);
  for (const plan of PLANS) {
    const option = el('option', undefined, plan);
    option.value = plan;
    if (plan === row.plan) option.selected = true;
    select.appendChild(option);
  }
  const expiry = el('input');
  expiry.type = 'date';
  expiry.setAttribute('aria-label', `Plan expiry for ${userLabel(row)} (empty = no expiry)`);
  if (row.expiresAt) expiry.value = dateOnly(row.expiresAt);
  const apply = el('button', 'btn btn-small', 'Apply');
  apply.type = 'button';
  apply.setAttribute('aria-label', `Apply plan change for ${userLabel(row)}`);
  apply.addEventListener('click', () => applyPlan(row, select, expiry, apply));
  editor.append(select, expiry, apply);
  wrap.appendChild(editor);

  cell.appendChild(wrap);
  return cell;
}

async function applyPlan(row, select, expiry, button) {
  const plan = select.value;
  // The whole selected day still counts: expiry is the END of that UTC day.
  const expiresAt = expiry.value ? `${expiry.value}T23:59:59.000Z` : null;
  const summary = expiresAt ? `${plan} until ${expiry.value} (end of day, UTC)` : `${plan} with no expiry`;
  if (!window.confirm(`Set the plan of ${userLabel(row)} to ${summary}?`)) return;
  button.disabled = true;
  try {
    await callables.setUserPlan({ uid: row.uid, plan, expiresAt });
    row.plan = plan;
    row.expiresAt = expiresAt;
    row.entitlementStatus = 'active';
    row.entitlementSource = 'admin';
    renderUsers();
    toast(`Plan of ${userLabel(row)} set to ${plan}.`);
  } catch (error) {
    toast(`Could not set the plan: ${callableErrorMessage(error)}`, true);
  } finally {
    button.disabled = false;
  }
}

function buildStatusCell(row) {
  const cell = el('td');
  const wrap = el('div', 'status-cell');
  wrap.appendChild(el('span', `badge ${row.disabled ? 'status-disabled' : 'status-active'}`, row.disabled ? 'Disabled' : 'Active'));
  const toggle = el('button', `btn btn-small ${row.disabled ? '' : 'btn-danger'}`.trim(), row.disabled ? 'Enable' : 'Disable');
  toggle.type = 'button';
  toggle.setAttribute('aria-label', `${row.disabled ? 'Enable' : 'Disable'} ${userLabel(row)}`);
  if (row.uid === currentUid) {
    toggle.disabled = true;
    toggle.title = 'You cannot disable your own account.';
  }
  toggle.addEventListener('click', () => toggleDisabled(row, toggle));
  wrap.appendChild(toggle);
  cell.appendChild(wrap);
  return cell;
}

async function toggleDisabled(row, button) {
  const disabled = !row.disabled;
  const question = disabled
    ? `Disable ${userLabel(row)}? Their sessions are revoked and they cannot sign in until re-enabled.`
    : `Enable ${userLabel(row)} again?`;
  if (!window.confirm(question)) return;
  button.disabled = true;
  try {
    await callables.setUserDisabled({ uid: row.uid, disabled });
    row.disabled = disabled;
    renderUsers();
    toast(`${userLabel(row)} is now ${disabled ? 'disabled' : 'enabled'}.`);
  } catch (error) {
    toast(`Could not update the user: ${callableErrorMessage(error)}`, true);
  } finally {
    button.disabled = false;
  }
}

function renderUsers() {
  const body = $('users-body');
  body.replaceChildren();
  const visible = usersState.rows.filter((row) => rowMatches(row, usersState.query));
  for (const row of visible) {
    const tr = el('tr');
    tr.appendChild(buildUserCell(row));
    tr.appendChild(buildPlanCell(row));
    const usage = el('td', 'num', String(row.usageToday));
    tr.appendChild(usage);
    tr.appendChild(el('td', undefined, dateOnly(row.createdAt)));
    tr.appendChild(el('td', undefined, dateOnly(row.lastSignInAt)));
    tr.appendChild(buildStatusCell(row));
    body.appendChild(tr);
  }
  $('users-empty').hidden = visible.length > 0;
  const loadMore = $('users-load-more');
  loadMore.hidden = usersState.nextPageToken === null;
  loadMore.disabled = usersState.loading;
  loadMore.textContent = usersState.loading ? 'Loading…' : 'Load more';
}

async function loadUsersPage(reset) {
  if (usersState.loading) return;
  usersState.loading = true;
  renderUsers();
  try {
    const request = { pageSize: PAGE_SIZE };
    if (!reset && usersState.nextPageToken) request.pageToken = usersState.nextPageToken;
    const { data } = await callables.listUsers(request);
    usersState.rows = reset ? data.users : usersState.rows.concat(data.users);
    usersState.nextPageToken = data.nextPageToken;
  } catch (error) {
    toast(`Could not load users: ${callableErrorMessage(error)}`, true);
  } finally {
    usersState.loading = false;
    renderUsers();
  }
}

// ---------------------------------------------------------------------------------------------
// Auth flow
// ---------------------------------------------------------------------------------------------

async function handleSignedIn(user) {
  showView('view-loading');
  try {
    // The admin claim lives inside the ID token: refresh once so a freshly granted claim shows.
    await user.getIdToken(true);
    const result = await user.getIdTokenResult();
    $('session-email').textContent = user.email ?? user.uid;
    $('session').hidden = false;
    if (result.claims.admin !== true) {
      $('not-admin-email').textContent = user.email ?? user.uid;
      showView('view-not-admin');
      return;
    }
    currentUid = user.uid;
    showView('view-dashboard');
    usersState.rows = [];
    usersState.nextPageToken = null;
    usersState.query = '';
    $('user-search').value = '';
    await Promise.all([loadMetrics(), loadUsersPage(true)]);
  } catch (error) {
    toast(`Sign-in check failed: ${callableErrorMessage(error)}`, true);
    showView('view-sign-in');
  }
}

function wireEvents() {
  $('sign-in').addEventListener('click', async () => {
    const errorNode = $('sign-in-error');
    errorNode.hidden = true;
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      errorNode.textContent = callableErrorMessage(error);
      errorNode.hidden = false;
    }
  });
  const doSignOut = () => signOut(auth);
  $('sign-out').addEventListener('click', doSignOut);
  $('not-admin-sign-out').addEventListener('click', doSignOut);
  $('metrics-refresh').addEventListener('click', loadMetrics);
  $('users-load-more').addEventListener('click', () => loadUsersPage(false));
  $('user-search').addEventListener('input', (event) => {
    usersState.query = event.target.value.trim().toLowerCase();
    renderUsers();
  });
}

async function main() {
  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    $('config-error-detail').textContent = error instanceof Error ? error.message : String(error);
    showView('view-config-error');
    return;
  }
  const app = initializeApp(config.firebaseConfig);
  auth = getAuth(app);
  const functions = getFunctions(app, config.region);
  callables = {
    listUsers: httpsCallable(functions, 'adminListUsers'),
    setUserDisabled: httpsCallable(functions, 'adminSetUserDisabled'),
    setUserPlan: httpsCallable(functions, 'adminSetUserPlan'),
    getMetrics: httpsCallable(functions, 'adminGetMetrics'),
  };
  wireEvents();
  onAuthStateChanged(auth, (user) => {
    if (user) {
      void handleSignedIn(user);
    } else {
      currentUid = null;
      $('session').hidden = true;
      showView('view-sign-in');
    }
  });
}

void main();
