/**
 * The stored extraction's stamp and the plain facts a summaryRead list shows (docs/v2/M11-DESIGN.md
 * sections 2.7 and 6). PURE.
 *
 * users/{uid}/meetingSummaries/{id}.extraction is the reserved top-level field (model.ts,
 * z.unknown().nullable(), so deployed M10 code parses any value). The whole field (items, the
 * sealed blob, lease, charge, calls) is written by commitmentsStore; this file owns the versions
 * and the field names the lists read through a field mask:
 *   v 1, state 'ready' | 'empty', contentDigest, parserVersion (the one used), extractorVersion,
 *   counts {open, accepted, dropped}.
 * An extraction is current only while contentDigest, the parser version in use and
 * EXTRACTOR_VERSION all match; otherwise it is stale (never silently reused). Plaintext structure
 * only: no title, owner, quote or date here.
 *
 * Product text rule: ASCII punctuation only in this file.
 */
import { z } from 'zod';

import { COMMITMENT_LIMITS, type SummaryListCommitments } from '../shared/aiContract';
import { SECTIONS_PARSER_VERSION } from '../summaries/sections';

/** Bump on any change to the prompt, the tool, the checks or the as-written rules: every extraction goes stale. */
export const EXTRACTOR_VERSION = 1;

/** extraction.v. */
export const EXTRACTION_SCHEMA_VERSION = 1;

/**
 * The parser version the sections are read with: the stored one, or the current parser's when it is
 * newer (parseSections runs again in memory; M11 never writes sections back).
 */
export function parserVersionInUse(storedParserVersion: number): number {
  return Math.max(storedParserVersion, SECTIONS_PARSER_VERSION);
}

/** The extraction fields a list row reads (nested field paths for a field mask; never the sealed blob). */
export const EXTRACTION_LIST_FIELDS = [
  'extraction.v',
  'extraction.state',
  'extraction.counts',
  'extraction.contentDigest',
  'extraction.parserVersion',
  'extraction.extractorVersion',
] as const;

const countField = z.number().int().min(0).max(COMMITMENT_LIMITS.maxProposals);

const listFactsSchema = z.object({
  v: z.literal(EXTRACTION_SCHEMA_VERSION),
  state: z.enum(['ready', 'empty']),
  contentDigest: z.string().min(1),
  parserVersion: z.number().int().min(0),
  extractorVersion: z.number().int().min(0),
  counts: z.object({ open: countField, accepted: countField, dropped: countField }),
});

/** The summary fields the stamp is compared with. */
export interface ExtractionStampTarget {
  contentDigest: string;
  parserVersion: number;
}

/** Whether a stored stamp still describes this summary (content, parser in use, extractor). */
export function isCurrentStamp(
  stamp: { contentDigest: string; parserVersion: number; extractorVersion: number },
  summary: ExtractionStampTarget,
): boolean {
  return (
    stamp.contentDigest === summary.contentDigest &&
    stamp.parserVersion === parserVersionInUse(summary.parserVersion) &&
    stamp.extractorVersion === EXTRACTOR_VERSION
  );
}

/**
 * A row's suggested-task facts ({state, open, accepted}) from the masked extraction field, or null
 * when there is none (M10 summaries, a lease without a result, a shape this version does not know).
 */
export function extractionListFactsOf(raw: unknown, summary: ExtractionStampTarget): SummaryListCommitments | null {
  const parsed = listFactsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const facts = parsed.data;
  return {
    state: isCurrentStamp(facts, summary) ? facts.state : 'stale',
    open: facts.counts.open,
    accepted: facts.counts.accepted,
  };
}
