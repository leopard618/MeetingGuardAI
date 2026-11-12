// The M11 commitments eval over ten synthetic recaps (docs/v2/M11-DESIGN.md section 8 "Eval" and
// section 10 day 5). Local only, never in CI: it runs the real prompt, the real model and the real
// checks on scripts/eval-commitments/recaps.json and prints, per recap, the counts of proposed,
// kept and dropped suggestions by check, the expectations missed, the title fallbacks, the finish
// reason and the tokens.
//
// Usage (from functions/, after `npm run build`):
//   node scripts/eval-commitments.mjs [--model <name>] [--effort omit|none|minimal|low|medium|high] [--only <recap id>] [--offline] [--json]
//
// - --model: default OPENAI_MODEL from the shell, else the config default (gpt-5.4-mini).
// - --effort: default OPENAI_REASONING_EFFORT from the shell, else 'low'. Run it at the
//   production effort to see whether 6,000 output tokens are enough (finish_reason 'length').
// - --only: one recap by id.
// - --offline: no network and no key: a "perfect model" built from the fixture's expectations
//   (the same self-check the unit test runs). Use it to see the report shape.
// - --json: the scores as JSON lines instead of the table.
//
// The OpenAI key: ONLY the environment variable OPENAI_API_KEY of the owner's shell, set for one
// session, never in a file or an argument, for example in Git Bash:
//   read -rs K && export OPENAI_API_KEY="$K"; unset K
// The script never prints the key, never reads functions/.env files, and prints no model output:
// only counts, reason codes, positions of the fixture's expectations and token numbers. The
// recaps are synthetic, so nothing real goes to OpenAI.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const USAGE = 'Usage: node scripts/eval-commitments.mjs [--model <name>] [--effort <effort>] [--only <recap id>] [--offline] [--json]';

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function errorName(error) {
  return error instanceof Error ? error.name : typeof error;
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      model: { type: 'string' },
      effort: { type: 'string' },
      only: { type: 'string' },
      offline: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  }));
} catch {
  // The parser's message echoes the unknown argument, which could be a mistyped key.
  fail(USAGE);
}

const require = createRequire(import.meta.url);
function load(path) {
  try {
    return require(path);
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : undefined;
    fail(code === 'MODULE_NOT_FOUND' ? 'Build first: run `npm run build` in functions/ (the eval loads lib/).' : `Could not load ${path} (${errorName(error)}).`);
  }
}

const { parseEvalFile, perfectProposals, recapText, scoreRecap, summarizeScores } = load('../lib/commitments/evalScore.js');
const { selectModelInput } = load('../lib/commitments/payload.js');
const { referenceDayOf } = load('../lib/commitments/due.js');
const { buildCommitmentsPrompt } = load('../lib/commitments/prompt.js');
const { PROPOSE_COMMITMENTS_TOOL, readProposeCall } = load('../lib/commitments/tool.js');
const { verifyProposals } = load('../lib/commitments/verify.js');
const { parseSections } = load('../lib/summaries/sections.js');
const { COMMITMENTS_TUNING, parseReasoningEffort } = load('../lib/config.js');
const { createOpenAiClient } = load('../lib/assistant/llm.js');

const here = dirname(fileURLToPath(import.meta.url));
let recaps;
try {
  recaps = parseEvalFile(JSON.parse(readFileSync(join(here, 'eval-commitments', 'recaps.json'), 'utf8')));
} catch (error) {
  fail(`The fixture file does not parse (${errorName(error)}).`);
}
if (values.only) {
  recaps = recaps.filter((recap) => recap.id === values.only);
  if (recaps.length === 0) fail(`No recap with id ${JSON.stringify(values.only)}.`);
}

const offline = values.offline === true;
const model = values.model ?? process.env.OPENAI_MODEL ?? 'gpt-5.4-mini';
const effortSetting = values.effort ?? process.env.OPENAI_REASONING_EFFORT ?? 'low';
const reasoningEffort = parseReasoningEffort(effortSetting);
if (reasoningEffort === null && effortSetting.trim().toLowerCase() !== 'omit') fail('--effort must be omit, none, minimal, low, medium or high.');

let client = null;
if (!offline) {
  const apiKey = process.env.OPENAI_API_KEY ?? '';
  if (apiKey.trim().length === 0) fail('Set OPENAI_API_KEY in this shell first (see the file comment), or run with --offline.');
  client = createOpenAiClient({
    apiKey,
    model,
    reasoningEffort,
    tuning: {
      requestTimeoutMs: COMMITMENTS_TUNING.openAiRequestTimeoutMs,
      deadlineMs: COMMITMENTS_TUNING.openAiDeadlineMs,
      maxRetries: COMMITMENTS_TUNING.openAiMaxRetries,
      maxCompletionTokens: COMMITMENTS_TUNING.maxCompletionTokens,
    },
  });
}

