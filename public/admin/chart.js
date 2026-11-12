/**
 * Meeting Guard AI admin - hand-rolled SVG chart renderer (admin v3 visual pass; docs/ADMIN.md).
 *
 * CONSTRAINTS (CSP in firebase.json /admin/**): no chart libraries, no extra CDNs, and style-src
 * is 'self', so NO style="" attributes anywhere - everything visual is SVG presentation
 * attributes (fill=, stroke=, font-size=) plus CSS classes; the floating tooltip is positioned
 * through CSSOM property assignments (tip.style.left = ...), which CSP does not block (only the
 * style="" ATTRIBUTE is). No innerHTML anywhere; nodes come from document.createElementNS.
 *
 * The module top level is DOM-free on purpose: the pure helpers below are imported and tested by
 * scripts/admin-ui-tests.mjs under plain node (run: `node scripts/admin-ui-tests.mjs`).
 * monotonePath/donutSegments (also pure, also tested) live in ./format.js and are imported here.
 */

import { donutSegments, monotonePath } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** left pad fits 5-char y labels at 11px; bottom pad fits the "MM-DD" x-label band. */
const PAD = { top: 14, right: 14, bottom: 26, left: 48 };

/** Brand gradient stops (admin.css --grad-brand twin; tokens.ts indigo ramp). */
const GRAD_FROM = '#6A6BE8';
const GRAD_TO = '#A77BFA';
const AREA_TINT = '#8F94F3';
const GRID_STROKE = 'rgba(255,255,255,0.06)';
const AXIS_FILL = 'rgba(231,237,246,0.55)';
const CROSSHAIR_STROKE = 'rgba(175,180,255,0.25)';

// ---- Pure helpers (no DOM - unit-tested in scripts/admin-ui-tests.mjs) -----------------------

/** Smallest 1/2/5 x 10^k >= maxValue; 1 for empty/flat-zero data (never a degenerate 0 axis). */
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

/**
 * Whether category index i (of n) gets an x label: anchored to the NEWEST point, so today
 * (index n-1) is always labeled and the step walks backwards. Anchoring at index 0 would leave
 * the rightmost - most-read - days unlabeled (e.g. the last labeled date 6 days old at n=90).
 */
export function isLabeledIndex(i, n, step) {
  return (n - 1 - i) % step === 0;
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

/** Unique per-render <defs> ids so several charts on one page never share gradients. */
let gradSeq = 0;

/** Brand line + vertical area gradients; returns their url() references. */
function brandDefs(svg) {
  gradSeq += 1;
  const defs = svgEl('defs');
  const line = svgEl('linearGradient', { id: `grad-line-${gradSeq}`, x1: 0, y1: 0, x2: 1, y2: 0 });
  line.appendChild(svgEl('stop', { offset: '0%', 'stop-color': GRAD_FROM }));
  line.appendChild(svgEl('stop', { offset: '100%', 'stop-color': GRAD_TO }));
  const area = svgEl('linearGradient', { id: `grad-area-${gradSeq}`, x1: 0, y1: 0, x2: 0, y2: 1 });
  area.appendChild(svgEl('stop', { offset: '0%', 'stop-color': AREA_TINT, 'stop-opacity': 0.18 }));
  area.appendChild(svgEl('stop', { offset: '100%', 'stop-color': AREA_TINT, 'stop-opacity': 0 }));
  defs.append(line, area);
  svg.appendChild(defs);
  return { line: `url(#grad-line-${gradSeq})`, area: `url(#grad-area-${gradSeq})` };
}

/** Should mount animations run? (JS twin of the reduced-motion CSS guard.) */
function motionOk() {
  return typeof matchMedia !== 'function' || !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Axes, gridlines and labels; returns the scales the mark painters draw with. */
function frame(container, series, options, maxValue) {
  // admin.js defers drawing while the container is hidden (clientWidth 0) and repaints on
  // resize; the 640 fallback is only a belt for a direct call against a hidden node.
  const width = container.clientWidth || 640;
  const height = options.height || 220;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const categories = (series[0]?.points ?? []).map((p) => p.x);
  const n = categories.length;
  const top = niceMax(maxValue);
  const x = (i) => PAD.left + ((i + 0.5) * plotW) / Math.max(1, n); // category band centers
  const y = (v) => PAD.top + plotH - (v / top) * plotH;
  const yFormat = options.yFormat || ((v) => String(v));
  const firstPaint = !container.querySelector('svg'); // repaints (resize) do not re-animate

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': options.ariaLabel || 'Chart',
  });
  if (firstPaint && motionOk()) svg.setAttribute('class', 'chart-anim');
  // Horizontal gridlines only (dashed hairlines, no axis frame); 0 stays a solid baseline.
  for (const t of [0, ...tickValues(top)]) {
    const gy = y(t);
    const attrs = { x1: PAD.left, x2: width - PAD.right, y1: gy, y2: gy, stroke: GRID_STROKE, 'stroke-width': 1 };
    if (t !== 0) attrs['stroke-dasharray'] = '3 4';
    svg.appendChild(svgEl('line', attrs));
    const text = yFormat(t);
    if (text !== '') {
      const label = svgEl('text', { x: PAD.left - 8, y: gy + 4, 'text-anchor': 'end', 'font-size': 11, fill: AXIS_FILL, class: 'num' });
      label.textContent = text;
      svg.appendChild(label);
    }
  }
  const step = labelStep(n);
  categories.forEach((date, i) => {
    if (!isLabeledIndex(i, n, step)) return;
    const label = svgEl('text', { x: x(i), y: height - 8, 'text-anchor': 'middle', 'font-size': 11, fill: AXIS_FILL, class: 'num' });
    label.textContent = shortDate(date);
    svg.appendChild(label);
  });
  return { svg, x, y, width, height, plotW, plotH, categories, n, top };
}

