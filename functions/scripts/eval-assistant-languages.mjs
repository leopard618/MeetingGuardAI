// The M12 language eval of the in-app AI chat (Portuguese (Brazil), French, German; the Hindi and
// Mandarin verdict fixtures go in the same file). Local only, never in CI: for every utterance in
// scripts/eval-assistant-languages/utterances.json it runs the real prompt (buildPromptMessages),
// the real model and the real mapping (mapToolCalls, plus the consent guard for pending cards) at
// a fixed clock (Tuesday 2026-12-01 10:00 Europe/Madrid), and prints per utterance only scores:
// action types, local date, local time, title and people checks, the resolution, dropped reasons,
// whether the reply is in the right language (a stopword check) and banned characters.
//
// Usage (from functions/, after `npm run build`):
//   node scripts/eval-assistant-languages.mjs [--model <name>] [--effort omit|none|minimal|low|medium|high] [--lang pt|fr|de|hi|zh] [--only <id>] [--offline] [--json]
//
// - --model: default OPENAI_MODEL from the shell, else the config default (gpt-5.4-mini).
// - --effort: default OPENAI_REASONING_EFFORT from the shell, else 'low'.
// - --lang / --only: a subset of the fixtures.
// - --offline: no network and no key: builds every prompt and checks the fixtures, no scores.
// - --json: one JSON line per utterance instead of the table.
//
// The OpenAI key: ONLY the environment variable OPENAI_API_KEY of the owner's shell, set for one
// session, never in a file or an argument, for example in Git Bash:
//   read -rs K && export OPENAI_API_KEY="$K"; unset K
// The script never prints the key, never reads functions/.env files, and prints no model output
// (no reply text, no titles): only pass/fail flags, counts, reason codes and token numbers. The
// utterances are synthetic (Hindi and Mandarin: real recognizer text stored with consent and no
// personal data), so nothing private goes to OpenAI.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const USAGE =
  'Usage: node scripts/eval-assistant-languages.mjs [--model <name>] [--effort <effort>] [--lang <code>] [--only <id>] [--offline] [--json]';

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
      lang: { type: 'string' },
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

const { buildPromptMessages } = load('../lib/assistant/prompt.js');
const { buildMeetingContext } = load('../lib/assistant/context.js');
const { buildTaskContext } = load('../lib/assistant/tasksContext.js');
const { ASSISTANT_TOOLS, TASK_TOOLS, RESOLVE_PENDING_TOOL } = load('../lib/assistant/tools.js');
const { mapToolCalls } = load('../lib/assistant/actions.js');
const { isPlainConsent } = load('../lib/assistant/guards.js');
const { recoverToolCallsFromText } = load('../lib/assistant/recover.js');
const { plainText } = load('../lib/assistant/plainText.js');
const { toLocalDate, toLocalTime } = load('../lib/assistant/time.js');
const { createOpenAiClient } = load('../lib/assistant/llm.js');
const { parseReasoningEffort } = load('../lib/config.js');
const { APP_LANGUAGES } = load('../lib/shared/aiContract.js');

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
let file;
try {
  file = JSON.parse(readFileSync(join(here, 'eval-assistant-languages', 'utterances.json'), 'utf8'));
} catch (error) {
  fail(`The fixture file does not parse (${errorName(error)}).`);
}
const NOW = new Date(file.now);
const TIME_ZONE = file.timeZone;
if (Number.isNaN(NOW.getTime()) || typeof TIME_ZONE !== 'string') fail('The fixture file needs "now" (ISO) and "timeZone".');

