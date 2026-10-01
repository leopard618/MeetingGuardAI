#!/usr/bin/env node
/**
 * Pure-logic tests for the admin dashboard web app (public/admin/): chart tick math and the
 * formatters/series builders. No DOM, no network, no deps - plain `node:assert`.
 *
 *   Run:  node scripts/admin-ui-tests.mjs        (from the repo root; any cwd works)
 *
 * The admin web app is build-free, so this script is wired into nothing; run it after touching
 * public/admin/chart.js or public/admin/format.js. Importing chart.js here also proves its
 * module top level stays DOM-free (a regression would throw on import).
 */
import assert from 'node:assert/strict';

import { isLabeledIndex, labelStep, niceMax, seriesMax, shortDate, stackMax, tickValues } from '../public/admin/chart.js';
import {
  avatarIndex,
  callableErrorMessage,
  dateOnly,
  donutSegments,
  formatCompact,
  formatDateTime,
  formatInt,
  formatUsd,
  intTickFormat,
  monotonePath,
  requestsSeries,
  rotationErrorDisplay,
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

// ---- isLabeledIndex: x labels anchor to the NEWEST point (today always labeled) --------------
for (const n of [7, 14, 30, 90]) {
  eq(isLabeledIndex(n - 1, n, labelStep(n)), true, `isLabeledIndex: today labeled at n=${n}`);
}
// n=90, step 12: labels walk back from index 89 (89, 77, 65, ...); index 0 is unlabeled.
eq(isLabeledIndex(77, 90, 12), true, 'isLabeledIndex(77, 90, 12)');
eq(isLabeledIndex(84, 90, 12), false, 'isLabeledIndex(84, 90, 12): the OLD anchor-0 label');
eq(isLabeledIndex(0, 90, 12), false, 'isLabeledIndex(0, 90, 12)');
// n=30, step 4: 29, 25, 21, ... (28 - yesterday's predecessor under the old anchor - is not).
eq(isLabeledIndex(25, 30, 4), true, 'isLabeledIndex(25, 30, 4)');
eq(isLabeledIndex(28, 30, 4), false, 'isLabeledIndex(28, 30, 4)');
// step 1 labels everything.
eq([0, 1, 2].every((i) => isLabeledIndex(i, 3, 1)), true, 'isLabeledIndex: step 1 labels all');

// ---- shortDate / dateOnly / formatDateTime ---------------------------------------------------
eq(shortDate('2026-10-01'), '10-01', 'shortDate');
eq(shortDate(5), '5', 'shortDate non-string');
eq(dateOnly('2026-10-01T12:34:56.000Z'), '2026-10-01', 'dateOnly');
eq(dateOnly(null), '-', 'dateOnly null');
eq(formatDateTime('2026-10-01T12:34:56.000Z'), '2026-10-01 12:34 UTC', 'formatDateTime');
eq(formatDateTime(null), '-', 'formatDateTime null');

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

// ---- rotationErrorDisplay: "previous key still active" ONLY on pre-store failures ------------
const preStore = rotationErrorDisplay({ code: 'functions/failed-precondition', message: 'OpenAI rejected this key (HTTP 401). Nothing was changed.' });
eq(preStore.postStore, false, 'rotationErrorDisplay: failed-precondition is pre-store');
assert.match(preStore.text, /previous key is still active/, 'rotationErrorDisplay: pre-store claims old key active');
checks += 1;
const cleanup = rotationErrorDisplay({ code: 'functions/aborted', message: 'The new key WAS stored as Secret Manager version 6 and becomes active everywhere within ~5 minutes, but disabling the prior versions failed.' });
eq(cleanup.postStore, true, 'rotationErrorDisplay: aborted is post-store');
assert.doesNotMatch(cleanup.text, /previous key is still active/, 'rotationErrorDisplay: post-store never claims old key active');
checks += 1;
assert.match(cleanup.text, /WAS stored as Secret Manager version 6/, 'rotationErrorDisplay: post-store keeps the server message verbatim');
checks += 1;
const unreachable = rotationErrorDisplay({ code: 'functions/unavailable', message: 'OpenAI could not be reached to validate the key. Nothing was changed.' });
eq(unreachable.postStore, false, 'rotationErrorDisplay: unavailable is pre-store');

// ---- avatarIndex: stable 0..7 hue bucket (sum of char codes mod 8) ---------------------------
eq(avatarIndex(''), 0, 'avatarIndex empty');
eq(avatarIndex(null), 0, 'avatarIndex null');
eq(avatarIndex('a'), 1, 'avatarIndex("a") = 97 % 8');
eq(avatarIndex('abc'), 6, 'avatarIndex("abc") = 294 % 8');
eq(avatarIndex('uid123'), 0, 'avatarIndex("uid123") = 472 % 8');
eq(avatarIndex('abc'), avatarIndex('abc'), 'avatarIndex is stable for a given seed');

// ---- monotonePath: monotone-cubic d strings (2-decimal rounding) -----------------------------
eq(monotonePath([]), '', 'monotonePath no points');
eq(monotonePath(undefined), '', 'monotonePath undefined');
eq(monotonePath([{ x: 0, y: 10 }]), 'M0,10', 'monotonePath single point');
eq(monotonePath([{ x: 0, y: 0 }, { x: 10, y: 10 }]),
  'M0,0C3.33,3.33,6.67,6.67,10,10', 'monotonePath straight segment');
eq(monotonePath([{ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 20, y: 5 }]),
  'M0,5C3.33,5,6.67,5,10,5C13.33,5,16.67,5,20,5', 'monotonePath flat line stays flat');
// Local extremum gets a 0 tangent, so the curve never overshoots the peak value.
eq(monotonePath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]),
  'M0,0C3.33,3.33,6.67,10,10,10C13.33,10,16.67,3.33,20,0', 'monotonePath peak: no overshoot');
eq(monotonePath([{ x: 0, y: NaN }, { x: 5, y: 2 }]), 'M5,2', 'monotonePath drops non-finite points');

// ---- donutSegments: fractions + cumulative offsets -------------------------------------------
eq(donutSegments([1, 1, 2]), [
  { frac: 0.25, offset: 0 },
  { frac: 0.25, offset: 0.25 },
  { frac: 0.5, offset: 0.5 },
], 'donutSegments quarters');
eq(donutSegments([2, 1, 1]), [
  { frac: 0.5, offset: 0 },
  { frac: 0.25, offset: 0.5 },
  { frac: 0.25, offset: 0.75 },
], 'donutSegments order preserved');
eq(donutSegments([5]), [{ frac: 1, offset: 0 }], 'donutSegments single segment');
eq(donutSegments([0, 0]), [{ frac: 0, offset: 0 }, { frac: 0, offset: 0 }], 'donutSegments zero total');
eq(donutSegments([]), [], 'donutSegments empty');
eq(donutSegments([3, -2, NaN, 1]), [
  { frac: 0.75, offset: 0 },
  { frac: 0, offset: 0.75 },
  { frac: 0, offset: 0.75 },
  { frac: 0.25, offset: 0.75 },
], 'donutSegments ignores negative/non-finite values');

process.stdout.write(`OK - ${checks} assertions passed (admin web pure logic).
`);
