/**
 * MeetingGuard AI admin — hand-rolled SVG chart renderer (admin v2; page spec: docs/ADMIN.md §v2).
 *
 * CONSTRAINTS (CSP in firebase.json /admin/**): no chart libraries, no extra CDNs, and style-src
 * is 'self', so NO style="" attributes — everything visual is SVG presentation attributes
 * (fill=, stroke=, font-size=), which CSP does not block. Colors resolve from CSS custom
 * properties (docs/DESIGN_SYSTEM.md chartPalette via admin.css) at render time, so the theme
 * stays the single source. No innerHTML anywhere; nodes come from document.createElementNS.
 *
 * The module top level is DOM-free on purpose: the pure helpers below are imported and tested by
 * scripts/admin-ui-tests.mjs under plain node (run: `node scripts/admin-ui-tests.mjs`).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
/** left pad fits 5-char y labels at 11px; bottom pad fits the "MM-DD" x-label band. */
const PAD = { top: 14, right: 14, bottom: 26, left: 48 };

// ---- Pure helpers (no DOM — unit-tested in scripts/admin-ui-tests.mjs) -----------------------

/** Smallest 1/2/5 × 10^k >= maxValue; 1 for empty/flat-zero data (never a degenerate 0 axis). */
export function niceMax(maxValue) {
  const v = Number(maxValue);
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  for (const m of [1, 2, 5]) {
    const candidate = m * 10 ** exp;
    if (candidate >= v) return candidate;
  }
  return 10 ** (exp + 1);
}

/** The 4 gridline values of a 0..top axis (quarters, top included; 0 is the baseline). */
export function tickValues(top) {
  return [1, 2, 3, 4].map((i) => (top * i) / 4);
}

/** Label every Nth category so at most ~maxLabels show. */
export function labelStep(count, maxLabels = 8) {
  return count > 0 ? Math.max(1, Math.ceil(count / maxLabels)) : 1;
}

/** 'yyyy-mm-dd' -> 'MM-DD' (x-axis labels drop the year). */
export function shortDate(iso) {
  return typeof iso === 'string' && iso.length >= 10 ? iso.slice(5, 10) : String(iso);
}

/** Max single y across all series (line charts, grouped bars). */
export function seriesMax(series) {
  let max = 0;
  for (const s of series) for (const p of s.points) if (p.y > max) max = p.y;
  return max;
}

/** Max per-category SUM across series (stacked bars). Series share the same x order. */
export function stackMax(series) {
  const count = series[0]?.points.length ?? 0;
  let max = 0;
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (const s of series) sum += s.points[i]?.y ?? 0;
    if (sum > max) max = sum;
  }
  return max;
}

// ---- DOM bits --------------------------------------------------------------------------------

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function cssColor(varName) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || 'currentColor';
}

const fmtVal = (v) => Number(v ?? 0).toLocaleString('en-US');

/** Axes, gridlines and labels; returns the scales the mark painters draw with. */
function frame(container, series, options, maxValue) {
  const width = container.clientWidth || 640; // hidden tab => clientWidth 0; render at a default
  const height = options.height || 220;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const categories = (series[0]?.points ?? []).map((p) => p.x);
  const n = categories.length;
  const top = niceMax(maxValue);
  const x = (i) => PAD.left + ((i + 0.5) * plotW) / Math.max(1, n); // category band centers
  const y = (v) => PAD.top + plotH - (v / top) * plotH;
  const muted = cssColor('--text-muted');
  const border = cssColor('--border');
  const yFormat = options.yFormat || ((v) => String(v));

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': options.ariaLabel || 'Chart',
  });
  for (const t of [0, ...tickValues(top)]) {
    const gy = y(t);
    svg.appendChild(svgEl('line', { x1: PAD.left, x2: width - PAD.right, y1: gy, y2: gy, stroke: border, 'stroke-width': 1 }));
    const text = yFormat(t);
    if (text !== '') {
      const label = svgEl('text', { x: PAD.left - 8, y: gy + 4, 'text-anchor': 'end', 'font-size': 11, fill: muted });
      label.textContent = text;
      svg.appendChild(label);
    }
  }
  const step = labelStep(n);
  categories.forEach((date, i) => {
    if (i % step !== 0) return;
    const label = svgEl('text', { x: x(i), y: height - 8, 'text-anchor': 'middle', 'font-size': 11, fill: muted });
    label.textContent = shortDate(date);
    svg.appendChild(label);
  });
  return { svg, x, y, width, height, plotW, plotH, categories, n, top, muted };
}

