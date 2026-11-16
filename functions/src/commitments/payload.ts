/**
 * What the model may cite (docs/v2/M11-DESIGN.md section 2.2): the items and the prose sections of
 * one summary, inside ONE character budget. PURE. The prompt builder serializes this; verify.ts
 * accepts only anchors that are in it (section 2.4 check 1), so a model can never cite what it was
 * not shown.
 *
 * Rules:
 * - Items: every item of a non-derived section (tldr and summary are never sent: the TLDR is no
 *   ground truth), except checked ones ("[x]", already done). At most maxItems; over the cap the
 *   action-list kinds (action_items, next_steps, waiting_on) go first, then document order.
 * - Prose: sections that are not derived, not the preamble and have no items, as the text below
 *   their heading line. Sentence anchors come only from these.
 * - ONE budget, maxChars, for item texts, headings and prose together, filled in that priority
 *   (action-list items, other items, prose in document order); an item that does not fit ends the
 *   item list, a prose section that does not fit is cut at its last line boundary that fits.
 * - truncated: the text was cut at receipt, or something did not fit here.
 * The result is in document order.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import type { SectionKind, SummarySection } from '../summaries/sections';

/** Section 2.1 COMMITMENTS_TUNING defaults (config.ts carries the deployed values). */
export const DEFAULT_MODEL_INPUT_LIMITS = { maxItems: 150, maxChars: 60_000 } as const;

export interface ModelInputLimits {
  maxItems: number;
  maxChars: number;
}

/** The section kinds whose items are promises by layout. */
export const ACTION_LIST_KINDS: ReadonlySet<SectionKind> = new Set<SectionKind>(['action_items', 'next_steps', 'waiting_on']);

export interface ModelInputItem {
  /** The summary item id ("i_" + 12 hex): the anchor the model cites. */
  id: string;
  sectionId: string;
  sectionKind: SectionKind;
  heading: string | null;
  /** Verbatim: text.slice(start, end). */
  text: string;
  start: number;
  end: number;
  owner: string | null;
  dueText: string | null;
}

export interface ModelInputProse {
  /** The section id ("s_" + 12 hex): the anchor the model cites for a sentence. */
  id: string;
  kind: SectionKind;
  heading: string | null;
  /** What was sent: text.slice(start, end), the part below the heading line (cut when over budget). */
  text: string;
  start: number;
  end: number;
}

export interface ModelInput {
  items: ModelInputItem[];
  prose: ModelInputProse[];
  truncated: boolean;
  /** Characters spent of the budget. */
  chars: number;
}

/** Where a section's body starts: the line after its heading (the section start when it has none). */
export function sectionBodyStart(text: string, section: Pick<SummarySection, 'start' | 'end' | 'heading'>): number {
  let at = section.start;
  if (section.heading !== null) {
    const newline = text.indexOf('\n', section.start);
    at = newline === -1 || newline >= section.end ? section.end : newline + 1;
  }
  while (at < section.end && /\s/.test(text[at] ?? '')) at += 1;
  return at;
}

/** Selects the model's input (see the module comment). Never throws. */
export function selectModelInput(
  text: string,
  sections: readonly SummarySection[],
  limits: ModelInputLimits = DEFAULT_MODEL_INPUT_LIMITS,
  truncatedAtReceipt = false,
): ModelInput {
  const maxItems = Math.max(0, Math.floor(limits.maxItems));
  const maxChars = Math.max(0, Math.floor(limits.maxChars));
  let truncated = truncatedAtReceipt;
  let chars = 0;

  const eligible: { item: ModelInputItem; order: number }[] = [];
  let order = 0;
  for (const section of sections) {
    if (section.derived) continue;
    for (const item of section.items) {
      order += 1;
      if (item.checked === true) continue;
      if (text.slice(item.start, item.end) !== item.text) continue;
      eligible.push({
        order,
        item: {
          id: item.id,
          sectionId: section.id,
          sectionKind: section.kind,
          heading: section.heading,
          text: item.text,
          start: item.start,
          end: item.end,
          owner: item.owner,
          dueText: item.dueText,
        },
      });
    }
  }
  const byPriority = [...eligible].sort(
    (a, b) => Number(!ACTION_LIST_KINDS.has(a.item.sectionKind)) - Number(!ACTION_LIST_KINDS.has(b.item.sectionKind)) || a.order - b.order,
  );
  const chosen: { item: ModelInputItem; order: number }[] = [];
  for (const entry of byPriority) {
    const cost = entry.item.text.length + (entry.item.heading?.length ?? 0);
    if (chosen.length >= maxItems || chars + cost > maxChars) {
      truncated = true;
      break;
    }
    chosen.push(entry);
    chars += cost;
  }
  const items = chosen.sort((a, b) => a.order - b.order).map((entry) => entry.item);

  const prose: ModelInputProse[] = [];
  for (const section of sections) {
    if (section.derived || section.kind === 'preamble' || section.items.length > 0) continue;
    const start = sectionBodyStart(text, section);
    const end = section.end;
    if (start >= end) continue;
    const headingCost = section.heading?.length ?? 0;
    const room = maxChars - chars - headingCost;
    if (end - start <= room) {
      prose.push({ id: section.id, kind: section.kind, heading: section.heading, text: text.slice(start, end), start, end });
      chars += headingCost + (end - start);
      continue;
    }
    truncated = true;
    if (room > 0) {
      const cut = text.lastIndexOf('\n', start + room);
      const cutEnd = cut > start ? start + text.slice(start, cut).trimEnd().length : -1;
      if (cutEnd > start) {
        prose.push({ id: section.id, kind: section.kind, heading: section.heading, text: text.slice(start, cutEnd), start, end: cutEnd });
        chars += headingCost + (cutEnd - start);
      }
    }
    break;
  }
  return { items, prose, truncated, chars };
}