const ACTION_TYPES = new Set(['create_meeting', 'update_meeting', 'delete_meeting', 'share_meeting', 'bulk_update', 'list', 'create_task', 'update_task', 'delete_task', 'list_tasks']);
const problems = [];
const ids = new Set();
for (const fixture of file.fixtures ?? []) {
  const where = `fixture ${JSON.stringify(fixture.id)}`;
  if (typeof fixture.id !== 'string' || ids.has(fixture.id)) problems.push(`${where}: missing or duplicate id`);
  ids.add(fixture.id);
  if (typeof fixture.lang !== 'string' || fixture.lang.length === 0) problems.push(`${where}: lang`);
  // Hindi and Mandarin are not app languages: their replies stay English (replyLanguage "en").
  if (!APP_LANGUAGES.includes(fixture.replyLanguage)) problems.push(`${where}: replyLanguage must be an app language`);
  if (typeof fixture.transcript !== 'string' || fixture.transcript.trim().length === 0) problems.push(`${where}: transcript`);
  if (fixture.mode !== undefined && fixture.mode !== 'chat' && fixture.mode !== 'debrief') problems.push(`${where}: mode`);
  const expect = fixture.expect ?? {};
  for (const type of expect.types ?? []) if (!ACTION_TYPES.has(type)) problems.push(`${where}: unknown type ${type}`);
  const dates = expect.date === undefined ? [] : Array.isArray(expect.date) ? expect.date : [expect.date];
  for (const date of dates) if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`${where}: date`);
  if (expect.time !== undefined && !/^\d{2}:\d{2}$/.test(expect.time)) problems.push(`${where}: time`);
  if (expect.resolution !== undefined && expect.resolution !== null && expect.resolution !== 'confirm' && expect.resolution !== 'reject') {
    problems.push(`${where}: resolution`);
  }
  if (expect.resolution !== undefined && typeof fixture.pending !== 'string') problems.push(`${where}: a resolution needs a pending card`);
}
if (problems.length > 0) fail(`The fixture file has problems:\n${problems.join('\n')}`);

let fixtures = file.fixtures;
if (values.lang) fixtures = fixtures.filter((fixture) => fixture.lang === values.lang);
if (values.only) fixtures = fixtures.filter((fixture) => fixture.id === values.only);
if (fixtures.length === 0) fail('No fixture matches --lang / --only.');

const meetingRecords = file.meetings.map((meeting) => ({
  id: meeting.id,
  doc: {
    title: meeting.title,
    description: '',
    startAt: meeting.startAt,
    durationMinutes: meeting.durationMinutes,
    timezone: TIME_ZONE,
    allDay: false,
    status: 'scheduled',
    deletedAt: null,
    source: 'manual',
    participants: meeting.participants ?? [],
    location: null,
    conference: null,
    recurrence: null,
    recurrenceOverrides: null,
  },
}));
// The debrief fixtures talk about the meeting that ended last (the fixture file's "review").
const DEBRIEF_MEETING_ID = 'review';

// ---------------------------------------------------------------------------------------------
// Scoring helpers (no model text leaves these functions)
// ---------------------------------------------------------------------------------------------

// Product text rule: no en/em dash, ellipsis character, curly or low quotes, guillemets, no-break spaces.
const BANNED = new RegExp(
  `[${[0x2013, 0x2014, 0x2026, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x00ab, 0x00bb, 0x00a0, 0x202f].map((code) => String.fromCharCode(code)).join('')}]`,
);

// A few frequent, mostly language-specific words; the reply language is the one with most hits.
const STOPWORDS = {
  en: ['you', 'your', 'the', 'and', 'is', 'meeting', 'with', 'for', 'task', 'tomorrow', 'it', 'to'],
  es: ['usted', 'tu', 'tienes', 'reunión', 'para', 'con', 'está', 'una', 'tarea', 'mañana', 'el', 'que'],
  pt: ['você', 'seu', 'sua', 'reunião', 'para', 'com', 'não', 'uma', 'tarefa', 'amanhã', 'às', 'está'],
  fr: ['vous', 'votre', 'réunion', 'est', 'une', 'avec', 'pour', 'je', 'tâche', 'demain', 'le', 'les'],
  de: ['sie', 'ihre', 'und', 'ist', 'für', 'mit', 'eine', 'ich', 'besprechung', 'aufgabe', 'morgen', 'der'],
};

function replyLanguageOk(reply, expected) {
  const words = reply.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length > 0);
  const hits = Object.fromEntries(Object.entries(STOPWORDS).map(([language, list]) => [language, words.filter((word) => list.includes(word)).length]));
  const best = Math.max(...Object.values(hits));
  return best > 0 && hits[expected] === best && Object.entries(hits).every(([language, count]) => language === expected || count < best);
}

/** Local date and time of the first action that carries one (meeting start or task due). */
function whenOf(actions) {
  for (const action of actions) {
    if (action.type === 'create_meeting') {
      const start = new Date(action.meeting.startAt);
      return { date: toLocalDate(start, TIME_ZONE), time: toLocalTime(start, TIME_ZONE) };
    }
    if (action.type === 'update_meeting' && action.changes.startAt !== undefined) {
      const start = new Date(action.changes.startAt);
      return { date: toLocalDate(start, TIME_ZONE), time: toLocalTime(start, TIME_ZONE) };
    }
    if (action.type === 'create_task') return { date: action.task.dueDate, time: action.task.dueTime };
    if (action.type === 'update_task') return { date: action.changes.dueDate ?? null, time: action.changes.dueTime ?? null };
  }
  return null;
}