/**
 * Hover layer: per-band transparent rects (fat targets, keep the native <title> fallback) plus
 * a vertical crosshair, per-series dots and ONE shared floating div#chart-tip (L3 card in
 * admin.css). The tip is positioned with CSSOM assignments only - never a style attribute.
 */
function finishFrame(container, series, options, f, hover = {}) {
  const bandW = f.plotW / Math.max(1, f.n);
  const tip = document.getElementById('chart-tip');

  const crosshair = svgEl('line', {
    y1: PAD.top, y2: PAD.top + f.plotH, x1: 0, x2: 0,
    stroke: CROSSHAIR_STROKE, 'stroke-width': 1, visibility: 'hidden', 'pointer-events': 'none',
  });
  f.svg.appendChild(crosshair);
  const dots = (hover.dots ? series : []).map((s, si) => {
    const dot = svgEl('circle', {
      r: 4, fill: hover.dotColors?.[si] || cssColor(s.colorVar), stroke: cssColor('--surface'),
      'stroke-width': 2, visibility: 'hidden', 'pointer-events': 'none',
    });
    f.svg.appendChild(dot);
    return dot;
  });

  const hideHover = () => {
    crosshair.setAttribute('visibility', 'hidden');
    for (const dot of dots) dot.setAttribute('visibility', 'hidden');
    if (tip) tip.hidden = true;
  };

  const showTip = (i, rect) => {
    crosshair.setAttribute('x1', f.x(i));
    crosshair.setAttribute('x2', f.x(i));
    crosshair.setAttribute('visibility', 'visible');
    dots.forEach((dot, si) => {
      const v = series[si].points[i]?.y;
      if (v === undefined) { dot.setAttribute('visibility', 'hidden'); return; }
      dot.setAttribute('cx', f.x(i));
      dot.setAttribute('cy', f.y(v));
      dot.setAttribute('visibility', 'visible');
    });
    if (!tip) return;
    const date = document.createElement('div');
    date.className = 'tip-date';
    date.textContent = f.categories[i];
    const rows = series.map((s, si) => {
      const row = document.createElement('div');
      row.className = 'tip-row';
      const swatch = document.createElement('span');
      swatch.className = 'tip-swatch';
      swatch.style.backgroundColor = hover.dotColors?.[si] || cssColor(s.colorVar); // CSSOM, CSP-safe
      const label = document.createElement('span');
      label.className = 'tip-label';
      label.textContent = s.label;
      const value = document.createElement('span');
      value.className = 'tip-value num';
      value.textContent = fmtVal(s.points[i]?.y);
      row.append(swatch, label, value);
      return row;
    });
    tip.replaceChildren(date, ...rows);
    tip.hidden = false;
    const box = rect.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const flip = window.innerWidth - centerX < 180;
    const left = flip ? centerX - 12 - tip.offsetWidth : centerX + 12;
    const top = box.top + 12;
    // Clamp to the viewport: the flip heuristic alone cannot hold a 240px-wide tip on narrow
    // screens, and a chart near the bottom would push the fixed tip below the fold.
    const maxL = window.innerWidth - tip.offsetWidth - 8;
    const maxT = window.innerHeight - tip.offsetHeight - 8;
    tip.style.left = `${Math.round(Math.min(Math.max(8, left), maxL))}px`;
    tip.style.top = `${Math.round(Math.min(Math.max(8, top), maxT))}px`;
  };

  f.categories.forEach((date, i) => {
    const rect = svgEl('rect', { x: PAD.left + i * bandW, y: PAD.top, width: bandW, height: f.plotH, fill: 'transparent' });
    const title = svgEl('title');
    title.textContent = series.length === 1
      ? `${date} - ${fmtVal(series[0].points[i]?.y)} ${series[0].label.toLowerCase()}`
      : `${date} - ${series.map((s) => `${s.label}: ${fmtVal(s.points[i]?.y)}`).join(' · ')}`;
    rect.appendChild(title);
    rect.addEventListener('mouseenter', () => showTip(i, rect));
    f.svg.appendChild(rect);
  });
  f.svg.addEventListener('mouseleave', hideHover);

  if (!series.some((s) => s.points.some((p) => p.y > 0))) {
    const empty = svgEl('text', { x: f.width / 2, y: PAD.top + f.plotH / 2 + 4, 'text-anchor': 'middle', 'font-size': 13, fill: AXIS_FILL });
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
 * The FIRST series draws with the brand gradient stroke; extra series fall back to colorVar.
 */
export function renderLineChart(container, series, options = {}) {
  const f = frame(container, series, options, seriesMax(series));
  const grads = brandDefs(f.svg);
  const dotColors = [];
  series.forEach((s, si) => {
    const stroke = si === 0 ? grads.line : cssColor(s.colorVar);
    dotColors.push(si === 0 ? GRAD_TO : cssColor(s.colorVar));
    const pts = s.points.map((p, i) => ({ x: f.x(i), y: f.y(p.y) }));
    const d = monotonePath(pts);
    if (s.points.length > 1) {
      if (options.area !== false) {
        const base = f.y(0);
        const areaD = `${d}L${pts[pts.length - 1].x},${base}L${pts[0].x},${base}Z`;
        f.svg.appendChild(svgEl('path', { d: areaD, fill: grads.area, class: 'mark-area', 'pointer-events': 'none' }));
      }
      f.svg.appendChild(svgEl('path', {
        d, fill: 'none', stroke, 'stroke-width': 2, class: 'mark-line',
        'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'pointer-events': 'none',
      }));
    }
    const last = s.points.length - 1;
    if (last >= 0) { // end marker with a surface ring so it stays legible on the line
      f.svg.appendChild(svgEl('circle', {
        cx: f.x(last), cy: f.y(s.points[last].y), r: 4,
        fill: dotColors[si], stroke: cssColor('--surface'), 'stroke-width': 2,
      }));
    }
  });
  finishFrame(container, series, options, f, { dots: true, dotColors });
}

/** Same series/options shape; options.stacked true = stacked (tokens), false = grouped. */
export function renderBarChart(container, series, options = {}) {
  const stacked = options.stacked === true;
  const f = frame(container, series, options, stacked ? stackMax(series) : seriesMax(series));
  const bandW = f.plotW / Math.max(1, f.n);
  const barW = Math.min(22, Math.max(2, bandW * 0.62));
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
        const h = Math.max(0, hPx - gap);
        rect = svgEl('rect', {
          x: f.x(i) - barW / 2, y: yCursor - hPx, width: barW, height: h,
          fill: cssColor(s.colorVar), rx: h > 6 ? 3 : 0,
        });
        yCursor -= hPx;
      } else {
        const slotW = barW / series.length;
        rect = svgEl('rect', {
          x: f.x(i) - barW / 2 + si * slotW, y: f.y(v),
          width: Math.max(1, slotW - (series.length > 1 ? 2 : 0)), height: hPx,
          fill: cssColor(s.colorVar), rx: hPx > 6 ? 3 : 0,
        });
      }
      rect.setAttribute('class', `mark-bar d${i % 12}`);
      const title = svgEl('title');
      title.textContent = `${f.categories[i]} - ${s.label}: ${fmtVal(v)}`;
      rect.appendChild(title);
      f.svg.appendChild(rect);
    });
  }
  finishFrame(container, series, options, f, { dots: false });
}

