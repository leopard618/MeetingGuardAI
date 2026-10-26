/**
 * MeetingGuard AI admin dashboard v2 (build-free ES module; docs/ADMIN.md, ARCHITECTURE.md §21).
 *
 * - Firebase JS SDK from the gstatic CDN (the version tracks functions/package.json devDeps).
 * - Config comes from Firebase Hosting's reserved /__/firebase/init.json; a local ./config.js
 *   (optional, for development outside Hosting) may override it.
 * - Sign-in is a Google popup. The page force-refreshes the ID token after sign-in because the
 *   `admin` custom claim travels inside the token; without the claim it only shows a block state.
 *   The real enforcement is server-side in every callable.
 * - All user data is rendered with textContent (never innerHTML): names/emails are untrusted.
 * - Five hash-routed tabs (#overview #users #revenue #ai #settings); each loads lazily on first show.
 * - Charts are hand-rolled SVG (./chart.js); pure page logic lives in ./format.js so
 *   scripts/admin-ui-tests.mjs can test it under plain node.
 * - SECURITY: the key pasted into the rotation card goes only into the callable payload; it is
 *   never logged, toasted, stored or echoed, and the input is cleared in `finally`.
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

import { renderBarChart, renderDonutChart, renderLineChart, renderSparkline } from './chart.js';
import {
  avatarIndex,
  callableErrorMessage,
  dateOnly,
  formatCompact,
  formatDateTime,
  formatInt,
  formatUsd,
  intTickFormat,
  reconcileRowPatch,
  reconcileToastText,
  requestsSeries,
  rotationErrorDisplay,
  signupsSeries,
  tokensSeries,
  revenueChurnSeries,
  revenueFlowSeries,
  v2ErrorMessage,
} from './format.js';

/** Must match FUNCTIONS_REGION (functions/src/config.ts); override via config.js `region`. */
const DEFAULT_REGION = 'us-central1';
const PLANS = ['free', 'pro', 'premium'];
const PAGE_SIZE = 50;
const TABS = ['overview', 'users', 'revenue', 'ai', 'settings'];

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

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Inline SVG glyph (stroke icon) for toasts and empty/error chart states. CSP-safe: no markup
 *  strings, no style attributes - everything is created with createElementNS. */
const GLYPH_PATHS = {
  check: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8.5 12.5l2.5 2.5 4.5-5'],
  warning: ['M12 3l10 18H2L12 3z', 'M12 10v5', 'M12 18.5v.5'],
  chart: ['M4 19V5', 'M4 19h16', 'M8 15l3-4 3 2 4-6'],
};

function glyph(name, className, size) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  if (size) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
  }
  for (const d of GLYPH_PATHS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/** Reduced motion gates the count-up and chart mount animations (CSS has the same guard). */
const REDUCED_MOTION = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Node ids whose numeral already counted up this page session (Refresh sets text at once). */
const countedUp = new Set();
/** In-flight count-up rAF handle per node id, so a fresher value cancels the older loop. */
const statRafs = new Map();

/**
 * Stat numeral setter with a one-time 600ms ease-out count-up (requestAnimationFrame).
 * Skipped wholesale under prefers-reduced-motion and on every call after the first per id.
 * Any still-running count-up for the same id is cancelled first - otherwise a quick second
 * call (AI range switch, fast Refresh) would write the new total and then have the old loop's
 * final frame overwrite it with the STALE target.
 */
function setStat(id, value, format = formatInt) {
  const node = $(id);
  const target = Number(value) || 0;
  cancelAnimationFrame(statRafs.get(id));
  statRafs.delete(id);
  if (REDUCED_MOTION || countedUp.has(id) || !Number.isInteger(target)) {
    countedUp.add(id);
    node.textContent = format(target);
    return;
  }
  countedUp.add(id);
  const started = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - started) / 600);
    const eased = 1 - (1 - t) ** 3;
    node.textContent = format(Math.round(target * eased));
    if (t < 1) statRafs.set(id, requestAnimationFrame(tick));
    else statRafs.delete(id);
  };
  statRafs.set(id, requestAnimationFrame(tick));
}