/** Full-height transparent hover column per category: fat native-tooltip targets (<title>). */
function finishFrame(container, series, options, f) {
  const bandW = f.plotW / Math.max(1, f.n);
  f.categories.forEach((date, i) => {
    const rect = svgEl('rect', { x: PAD.left + i * bandW, y: PAD.top, width: bandW, height: f.plotH, fill: 'transparent' });
    const title = svgEl('title');
    title.textContent = series.length === 1
      ? `${date} — ${fmtVal(series[0].points[i]?.y)} ${series[0].label.toLowerCase()}`
      : `${date} — ${series.map((s) => `${s.label}: ${fmtVal(s.points[i]?.y)}`).join(' · ')}`;
    rect.appendChild(title);
    f.svg.appendChild(rect);
  });
  if (!series.some((s) => s.points.some((p) => p.y > 0))) {
    const empty = svgEl('text', { x: f.width / 2, y: PAD.top + f.plotH / 2 + 4, 'text-anchor': 'middle', 'font-size': 13, fill: f.muted });
    empty.textContent = 'No data yet';
    f.svg.appendChild(empty);
  }
  container.replaceChildren(f.svg, srTable(series, options, f.categories));
}

/** Visually-hidden data twin: every value stays reachable without hover or color vision. */
function srTable(series, options, categories) {
  const table = document.createElement('table');
  table.className = 'sr-only';
  const caption = document.createElement('caption');
  caption.textContent = options.ariaLabel || 'Chart data';
  table.appendChild(caption);
  const head = table.createTHead().insertRow();
  for (const text of ['Date', ...series.map((s) => s.label)]) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = text;
    head.appendChild(th);
  }
  const body = table.createTBody();
  categories.forEach((date, i) => {
    const row = body.insertRow();
    row.insertCell().textContent = date;
    for (const s of series) row.insertCell().textContent = String(s.points[i]?.y ?? 0);
  });
  return table;
}

// ---- Renderers -------------------------------------------------------------------------------

/**
 * series: [{ label, points: [{ x: 'yyyy-mm-dd', y: number }], colorVar: '--chart-1' }]
 * options: { area?: boolean, height?: number (220), yFormat?: (n) => string, ariaLabel?: string }
 */
export function renderLineChart(container, series, options = {}) {
  const f = frame(container, series, options, seriesMax(series));
  const surface = cssColor('--surface');
  for (const s of series) {
    const color = cssColor(s.colorVar);
    const pts = s.points.map((p, i) => `${f.x(i)},${f.y(p.y)}`);
    if (options.area && s.points.length > 1) {
      const base = f.y(0);
      const ring = [...pts, `${f.x(s.points.length - 1)},${base}`, `${f.x(0)},${base}`];
      f.svg.appendChild(svgEl('polygon', { points: ring.join(' '), fill: color, 'fill-opacity': 0.12 }));
    }
    if (s.points.length > 1) {
      f.svg.appendChild(svgEl('polyline', {
        points: pts.join(' '), fill: 'none', stroke: color,
        'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
    }
    const last = s.points.length - 1;
    if (last >= 0) { // end marker with a surface ring so it stays legible on the line
      f.svg.appendChild(svgEl('circle', { cx: f.x(last), cy: f.y(s.points[last].y), r: 4, fill: color, stroke: surface, 'stroke-width': 2 }));
    }
  }
  finishFrame(container, series, options, f);
}

/** Same series/options shape; options.stacked true = stacked (tokens), false = grouped. */
export function renderBarChart(container, series, options = {}) {
  const stacked = options.stacked === true;
  const f = frame(container, series, options, stacked ? stackMax(series) : seriesMax(series));
  const bandW = f.plotW / Math.max(1, f.n);
  const barW = Math.min(24, Math.max(2, bandW * 0.6));
  for (let i = 0; i < f.n; i++) {
    let yCursor = f.y(0);
    series.forEach((s, si) => {
      const v = s.points[i]?.y ?? 0;
      if (v <= 0) return;
      const hPx = (v / f.top) * f.plotH;
      let rect;
      if (stacked) {
        // 2px surface gap between touching segments (shaved off the upper segment's bottom).
        const gap = yCursor < f.y(0) ? 2 : 0;
        rect = svgEl('rect', { x: f.x(i) - barW / 2, y: yCursor - hPx, width: barW, height: Math.max(0, hPx - gap), fill: cssColor(s.colorVar) });
        yCursor -= hPx;
      } else {
        const slotW = barW / series.length;
        rect = svgEl('rect', { x: f.x(i) - barW / 2 + si * slotW, y: f.y(v), width: Math.max(1, slotW - (series.length > 1 ? 2 : 0)), height: hPx, fill: cssColor(s.colorVar) });
      }
      const title = svgEl('title');
      title.textContent = `${f.categories[i]} — ${s.label}: ${fmtVal(v)}`;
      rect.appendChild(title);
      f.svg.appendChild(rect);
    });
  }
  finishFrame(container, series, options, f);
}