function titleOf(actions) {
  for (const action of actions) {
    if (action.type === 'create_meeting') return action.meeting.title;
    if (action.type === 'create_task') return action.task.title;
  }
  return null;
}

function peopleOf(actions) {
  for (const action of actions) {
    if (action.type === 'create_meeting') return action.meeting.participants.length;
    if (action.type === 'create_task') return action.task.people.length;
  }
  return null;
}

function sameTypes(actual, expected) {
  const a = [...actual].sort();
  const b = [...expected].sort();
  return a.length === b.length && a.every((type, index) => type === b[index]);
}

// ---------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------

const offline = values.offline === true;
const model = values.model ?? process.env.OPENAI_MODEL ?? 'gpt-5.4-mini';
const effortSetting = values.effort ?? process.env.OPENAI_REASONING_EFFORT ?? 'low';
const reasoningEffort = parseReasoningEffort(effortSetting);
if (reasoningEffort === null && effortSetting.trim().toLowerCase() !== 'omit') fail('--effort must be omit, none, minimal, low, medium or high.');

let client = null;
if (!offline) {
  const apiKey = process.env.OPENAI_API_KEY ?? '';
  if (apiKey.trim().length === 0) fail('Set OPENAI_API_KEY in this shell first (see the file comment), or run with --offline.');
  client = createOpenAiClient({ apiKey, model, reasoningEffort });
}

async function runOne(fixture) {
  const mode = fixture.mode ?? 'chat';
  const context = buildMeetingContext(meetingRecords, NOW, { followUpMeetingId: mode === 'debrief' ? DEBRIEF_MEETING_ID : null });
  const tasksContext = buildTaskContext([], NOW);
  const pendingActions = typeof fixture.pending === 'string' ? [{ type: 'create_meeting', summary: fixture.pending }] : [];
  const messages =
    pendingActions.length > 0
      ? [
          { role: 'user', content: 'Schedule it' },
          { role: 'assistant', content: fixture.pending },
          { role: 'user', content: fixture.transcript },
        ]
      : [{ role: 'user', content: fixture.transcript }];
  const prompt = buildPromptMessages({
    language: fixture.replyLanguage,
    timeZone: TIME_ZONE,
    now: NOW,
    mode,
    context,
    tasksContext,
    messages,
    pendingActions,
  });
  const tools = [...ASSISTANT_TOOLS, ...TASK_TOOLS, ...(pendingActions.length > 0 ? [RESOLVE_PENDING_TOOL] : [])];
  const score = { id: fixture.id, lang: fixture.lang, replyLanguage: fixture.replyLanguage, promptMessages: prompt.messages.length };
  if (offline) return { ...score, pass: null };

  let completion;
  try {
    completion = await client.complete({
      messages: prompt.messages,
      tools,
      toolChoice: mode === 'debrief' ? 'required' : 'auto',
      safetyIdentifier: 'meetingguard-eval-languages',
    });
  } catch (error) {
    // The adapter's errors carry a category and a status, never a response body.
    const failure = error && typeof error === 'object' && typeof error.kind === 'string' ? `upstream_${error.kind}` : errorName(error);
    return { ...score, pass: false, failure };
  }
  const recovered = recoverToolCallsFromText(completion.content ?? '', new Set(tools.map((tool) => tool.function.name)));
  const toolCalls = completion.toolCalls.length > 0 ? completion.toolCalls : recovered.toolCalls;
  const mapped = mapToolCalls(toolCalls, {
    language: fixture.replyLanguage,
    mode,
    userTimeZone: TIME_ZONE,
    context,
    tasksContext,
    allowNewMeetingLinks: true,
    userText: fixture.transcript,
  });
  const plainConsent = isPlainConsent(fixture.transcript);
  const resolution = pendingActions.length > 0 && mapped.actions.length === 0 && plainConsent ? mapped.resolution : null;
  const reply = recovered.text.trim();
  const expect = fixture.expect ?? {};
  const when = whenOf(mapped.actions);
  const dates = expect.date === undefined ? null : Array.isArray(expect.date) ? expect.date : [expect.date];
  const title = titleOf(mapped.actions);
  const people = peopleOf(mapped.actions);

  const checks = {
    types: expect.types === undefined ? null : sameTypes(mapped.actions.map((action) => action.type), expect.types),
    date: dates === null ? null : when !== null && dates.includes(when.date),
    time: expect.time === undefined ? null : when !== null && when.time === expect.time,
    title: expect.titleIncludes === undefined ? null : title !== null && title.toLowerCase().includes(expect.titleIncludes.toLowerCase()),
    people: expect.peopleCount === undefined ? null : people === expect.peopleCount,
    resolution: expect.resolution === undefined ? null : resolution === expect.resolution,
    // An empty reply is filled by the server's fallback text in the right language.
    replyLanguage: reply.length === 0 ? null : replyLanguageOk(reply, fixture.replyLanguage),
  };
  const pass = Object.values(checks).every((value) => value !== false);
  return {
    ...score,
    pass,
    checks,
    dropped: mapped.dropped,
    replyChars: reply.length,
    bannedInReply: BANNED.test(reply),
    bannedAfterPlainText: BANNED.test(plainText(reply)),
    bannedInSummaries: mapped.actions.some((action) => BANNED.test(action.summary)),
    finishReason: completion.finishReason ?? null,
    promptTokens: completion.usage?.promptTokens ?? null,
    completionTokens: completion.usage?.completionTokens ?? null,
  };
}

