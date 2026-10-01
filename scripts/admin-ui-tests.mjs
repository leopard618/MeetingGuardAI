#!/usr/bin/env node
/**
 * Pure-logic tests for the admin dashboard web app (public/admin/): chart tick math and the
 * formatters/series builders. No DOM, no network, no deps — plain `node:assert`.
 *
 *   Run:  node scripts/admin-ui-tests.mjs        (from the repo root; any cwd works)
 *
 * The admin web app is build-free, so this script is wired into nothing; run it after touching
 * public/admin/chart.js or public/admin/format.js. Importing chart.js here also proves its
 * module top level stays DOM-free (a regression would throw on import).
 */
import assert from 'node:assert/strict';

import { labelStep, niceMax, seriesMax, shortDate, stackMax, tickValues } from '../public/admin/chart.js';
import {
  callableErrorMessage,
  dateOnly,
  formatCompact,
  formatDateTime,
  formatInt,
  formatUsd,
  intTickFormat,
  requestsSeries,
  signupsSeries,
  tokensSeries,
  v2ErrorMessage,
} from '../public/admin/format.js';

let checks = 0;
function eq(actual, expected, label) {
  assert.deepEqual(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  checks += 1;
}

// ---- niceMax: smallest 1/2/5 × 10^k >= max; degenerate input -> a 0..1 axis ------------------
for (const [input, expected] of [
  [0, 1], [-3, 1], [NaN, 1], [undefined, 1],
  [1, 1], [2, 2], [3, 5], [5, 5], [6, 10], [10, 10], [12, 20], [20, 20],
  [21, 50], [49, 50], [50, 50], [51, 100], [100, 100], [437, 500], [1000, 1000],
  [1234, 2000], [5001, 10000], [123456, 200000],
]) eq(niceMax(input), expected, `niceMax(${input})`);

// ---- tickValues: the 4 gridline values (quarters of the top) ---------------------------------
eq(tickValues(100), [25, 50, 75, 100], 'tickValues(100)');
eq(tickValues(1), [0.25, 0.5, 0.75, 1], 'tickValues(1)');
eq(tickValues(2000), [500, 1000, 1500, 2000], 'tickValues(2000)');

// ---- labelStep: at most ~8 x labels --------------------------------------------------------
for (const [count, expected] of [[0, 1], [1, 1], [7, 1], [8, 1], [9, 2], [14, 2], [30, 4], [90, 12]]) {
  eq(labelStep(count), expected, `labelStep(${count})`);
}

// ---- shortDate / dateOnly / formatDateTime ---------------------------------------------------
eq(shortDate('2026-10-01'), '10-01', 'shortDate');
eq(shortDate(5), '5', 'shortDate non-string');
eq(dateOnly('2026-10-01T12:34:56.000Z'), '2026-10-01', 'dateOnly');
eq(dateOnly(null), '—', 'dateOnly null');
eq(formatDateTime('2026-10-01T12:34:56.000Z'), '2026-10-01 12:34 UTC', 'formatDateTime');
eq(formatDateTime(null), '—', 'formatDateTime null');

// ---- series max helpers ----------------------------------------------------------------------
const a = { points: [{ x: 'd1', y: 2 }, { x: 'd2', y: 3 }] };
const b = { points: [{ x: 'd1', y: 5 }, { x: 'd2', y: 1 }] };
eq(seriesMax([a, b]), 5, 'seriesMax');
eq(stackMax([a, b]), 7, 'stackMax (d1: 2+5)');
eq(seriesMax([{ points: [] }]), 0, 'seriesMax empty');
eq(stackMax([]), 0, 'stackMax no series');

// ---- formatters ------------------------------------------------------------------------------
eq(formatInt(1234567), '1,234,567', 'formatInt');
eq(formatInt(null), '0', 'formatInt null');
for (const [input, expected] of [
  [0, '0'], [999, '999'], [1000, '1K'], [12900, '12.9K'], [1000000, '1M'],
  [4200000, '4.2M'], [1500000000, '1.5B'], [1.25, '1.25'], [2.5, '2.5'],
]) eq(formatCompact(input), expected, `formatCompact(${input})`);
eq(formatUsd(0.1234), '$0.1234', 'formatUsd sub-dollar: 4 decimals');
eq(formatUsd(12.5), '$12.50', 'formatUsd: 2 decimals');
eq(formatUsd(1), '$1.00', 'formatUsd(1)');
eq(intTickFormat(1250), '1.3K', 'intTickFormat integer tick');
eq(intTickFormat(1.25), '', 'intTickFormat fractional tick -> blank label');

// ---- series builders (colorVar wiring is the docs/ADMIN.md §v2 contract) ---------------------
const day = { date: '2026-10-01', requests: 2, inputTokens: 30, outputTokens: 40 };
eq(requestsSeries([day]), [{ label: 'Requests', colorVar: '--chart-1', points: [{ x: '2026-10-01', y: 2 }] }], 'requestsSeries');
eq(signupsSeries([{ date: '2026-10-01', count: 3 }]), [{ label: 'Signups', colorVar: '--chart-5', points: [{ x: '2026-10-01', y: 3 }] }], 'signupsSeries');
eq(tokensSeries([day]), [
  { label: 'Input', colorVar: '--chart-2', points: [{ x: '2026-10-01', y: 30 }] },
  { label: 'Output', colorVar: '--chart-1', points: [{ x: '2026-10-01', y: 40 }] },
], 'tokensSeries: Input under Output');
eq(requestsSeries(undefined), [{ label: 'Requests', colorVar: '--chart-1', points: [] }], 'requestsSeries no data');

// ---- callable error mapping ------------------------------------------------------------------
eq(callableErrorMessage({ code: 'functions/permission-denied', message: 'Admin only.' }),
  'Admin only. (permission-denied)', 'callableErrorMessage');
eq(callableErrorMessage({}), 'Unexpected error. (unknown)', 'callableErrorMessage empty');
assert.match(v2ErrorMessage({ code: 'functions/not-found', message: 'not-found' }),
  /not deployed yet/, 'v2ErrorMessage: 404 -> not deployed');
checks += 1;
assert.match(v2ErrorMessage({ code: 'functions/internal', message: 'internal' }),
  /deploy functions first/, 'v2ErrorMessage: bare internal -> deploy hint');
checks += 1;
eq(v2ErrorMessage({ code: 'functions/failed-precondition', message: 'Key rejected by OpenAI.' }),
  'Key rejected by OpenAI. (failed-precondition)', 'v2ErrorMessage passthrough');

console.log(`OK — ${checks} assertions passed (admin web pure logic).`);
