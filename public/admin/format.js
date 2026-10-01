/**
 * Pure page logic for the admin dashboard: formatters, chart-series builders and callable-error
 * mapping. No DOM, no Firebase, no deps - imported by admin.js AND by the node test runner
 * scripts/admin-ui-tests.mjs (run: `node scripts/admin-ui-tests.mjs`). Keep it that way.
 */

/** Thousands-separated integer for table cells / exact readouts ('1,234,567'). */
export function formatInt(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString('en-US') : '0';
}

function trimmed(v, decimals) {
  return String(Number(v.toFixed(decimals)));
}

/** Auto-compact for tiles and axis ticks: 999 -> '999', 12900 -> '12.9K', 4200000 -> '4.2M'. */
export function formatCompact(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const abs = Math.abs(v);
  if (abs >= 999.5e6) return `${trimmed(v / 1e9, 1)}B`;
  if (abs >= 999.5e3) return `${trimmed(v / 1e6, 1)}M`;
  if (abs >= 999.5) return `${trimmed(v / 1e3, 1)}K`;
  return trimmed(v, 2);
}

/** USD tile: 4 decimals under a dollar (matches the server's rounding), 2 above. */
export function formatUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0.00';
  return `$${v >= 1 ? v.toFixed(2) : v.toFixed(4)}`;
}

/** Axis-tick format: integers compact, fractional quarter-ticks blank (gridline only). */
export function intTickFormat(v) {
  return Number.isInteger(v) ? formatCompact(v) : '';
}

/** ISO timestamp -> date part ('2026-10-01'); em dash when absent. */
export function dateOnly(iso) {
  return typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : '-';
}

/** ISO timestamp -> '2026-10-01 12:34 UTC'; em dash when absent. */
export function formatDateTime(iso) {
  return typeof iso === 'string' && iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '-';
}

// ---- Chart series builders (colorVar assignments are the docs/ADMIN.md §v2 contract) ---------

/** adminGetStats days[] -> single 'Requests' series (--chart-1). */
export function requestsSeries(days) {
  return [{ label: 'Requests', colorVar: '--chart-1', points: (days ?? []).map((d) => ({ x: d.date, y: d.requests })) }];
}

/** adminGetStats signups[] -> single 'Signups' series (--chart-5). */
export function signupsSeries(signups) {
  return [{ label: 'Signups', colorVar: '--chart-5', points: (signups ?? []).map((d) => ({ x: d.date, y: d.count })) }];
}

/** adminGetStats days[] -> stacked token series: Input (--chart-2) under Output (--chart-1). */
export function tokensSeries(days) {
  const source = days ?? [];
  return [
    { label: 'Input', colorVar: '--chart-2', points: source.map((d) => ({ x: d.date, y: d.inputTokens })) },
    { label: 'Output', colorVar: '--chart-1', points: source.map((d) => ({ x: d.date, y: d.outputTokens })) },
  ];
}

// ---- Visual pure helpers (v3 redesign: avatars, smooth chart paths, donut geometry) ----------

/** Stable 0..7 hue bucket for avatar classes (.av-0 ... .av-7): sum of char codes mod 8. */
export function avatarIndex(seed) {
  const s = String(seed ?? '');
  let sum = 0;
  for (let i = 0; i < s.length; i += 1) sum += s.charCodeAt(i);
  return sum % 8;
}

const r2 = (v) => String(Math.round(v * 100) / 100);

/**
 * Monotone-cubic SVG path through pixel points [{x, y}] (Fritsch-Carlson style tangents:
 * harmonic mean on same-sign neighbor slopes, 0 at local extrema), so the smooth curve never
 * overshoots the data values. Returns a path `d` string; '' for no points.
 */
export function monotonePath(points) {
  const pts = (points ?? [])
    .filter((p) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y)))
    .map((p) => ({ x: Number(p.x), y: Number(p.y) }));
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${r2(pts[0].x)},${r2(pts[0].y)}`;
  const slopes = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = pts[i + 1].x - pts[i].x;
    slopes.push(dx === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx);
  }
  const tangents = [slopes[0]];
  for (let i = 1; i < n - 1; i += 1) {
    const a = slopes[i - 1];
    const b = slopes[i];
    tangents.push(a * b <= 0 ? 0 : (2 * a * b) / (a + b));
  }
  tangents.push(slopes[n - 2]);
  let d = `M${r2(pts[0].x)},${r2(pts[0].y)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const third = (pts[i + 1].x - pts[i].x) / 3;
    d += `C${r2(pts[i].x + third)},${r2(pts[i].y + tangents[i] * third)}`
      + `,${r2(pts[i + 1].x - third)},${r2(pts[i + 1].y - tangents[i + 1] * third)}`
      + `,${r2(pts[i + 1].x)},${r2(pts[i + 1].y)}`;
  }
  return d;
}

/**
 * Donut ring geometry: values -> [{ frac, offset }] where frac is the segment's share of the
 * total and offset the cumulative share before it (both 0..1). Non-finite/negative values count
 * as 0; a zero total yields all-zero fracs (the renderer shows the empty track).
 */
export function donutSegments(values) {
  const nums = (values ?? []).map((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const total = nums.reduce((sum, v) => sum + v, 0);
  let acc = 0;
  return nums.map((v) => {
    const frac = total > 0 ? v / total : 0;
    const seg = { frac, offset: acc };
    acc += frac;
    return seg;
  });
}

// ---- Callable error mapping ------------------------------------------------------------------

/** 'functions/<code>' -> '<code>'; unknown shapes degrade to 'unknown'. */
export function callableErrorCode(error) {
  return typeof error?.code === 'string' ? error.code.replace(/^functions\//, '') : 'unknown';
}

export function callableErrorMessage(error) {
  const message = typeof error?.message === 'string' && error.message ? error.message : 'Unexpected error.';
  return `${message} (${callableErrorCode(error)})`;
}

/**
 * Error text for the v2 callables (adminGetStats/adminGetHealth/adminRotateOpenAiKey), which may
 * not be deployed yet: a 404 surfaces as 'not-found' (or as a bare 'internal' when the browser
 * never sees the response). Keep the message actionable instead of cryptic.
 */
export function v2ErrorMessage(error) {
  const code = callableErrorCode(error);
  if (code === 'not-found' || code === 'unimplemented') {
    return 'This function is not deployed yet - run "firebase deploy --only functions" and retry.';
  }
  const base = callableErrorMessage(error);
  if (code === 'internal') return `${base} - if the admin v2 functions were never deployed, deploy functions first.`;
  return base;
}

/**
 * Error rendering for the rotate-key card. Only PRE-store failures may claim "the previous key
 * is still active": an `aborted` error is the server's post-store signal (reason
 * stored_cleanup_failed) - the NEW key was stored and becomes active, and its verbatim message
 * must stand alone so the admin does not revoke the new key believing nothing changed.
 */
export function rotationErrorDisplay(error) {
  if (callableErrorCode(error) === 'aborted') {
    return { postStore: true, text: v2ErrorMessage(error) };
  }
  return { postStore: false, text: `Rotation failed - the previous key is still active. ${v2ErrorMessage(error)}` };
}