const VIEWS = ['view-loading', 'view-config-error', 'view-sign-in', 'view-not-admin', 'view-dashboard'];
function showView(id) {
  for (const view of VIEWS) $(view).hidden = view !== id;
}

let toastTimer = null;
function toast(message, isError = false) {
  const node = $('toast');
  // The className is still written WHOLESALE ('' or 'error') - admin.css styles only #toast and
  // #toast.error; the glyph and text carry their own classes inside.
  node.className = isError ? 'error' : '';
  node.replaceChildren(glyph(isError ? 'warning' : 'check', 'toast-glyph'), el('span', 'toast-text', message));
  node.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, isError ? 8000 : 4000);
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
  /** First page ever loaded successfully this session (gates the "No users match." state). */
  loadedOnce: false,
  /** Last load failed (shows the retry row only while nothing is loaded yet). */
  failed: false,
};

const aiState = { days: 7, loading: false };
const revenueState = { days: 30, loading: false };
/** Tabs whose first load already ran this session (cleared on every sign-in). */
const loadedTabs = new Set();
let activeTab = 'overview';
/** 'admin' (read and write) or 'viewer' (read-only), from the ID token claims at sign-in. */
let sessionRole = null;

// ---------------------------------------------------------------------------------------------
// Tabs (hash-routed; lazy per-tab loading)
// ---------------------------------------------------------------------------------------------

function tabFromHash() {
  const name = (location.hash || '').replace(/^#/, '');
  return TABS.includes(name) ? name : 'overview';
}

const TAB_LOADERS = {
  overview: () => { void loadMetrics(); void loadOverviewStats(); },
  users: () => { void loadUsersPage(true); },
  revenue: () => { void loadRevenue(revenueState.days); },
  ai: () => { void loadAiStats(aiState.days); },
  settings: () => { void loadHealth(false); },
};

function showTab(name) {
  activeTab = name;
  for (const tab of TABS) {
    const selected = tab === name;
    const button = $(`tab-btn-${tab}`);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`tab-${tab}`).hidden = !selected;
  }
  if (!loadedTabs.has(name)) {
    loadedTabs.add(name);
    TAB_LOADERS[name]();
  }
  // Charts that finished loading while their tab was hidden (or were sized for another width).
  repaintVisibleCharts();
}

function activateTab(name, focus = false) {
  if (location.hash !== `#${name}`) location.hash = `#${name}`;
  showTab(name);
  if (focus) $(`tab-btn-${name}`).focus();
}