async function runOne(recap) {
  const text = recapText(recap);
  const sections = parseSections(text).sections;
  const reference = referenceDayOf({
    meetingSnapshot: recap.meeting === null ? null : { startAt: recap.meeting.startAt, timezone: recap.meeting.timezone },
    summaryDate: recap.summaryDate,
    anchorAt: null,
    receivedAt: recap.meeting?.startAt ?? `${recap.summaryDate ?? '2026-11-01'}T12:00:00.000Z`,
    preferencesTimeZone: null,
  });
  const input = selectModelInput(text, sections, { maxItems: COMMITMENTS_TUNING.maxModelItems, maxChars: COMMITMENTS_TUNING.maxModelTextChars });
  const prompt = buildCommitmentsPrompt({ input, reference, meetingTitle: recap.meeting?.title ?? null, language: recap.language });
  let proposals = [];
  let failure = null;
  let finishReason = null;
  let promptTokens = null;
  let completionTokens = null;
  if (offline) {
    proposals = perfectProposals(recap, text, sections);
    finishReason = 'offline';
  } else {
    try {
      const completion = await client.complete({
        messages: prompt.messages,
        tools: [PROPOSE_COMMITMENTS_TOOL],
        toolChoice: 'required',
        safetyIdentifier: 'meetingguard-eval-commitments',
      });
      finishReason = completion.finishReason;
      promptTokens = completion.usage?.promptTokens ?? null;
      completionTokens = completion.usage?.completionTokens ?? null;
      const read = readProposeCall(completion);
      if (read.kind === 'failed') failure = read.reason;
      else if (read.kind === 'proposals') proposals = read.proposals;
    } catch (error) {
      // The adapter's errors carry a category and a status, never a response body.
      failure = error && typeof error === 'object' && typeof error.kind === 'string' ? `upstream_${error.kind}` : errorName(error);
    }
  }
  const verified = verifyProposals({ text, sections, input, proposals, referenceDay: reference.day, language: recap.language, userNames: recap.userNames });
  const score = scoreRecap(recap, { text, commitments: verified.commitments, counts: verified.counts, failure, finishReason, promptTokens, completionTokens });
  return { ...score, inputItems: input.items.length, inputProse: input.prose.length, inputChars: input.chars, truncated: input.truncated };
}

function list(values) {
  return values.length === 0 ? '-' : values.join(',');
}

function counts(record) {
  const entries = Object.entries(record);
  return entries.length === 0 ? '-' : entries.map(([reason, count]) => `${reason}:${count}`).join(' ');
}

const scores = [];
for (const recap of recaps) {
  const score = await runOne(recap);
  scores.push(score);
  if (values.json) {
    console.log(JSON.stringify(score));
    continue;
  }
  console.log(
    [
      `${score.pass ? 'PASS' : 'FAIL'} ${score.id} (${score.language})`,
      `  input: ${score.inputItems} items, ${score.inputProse} prose, ${score.inputChars} chars${score.truncated ? ', truncated' : ''}`,
      `  proposed ${score.proposed}, kept ${score.kept}, title fallbacks ${score.titleFallbacks}, owner replaced ${score.ownerReplaced}`,
      `  dropped: ${counts(score.dropped)}`,
      `  cleared: ${counts(score.cleared)}`,
      `  expected ${score.found}/${score.expected}; missing #${list(score.missing)}; wrong owner #${list(score.wrongOwner)}; wrong due #${list(score.wrongDue)}; wrong kind #${list(score.wrongKind)}; missing flags #${list(score.missingFlags)}`,
      `  forbidden quoted ${score.forbiddenHits}; titles with a link, email or phone ${score.titlesWithContact}`,
      `  finish ${score.finishReason ?? '-'}; tokens in ${score.promptTokens ?? '-'} out ${score.completionTokens ?? '-'}${score.failure === null ? '' : `; failure ${score.failure}`}`,
    ].join('\n'),
  );
}

const summary = summarizeScores(scores);
const share = `${Math.round(summary.fallbackShare * 1000) / 10}%`;
console.log(
  values.json
    ? JSON.stringify({ summary })
    : [
        '',
        `${offline ? 'offline' : `model ${model}, effort ${effortSetting}`}: ${summary.passed}/${summary.recaps} recaps pass`,
        `proposed ${summary.proposed}, kept ${summary.kept}, title fallbacks ${summary.titleFallbacks} (${share} of kept)`,
        `finish_reason length ${summary.lengthFinishes}, failures ${summary.failures}, tokens in ${summary.promptTokens} out ${summary.completionTokens}`,
      ].join('\n'),
);
process.exit(summary.passed === summary.recaps ? 0 : 1);