/**
 * Donut / ring chart (Overview plan distribution).
 * segments: [{ label, value, colorVar?: '--chart-6', gradient?: true }] - gradient uses the
 * brand gradient stroke. options: { total?: number (center numeral; defaults to the value sum),
 * centerLabel?: string, ariaLabel?: string }. Legend renders as an HTML list beside the ring.
 */
export function renderDonutChart(container, segments, options = {}) {
  const size = 220;
  const cx = size / 2;
  const r = 70;
  const circumference = 2 * Math.PI * r;
  const values = segments.map((s) => s.value);
  const geometry = donutSegments(values);
  const visible = geometry.filter((g) => g.frac > 0).length;
  const gapPx = visible > 1 ? circumference * (2 / 360) : 0;
  const total = options.total ?? values.reduce((sum, v) => sum + (Number(v) || 0), 0);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${size} ${size}`, role: 'img', class: 'donut-svg',
    'aria-label': options.ariaLabel || 'Distribution',
  });
  gradSeq += 1;
  const defs = svgEl('defs');
  const grad = svgEl('linearGradient', { id: `grad-donut-${gradSeq}`, x1: 0, y1: 0, x2: 1, y2: 1 });
  grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': GRAD_FROM }));
  grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': GRAD_TO }));
  defs.appendChild(grad);
  svg.appendChild(defs);
  // Full track ring behind the segments (also the whole visual when there is no data yet).
  svg.appendChild(svgEl('circle', { cx, cy: cx, r, fill: 'none', stroke: 'rgba(154,163,255,0.10)', 'stroke-width': 16 }));
  segments.forEach((segment, i) => {
    const { frac, offset } = geometry[i];
    if (frac <= 0) return;
    const dash = Math.max(0.5, frac * circumference - gapPx);
    const circle = svgEl('circle', {
      cx, cy: cx, r, fill: 'none',
      stroke: segment.gradient ? `url(#grad-donut-${gradSeq})` : cssColor(segment.colorVar),
      'stroke-width': 16,
      'stroke-dasharray': `${dash} ${circumference - dash}`,
      'stroke-dashoffset': -(offset * circumference + gapPx / 2),
      transform: `rotate(-90 ${cx} ${cx})`,
    });
    const title = svgEl('title');
    title.textContent = `${segment.label}: ${fmtVal(segment.value)}`;
    circle.appendChild(title);
    svg.appendChild(circle);
  });
  const centerValue = svgEl('text', {
    x: cx, y: cx + 2, 'text-anchor': 'middle', 'font-size': 26, 'font-weight': 650,
    fill: cssColor('--text'), class: 'num',
  });
  centerValue.textContent = fmtVal(total);
  svg.appendChild(centerValue);
  const centerLabel = svgEl('text', {
    x: cx, y: cx + 22, 'text-anchor': 'middle', 'font-size': 11, fill: cssColor('--text-3'),
  });
  centerLabel.textContent = options.centerLabel || 'total';
  svg.appendChild(centerLabel);

  const legend = document.createElement('ul');
  legend.className = 'donut-legend';
  for (const segment of segments) {
    const item = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = segment.gradient ? 'swatch swatch-grad' : 'swatch';
    if (!segment.gradient) swatch.style.backgroundColor = cssColor(segment.colorVar); // CSSOM, CSP-safe
    swatch.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'legend-label';
    label.textContent = segment.label;
    const value = document.createElement('span');
    value.className = 'legend-value num';
    value.textContent = fmtVal(segment.value);
    item.append(swatch, label, value);
    legend.appendChild(item);
  }
  const wrap = document.createElement('div');
  wrap.className = 'donut-wrap';
  wrap.append(svg, legend);
  container.replaceChildren(wrap);
}

/**
 * Tiny decorative sparkline for stat tiles: brand-gradient monotone curve with a faint area
 * fill, no axes, aria-hidden (the tile's numeral carries the value). values: number[].
 */
export function renderSparkline(container, values, options = {}) {
  const vals = (values ?? []).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
  const w = 120;
  const h = options.height || 36;
  const pad = 3;
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', class: 'spark-svg' });
  if (vals.length >= 2) {
    const max = Math.max(1, ...vals);
    const n = vals.length;
    const pts = vals.map((v, i) => ({
      x: pad + (i * (w - pad * 2)) / (n - 1),
      y: pad + (h - pad * 2) * (1 - v / max),
    }));
    const d = monotonePath(pts);
    const grads = brandDefs(svg);
    svg.appendChild(svgEl('path', {
      d: `${d}L${pts[n - 1].x},${h - pad}L${pts[0].x},${h - pad}Z`, fill: grads.area,
    }));
    svg.appendChild(svgEl('path', {
      d, fill: 'none', stroke: grads.line, 'stroke-width': 1.5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke',
    }));
  }
  container.replaceChildren(svg);
}