function wireTabs() {
  for (const tab of TABS) $(`tab-btn-${tab}`).addEventListener('click', () => activateTab(tab));
  $('tabs').addEventListener('keydown', (event) => {
    const index = TABS.indexOf(activeTab);
    let next = null;
    // Both axes on purpose: the tablist is vertical (sidebar) from 761px up and horizontal
    // (top bar) below, and the WAI-ARIA tabs pattern wants Up/Down on vertical lists.
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = TABS[(index + 1) % TABS.length];
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = TABS[(index + TABS.length - 1) % TABS.length];
    else if (event.key === 'Home') next = TABS[0];
    else if (event.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    event.preventDefault();
    activateTab(next, true);
  });
  window.addEventListener('hashchange', () => {
    if (!$('view-dashboard').hidden) showTab(tabFromHash());
  });
}

// ---------------------------------------------------------------------------------------------
// Charts (overview + AI usage); loading keeps the previous render dimmed instead of flashing
// ---------------------------------------------------------------------------------------------

function setChartLoading(id) {
  const node = $(id);
  if (node.querySelector('svg')) {
    node.classList.add('is-loading');
  } else {
    // First load: shimmer skeleton instead of a text line (sr-only status keeps it announced).
    const wrap = el('div');
    wrap.setAttribute('role', 'status');
    wrap.appendChild(el('span', 'sr-only', 'Loading...'));
    wrap.appendChild(el('div', 'skeleton sk-chart'));
    node.replaceChildren(wrap);
  }
}

function chartStatus(id, message, isError = false) {
  const node = $(id);
  chartPaints.delete(id); // a later repaint must not resurrect stale data over this message
  node.classList.remove('is-loading');
  const block = el('div', 'state-block');
  block.appendChild(glyph(isError ? 'warning' : 'chart', 'state-glyph'));
  block.appendChild(el('p', `${isError ? 'error-text' : 'muted'} chart-msg`, message));
  node.replaceChildren(block);
}

/**
 * Last render per chart: id -> { paint, width }. The SVG viewBox is sized from the container at
 * draw time, so a chart drawn into a hidden tab (clientWidth 0) or kept across a resize would
 * mis-scale (tiny axis text, stretched strokes). Hidden containers get their paint STASHED
 * (width 0) instead of drawn; repaintVisibleCharts() re-runs paints whose width is stale - on
 * tab switch and (debounced) on window resize.
 */
const chartPaints = new Map();

function drawChart(id, render, series, options) {
  const node = $(id);
  const paint = () => {
    render(node, series, options);
    node.classList.remove('is-loading');
    chartPaints.set(id, { paint, width: node.clientWidth });
  };
  if (node.offsetParent === null) {
    chartPaints.set(id, { paint, width: 0 }); // hidden tab: draw when it becomes visible
    return;
  }
  paint();
}

function repaintVisibleCharts() {
  for (const [id, entry] of chartPaints) {
    const node = $(id);
    if (node.offsetParent === null) continue;
    const width = node.clientWidth;
    if (Math.abs(width - entry.width) > Math.max(8, entry.width * 0.03)) entry.paint();
  }
}

async function loadOverviewStats() {
  setChartLoading('overview-requests-chart');
  setChartLoading('overview-signups-chart');
  try {
    const { data } = await callables.getStats({ days: 14 });
    drawChart('overview-requests-chart', renderLineChart, requestsSeries(data.days),
      { area: true, ariaLabel: 'Assistant requests per day, last 14 days', yFormat: intTickFormat });
    drawChart('overview-signups-chart', renderBarChart, signupsSeries(data.signups),
      { ariaLabel: 'New signups per day, last 14 days', yFormat: intTickFormat });
    // Stat-tile sparklines reuse this SAME 14-day payload (no extra fetch). The plan tiles have
    // no per-day history, so only the growth/activity tiles carry one.
    const requests14 = (data.days ?? []).map((d) => d.requests);
    const signups14 = (data.signups ?? []).map((d) => d.count);
    drawChart('spark-total', renderSparkline, signups14, {});
    drawChart('spark-ai-today', renderSparkline, requests14, {});
    drawChart('spark-ai-week', renderSparkline, requests14, {});
  } catch (error) {
    const message = v2ErrorMessage(error);
    chartStatus('overview-requests-chart', message, true);
    chartStatus('overview-signups-chart', message, true);
  }
}

async function loadAiStats(days) {
  if (aiState.loading) return;
  aiState.loading = true;
  aiState.days = days;
  // Disabled while in flight: a dropped click would otherwise leave aria-pressed, the tiles and
  // the charts describing up to three different ranges with no feedback.
  const rangeButtons = document.querySelectorAll('#ai-range .range-btn');
  for (const button of rangeButtons) {
    button.disabled = true;
    button.setAttribute('aria-pressed', String(Number(button.dataset.days) === days));
  }
  setChartLoading('ai-requests-chart');
  setChartLoading('ai-tokens-chart');
  try {
    const { data } = await callables.getStats({ days });
    setStat('ai-total-requests', data.totals.requests, formatCompact);
    setStat('ai-total-input', data.totals.inputTokens, formatCompact);
    setStat('ai-total-output', data.totals.outputTokens, formatCompact);
    setStat('ai-total-signups', data.totals.signups, formatCompact);
    const costTile = $('ai-cost-tile');
    costTile.hidden = data.estCostUsd === null || data.estCostUsd === undefined;
    if (!costTile.hidden) $('ai-total-cost').textContent = formatUsd(data.estCostUsd);
    drawChart('ai-requests-chart', renderLineChart, requestsSeries(data.days),
      { ariaLabel: `Assistant requests per day, last ${days} days`, yFormat: intTickFormat });
    drawChart('ai-tokens-chart', renderBarChart, tokensSeries(data.days),
      { stacked: true, ariaLabel: `Input and output tokens per day, last ${days} days`, yFormat: intTickFormat });
  } catch (error) {
    const message = v2ErrorMessage(error);
    chartStatus('ai-requests-chart', message, true);
    chartStatus('ai-tokens-chart', message, true);
    // The previous range's totals would silently pose as the failed range's numbers.
    for (const id of ['ai-total-requests', 'ai-total-input', 'ai-total-output', 'ai-total-signups']) {
      $(id).textContent = '-';
    }
    $('ai-cost-tile').hidden = true;
  } finally {
    aiState.loading = false;
    for (const button of rangeButtons) button.disabled = false;
  }
}

// ---------------------------------------------------------------------------------------------
// Revenue (adminGetRevenue: webhook events + paying users + estimated MRR)
// ---------------------------------------------------------------------------------------------

const REVENUE_TILE_IDS = ['revenue-paying', 'revenue-mrr', 'revenue-trials', 'revenue-newpaid',
  'revenue-cancellations', 'revenue-expirations'];
const REVENUE_DETAIL_IDS = ['revenue-paying-detail', 'revenue-mrr-detail', 'revenue-newpaid-detail',
  'revenue-cancellations-detail', 'revenue-store-detail'];

async function loadRevenue(days) {
  if (revenueState.loading) return;
  revenueState.loading = true;
  revenueState.days = days;
  const rangeButtons = document.querySelectorAll('#revenue-range .range-btn');
  for (const button of rangeButtons) {
    button.disabled = true;
    button.setAttribute('aria-pressed', String(Number(button.dataset.days) === days));
  }
  setChartLoading('revenue-flow-chart');
  setChartLoading('revenue-churn-chart');
  setChartLoading('revenue-plans-chart');
  try {
    const { data } = await callables.getRevenue({ days });
    const { totals, active, mrr } = data;
    setStat('revenue-paying', active.paying);
    $('revenue-paying-detail').textContent =
      `${active.byPlan.pro} Pro, ${active.byPlan.premium} Premium` +
      (active.gracePeriod ? `, ${active.gracePeriod} in grace period` : '') +
      (active.comps ? `; ${active.comps} granted by admin` : '');
    setStat('revenue-mrr', mrr.estimateUsd, formatUsd);
    $('revenue-mrr-detail').textContent = mrr.defaultPriceCount === 0
      ? 'From stored prices'
      : `${mrr.measuredPriceCount} from stored prices, ${mrr.defaultPriceCount} at list price`;
    setStat('revenue-trials', totals.trialsStarted);
    setStat('revenue-newpaid', totals.newPaid);
    $('revenue-newpaid-detail').textContent = `${totals.trialConversions} from trials, ${totals.renewals} renewals`;
    setStat('revenue-cancellations', totals.cancellations);
    $('revenue-cancellations-detail').textContent =
      `${totals.refunds} refunds, ${totals.billingIssues} billing issues, ${totals.uncancellations} reactivated`;
    setStat('revenue-expirations', totals.expirations);
    $('revenue-store-detail').textContent =
      `Google Play ${active.byStore.playStore}, App Store ${active.byStore.appStore}` +
      (active.byStore.other ? `, other ${active.byStore.other}` : '');
    drawChart('revenue-flow-chart', renderBarChart, revenueFlowSeries(data.days),
      { ariaLabel: `New paid subscriptions and trials started per day, last ${days} days`, yFormat: intTickFormat });
    drawChart('revenue-churn-chart', renderBarChart, revenueChurnSeries(data.days),
      { ariaLabel: `Cancellations and expirations per day, last ${days} days`, yFormat: intTickFormat });
    drawChart('revenue-plans-chart', renderDonutChart, [
      { label: 'Pro', value: active.byPlan.pro, colorVar: '--primary-deep' },
      { label: 'Premium', value: active.byPlan.premium, gradient: true },
    ], { total: active.paying, centerLabel: 'paying', ariaLabel: 'Paying users by plan' });
  } catch (error) {
    const message = v2ErrorMessage(error);
    chartStatus('revenue-flow-chart', message, true);
    chartStatus('revenue-churn-chart', message, true);
    chartStatus('revenue-plans-chart', message, true);
    // The previous range's numbers would otherwise pose as the failed range's.
    for (const id of REVENUE_TILE_IDS) $(id).textContent = '-';
    for (const id of REVENUE_DETAIL_IDS) $(id).textContent = '-';
  } finally {
    revenueState.loading = false;
    for (const button of rangeButtons) button.disabled = false;
  }
}

// ---------------------------------------------------------------------------------------------
// Metrics (v1 tiles)
// ---------------------------------------------------------------------------------------------

async function loadMetrics() {
  const button = $('metrics-refresh');
  button.disabled = true;
  setChartLoading('overview-plans-chart');
  try {
    const { data } = await callables.getMetrics({});
    setStat('metric-total', data.totalUsers);
    setStat('metric-free', data.planCounts.free);
    setStat('metric-pro', data.planCounts.pro);
    setStat('metric-premium', data.planCounts.premium);
    setStat('metric-ai-today', data.assistantRequests.today);
    setStat('metric-ai-week', data.assistantRequests.last7Days);
    // Header stat strip mirrors the same payload (compact numerals).
    setStat('strip-users', data.totalUsers, formatCompact);
    setStat('strip-ai-today', data.assistantRequests.today, formatCompact);
    setStat('strip-ai-week', data.assistantRequests.last7Days, formatCompact);
    drawChart('overview-plans-chart', renderDonutChart, [
      { label: 'Free', value: data.planCounts.free, colorVar: '--chart-6' },
      { label: 'Pro', value: data.planCounts.pro, colorVar: '--primary-deep' },
      { label: 'Premium', value: data.planCounts.premium, gradient: true },
    ], { total: data.totalUsers, centerLabel: 'users', ariaLabel: 'Plan distribution of all users' });
  } catch (error) {
    toast(`Could not load metrics: ${callableErrorMessage(error)}`, true);
    // First-load skeletons must not shimmer forever over a failed fetch.
    for (const id of ['metric-total', 'metric-free', 'metric-pro', 'metric-premium',
      'metric-ai-today', 'metric-ai-week', 'strip-users', 'strip-ai-today', 'strip-ai-week']) {
      const node = $(id);
      if (node.querySelector('.skeleton') || node.textContent === '') node.textContent = '-';
    }
    chartStatus('overview-plans-chart', v2ErrorMessage(error), true);
  } finally {
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------------------------------
// Users table (functionality unchanged from v1)
// ---------------------------------------------------------------------------------------------

function rowMatches(row, query) {
  if (!query) return true;
  const haystack = `${row.email ?? ''}\n${row.displayName ?? ''}\n${row.uid}`.toLowerCase();
  return haystack.includes(query);
}

function userLabel(row) {
  return row.email || row.displayName || row.uid;
}

/** Initials for the avatar disc: display name words, else first email/uid character. */
function userInitials(row) {
  const name = (row.displayName || '').trim();
  if (name) {
    const parts = name.split(/\s+/);
    const first = parts[0].charAt(0);
    const second = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + second).toUpperCase();
  }
  const fallback = (row.email || row.uid || '?').trim();
  return fallback.charAt(0).toUpperCase();
}

function buildUserCell(row) {
  const cell = el('td', 'user-cell');
  const wrap = el('div', 'user-wrap');
  const avatar = el('span', `avatar av-${avatarIndex(row.uid)}`, userInitials(row));
  avatar.setAttribute('aria-hidden', 'true');
  const ident = el('div', 'ident');
  if (row.displayName) ident.appendChild(el('div', 'name', row.displayName));
  if (row.email) ident.appendChild(el('div', 'email', row.email));
  ident.appendChild(el('div', 'uid', row.uid));
  wrap.append(avatar, ident);
  cell.appendChild(wrap);
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
  const reconcile = el('button', 'btn btn-small btn-ghost', 'Reconcile');
  reconcile.type = 'button';
  reconcile.title = 'Check this user against RevenueCat and fix the entitlement if it drifted.';
  reconcile.setAttribute('aria-label', `Reconcile entitlement of ${userLabel(row)} against RevenueCat`);
  reconcile.addEventListener('click', () => reconcileRow(row, reconcile));
  editor.append(select, expiry, apply, reconcile);
  if (sessionRole !== 'viewer') wrap.appendChild(editor); // read-only sessions see the plan, not the controls

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

/**
 * Users-row "Reconcile": adminReconcileEntitlement checks the uid against the RevenueCat REST
 * API and rewrites entitlements/{uid} ONLY on drift (precedence: an ACTIVE store subscription
 * overwrites anything, admin grants included; an empty or lapsed store state never downgrades
 * an admin comp - docs/SETUP.md section 11.7). The callable is deployed only while
 * REVENUECAT_RECONCILE_ENABLED is true, so the not-deployed case surfaces through
 * v2ErrorMessage as the deploy hint.
 */
async function reconcileRow(row, button) {
  const question = `Reconcile ${userLabel(row)} against RevenueCat?\n\n`
    + 'Reads the store subscription state and rewrites the entitlement only when it drifted. '
    + 'Admin-granted plans are kept unless an active store subscription says otherwise.';
  if (!window.confirm(question)) return;
  button.disabled = true;
  try {
    const { data } = await callables.reconcileEntitlement({ uid: row.uid });
    const patch = reconcileRowPatch(data, Date.now());
    if (patch) {
      Object.assign(row, patch);
      renderUsers();
    }
    toast(reconcileToastText(userLabel(row), data));
  } catch (error) {
    toast(`Could not reconcile: ${v2ErrorMessage(error)}`, true);
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
  if (sessionRole !== 'viewer') wrap.appendChild(toggle);
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
  // Tri-state: loading row on the first fetch, retry row when it failed, and "No users match."
  // only once a load has SUCCEEDED - never while the table is merely empty-because-pending.
  const firstLoading = usersState.loading && !usersState.loadedOnce;
  const firstFailed = usersState.failed && !usersState.loadedOnce && !usersState.loading;
  $('users-loading').hidden = !firstLoading;
  $('users-error').hidden = !firstFailed;
  $('users-empty').hidden = !usersState.loadedOnce || visible.length > 0;
  const loadMore = $('users-load-more');
  loadMore.hidden = usersState.nextPageToken === null;
  loadMore.disabled = usersState.loading;
  loadMore.textContent = usersState.loading ? 'Loading...' : 'Load more';
}

async function loadUsersPage(reset) {
  if (usersState.loading) return;
  usersState.loading = true;
  usersState.failed = false;
  renderUsers();
  try {
    const request = { pageSize: PAGE_SIZE };
    if (!reset && usersState.nextPageToken) request.pageToken = usersState.nextPageToken;
    const { data } = await callables.listUsers(request);
    usersState.rows = reset ? data.users : usersState.rows.concat(data.users);
    usersState.nextPageToken = data.nextPageToken;
    usersState.loadedOnce = true;
  } catch (error) {
    usersState.failed = true;
    toast(`Could not load users: ${callableErrorMessage(error)}`, true);
  } finally {
    usersState.loading = false;
    renderUsers();
  }
}

// ---------------------------------------------------------------------------------------------
// Settings: health, assistant ping, key rotation
// ---------------------------------------------------------------------------------------------

function renderHealth(data) {
  $('health-model').textContent = data.model;
  $('health-effort').textContent = data.reasoningEffort;
  $('health-limit').textContent = formatInt(data.globalDailyLimit);
  $('health-mode').textContent = data.secretRuntime.mode === 'rest' ? 'Secret Manager (REST)' : 'Env fallback';
  $('health-version').textContent = data.secretRuntime.version ?? '-';
  $('health-rotated').textContent = formatDateTime(data.secretRuntime.lastRotatedAt);
  const iam = $('health-iam');
  iam.textContent = data.secretRuntime.iamReady ? 'Ready' : 'Grant missing';
  iam.className = `badge ${data.secretRuntime.iamReady ? 'status-active' : 'badge-warn'}`;
  $('health-iam-warning').hidden = data.secretRuntime.iamReady;
  // Rotation needs the same grant (secretVersionManager rides with it): without it the attempt
  // can only fail, so gate the button instead of letting it misfire.
  const rotate = $('rotate-run');
  rotate.disabled = !data.secretRuntime.iamReady || sessionRole === 'viewer';
  $('ping-run').disabled = sessionRole === 'viewer';
  $('rotate-key').disabled = sessionRole === 'viewer';
  rotate.title = data.secretRuntime.iamReady
    ? ''
    : 'Secret Manager grant missing - run the gcloud commands in the health card first, then Refresh.';
}

function renderPing(ping) {
  const node = $('ping-result');
  node.hidden = false;
  if (ping.ok) {
    node.className = 'ok-text';
    node.textContent = `OK - OpenAI answered in ${formatInt(ping.latencyMs)} ms.`;
  } else {
    node.className = 'error-text';
    node.textContent = `Failed${ping.error ? `: ${ping.error}` : ''} (after ${formatInt(ping.latencyMs)} ms).`;
  }
}

/** ping=true makes ONE minimal real OpenAI call (billed) - only the "Test assistant" button. */
async function loadHealth(ping) {
  const refresh = $('health-refresh');
  const pingButton = $('ping-run');
  const status = $('health-status');
  refresh.disabled = true;
  pingButton.disabled = true;
  status.className = 'muted';
  status.textContent = ping ? 'Contacting OpenAI...' : 'Loading...';
  status.hidden = false;
  try {
    const { data } = await callables.getHealth(ping ? { ping: true } : {});
    renderHealth(data);
    if (data.assistantPing) renderPing(data.assistantPing);
    status.hidden = true;
  } catch (error) {
    status.className = 'error-text';
    status.textContent = v2ErrorMessage(error);
  } finally {
    refresh.disabled = false;
    pingButton.disabled = false;
  }
}

async function rotateKey() {
  const input = $('rotate-key');
  const button = $('rotate-run');
  const result = $('rotate-result');
  button.disabled = true;
  try {
    const candidate = input.value.trim();
    result.hidden = true;
    if (candidate.length < 20) {
      result.className = 'error-text';
      result.textContent = 'That does not look like an API key (too short) - paste the full key.';
      result.hidden = false;
      return; // the finally still clears the input - "cleared after every attempt" holds
    }
    const warning = 'Rotate the OpenAI API key now?\n\n'
      + 'The new key is validated against the OpenAI API, stored as the only enabled Secret '
      + 'Manager version, and ALL prior versions are disabled immediately. Running instances '
      + 'switch within about 5 minutes. This cannot be undone from this page.';
    if (!window.confirm(warning)) return;
    const { data } = await callables.rotateOpenAiKey({ newKey: candidate });
    result.className = data.modelAvailable ? 'ok-text' : 'warn-text';
    result.textContent = (data.modelAvailable
      ? `Key rotated - now Secret Manager version ${data.version}.`
      : `Key rotated (version ${data.version}), but the configured model is NOT available to `
        + 'this key. The assistant may fail until model access or OPENAI_MODEL is fixed.')
      + ' Propagating - running instances switch within ~5 minutes; the health card may show the'
      + ' old version until you Refresh after that.';
    result.hidden = false;
    // adminGetHealth runs in a SEPARATE function process whose 5-minute cache this rotation
    // cannot bust, so an immediate reload could render the OLD version right under the success
    // line. Patch the known new state in client-side instead of refetching a stale answer.
    $('health-version').textContent = data.version;
  } catch (error) {
    const { postStore, text } = rotationErrorDisplay(error);
    result.className = postStore ? 'warn-text' : 'error-text';
    result.textContent = text;
    result.hidden = false;
  } finally {
    input.value = ''; // the pasted key never outlives the attempt in the DOM
    button.disabled = false;
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
    const sessionAvatar = $('session-avatar');
    sessionAvatar.textContent = (user.email || user.uid || '?').charAt(0).toUpperCase();
    sessionAvatar.className = `avatar avatar-sm av-${avatarIndex(user.uid)}`;
    $('session').hidden = false;
    const role = result.claims.admin === true ? 'admin' : result.claims.adminRole === 'viewer' ? 'viewer' : null;
    if (role === null) {
      $('not-admin-email').textContent = user.email ?? user.uid;
      showView('view-not-admin');
      return;
    }
    sessionRole = role;
    document.body.dataset.role = role;
    $('session-role').hidden = role !== 'viewer';
    currentUid = user.uid;
    usersState.rows = [];
    usersState.nextPageToken = null;
    usersState.query = '';
    usersState.loadedOnce = false;
    usersState.failed = false;
    $('user-search').value = '';
    loadedTabs.clear();
    showView('view-dashboard');
    showTab(tabFromHash());
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
  $('metrics-refresh').addEventListener('click', () => { void loadMetrics(); void loadOverviewStats(); });
  $('users-load-more').addEventListener('click', () => loadUsersPage(false));
  $('users-retry').addEventListener('click', () => loadUsersPage(true));
  $('user-search').addEventListener('input', (event) => {
    usersState.query = event.target.value.trim().toLowerCase();
    renderUsers();
  });
  for (const button of document.querySelectorAll('#ai-range .range-btn')) {
    button.addEventListener('click', () => { void loadAiStats(Number(button.dataset.days)); });
  }
  for (const button of document.querySelectorAll('#revenue-range .range-btn')) {
    button.addEventListener('click', () => { void loadRevenue(Number(button.dataset.days)); });
  }
  $('health-refresh').addEventListener('click', () => { void loadHealth(false); });
  $('ping-run').addEventListener('click', () => { void loadHealth(true); });
  $('rotate-run').addEventListener('click', () => { void rotateKey(); });
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(repaintVisibleCharts, 150); // viewBox is sized at draw time
  });
  wireTabs();
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
  // Names are the ADMIN_CALLABLES contract (functions/src/admin/schemas.ts).
  // adminReconcileEntitlement lives in functions/src/revenuecat/reconcile.ts and is deployed
  // only while REVENUECAT_RECONCILE_ENABLED=true (docs/SETUP.md section 11.7).
  callables = {
    listUsers: httpsCallable(functions, 'adminListUsers'),
    setUserDisabled: httpsCallable(functions, 'adminSetUserDisabled'),
    setUserPlan: httpsCallable(functions, 'adminSetUserPlan'),
    getMetrics: httpsCallable(functions, 'adminGetMetrics'),
    getStats: httpsCallable(functions, 'adminGetStats'),
    getRevenue: httpsCallable(functions, 'adminGetRevenue'),
    getHealth: httpsCallable(functions, 'adminGetHealth'),
    rotateOpenAiKey: httpsCallable(functions, 'adminRotateOpenAiKey'),
    reconcileEntitlement: httpsCallable(functions, 'adminReconcileEntitlement'),
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