function flag(value) {
  return value === null ? '-' : value ? 'ok' : 'NO';
}

function counts(record) {
  const entries = Object.entries(record ?? {});
  return entries.length === 0 ? '-' : entries.map(([reason, count]) => `${reason}:${count}`).join(' ');
}

const scores = [];
for (const fixture of fixtures) {
  const score = await runOne(fixture);
  scores.push(score);
  if (values.json) {
    console.log(JSON.stringify(score));
    continue;
  }
  if (score.pass === null) {
    console.log(`BUILT ${score.id} (${score.lang} -> ${score.replyLanguage}): ${score.promptMessages} prompt messages`);
    continue;
  }
  if (score.failure) {
    console.log(`FAIL ${score.id} (${score.lang}): ${score.failure}`);
    continue;
  }
  const c = score.checks;
  console.log(
    [
      `${score.pass ? 'PASS' : 'FAIL'} ${score.id} (${score.lang} -> ${score.replyLanguage})`,
      `  types ${flag(c.types)}, date ${flag(c.date)}, time ${flag(c.time)}, title ${flag(c.title)}, people ${flag(c.people)}, resolution ${flag(c.resolution)}, reply language ${flag(c.replyLanguage)}`,
      `  dropped: ${counts(score.dropped)}; banned characters: reply ${score.bannedInReply ? 'yes' : 'no'} (after plainText ${score.bannedAfterPlainText ? 'yes' : 'no'}), summaries ${score.bannedInSummaries ? 'yes' : 'no'}`,
      `  finish ${score.finishReason ?? '-'}; tokens in ${score.promptTokens ?? '-'} out ${score.completionTokens ?? '-'}`,
    ].join('\n'),
  );
}

if (offline) {
  console.log(`\noffline: ${scores.length} prompts built, fixtures valid.`);
  process.exit(0);
}
const byLang = new Map();
for (const score of scores) {
  const entry = byLang.get(score.lang) ?? { total: 0, passed: 0 };
  entry.total += 1;
  if (score.pass) entry.passed += 1;
  byLang.set(score.lang, entry);
}
const passed = scores.filter((score) => score.pass).length;
const summaryLines = [
  '',
  `model ${model}, effort ${effortSetting}: ${passed}/${scores.length} utterances pass`,
  ...[...byLang.entries()].map(([lang, entry]) => `  ${lang}: ${entry.passed}/${entry.total} (${Math.round((entry.passed / entry.total) * 100)}%)`),
  `banned characters in raw replies: ${scores.filter((score) => score.bannedInReply).length}, after plainText: ${scores.filter((score) => score.bannedAfterPlainText).length}`,
];
console.log(values.json ? JSON.stringify({ summary: { passed, total: scores.length, byLang: Object.fromEntries(byLang) } }) : summaryLines.join('\n'));
process.exit(passed === scores.length ? 0 : 1);
