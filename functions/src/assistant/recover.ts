/**
 * Recovery of tool calls the model wrote as TEXT (owner: assistant).
 *
 * Seen on a device on 2026-10-21: for "Rename the call with Ana to Nexa proposal call and add the
 * Zoom link later" the model made no tool call and put the update_meeting arguments, as a JSON
 * object, into its reply, followed by a sentence. The user saw raw JSON and no card. The model
 * is told not to (prompt rule 15), and this module is the deterministic backstop: a top-level
 * JSON object in the reply whose keys identify one of the offered tools becomes that tool call
 * and is removed from the reply. The recovered call then goes through exactly the same schema
 * validation and mapping as a real tool call, so a wrong guess is dropped, never executed.
 *
 * Raw JSON is never shown to the user: an object that identifies no tool is removed as well.
 */
import type { ToolCall } from './actions';
import { TOOL_NAMES } from './tools';

export interface RecoveredToolCalls {
  toolCalls: ToolCall[];
  /** The reply with every recovered or unrecognised JSON object removed. */
  text: string;
}

type JsonObject = Record<string, unknown>;

/** Which tool an argument object belongs to, judged by its distinctive keys; null when none. */
export function toolNameForArgs(args: JsonObject): string | null {
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(args, key);
  if (has('decision')) return TOOL_NAMES.resolve;
  if (has('suggestions')) return TOOL_NAMES.suggest;
  if (has('meeting_refs')) return TOOL_NAMES.list;
  if (has('task_refs')) return TOOL_NAMES.listTasks;
  if (has('shift_minutes')) return TOOL_NAMES.bulk;
  if (has('task_ref')) return has('changes') ? TOOL_NAMES.updateTask : TOOL_NAMES.deleteTask;
  if (has('meeting_ref')) {
    if (has('changes')) return TOOL_NAMES.update;
    if (has('channel') || has('recipients')) return TOOL_NAMES.share;
    return TOOL_NAMES.delete;
  }
  if (has('due_date') || has('link_to_new_meeting')) return TOOL_NAMES.createTask;
  if (has('title') && has('date')) return TOOL_NAMES.create;
  return null;
}

/**
 * Top-level `{...}` spans of `text` that parse as JSON objects, outermost only, string-aware so a
 * brace inside a quoted value does not end the object.
 */
export function findJsonObjects(text: string): { start: number; end: number; value: JsonObject }[] {
  const found: { start: number; end: number; value: JsonObject }[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      if (depth > 0) inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, index + 1);
        try {
          const value: unknown = JSON.parse(candidate);
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            found.push({ start, end: index + 1, value: value as JsonObject });
          }
        } catch {
          // Not JSON (prose with braces): leave it in the text.
        }
        start = -1;
      }
    }
  }
  return found;
}

/**
 * Turns JSON objects the model left in its reply into tool calls (only tools in `offered`), and
 * strips every JSON object from the reply. Text without JSON comes back untouched.
 */
export function recoverToolCallsFromText(text: string, offered: ReadonlySet<string>): RecoveredToolCalls {
  const objects = findJsonObjects(text);
  if (objects.length === 0) return { toolCalls: [], text };
  const toolCalls: ToolCall[] = [];
  let remaining = '';
  let cursor = 0;
  for (const object of objects) {
    remaining += text.slice(cursor, object.start);
    cursor = object.end;
    const name = toolNameForArgs(object.value);
    if (name !== null && offered.has(name)) toolCalls.push({ name, arguments: JSON.stringify(object.value) });
  }
  remaining += text.slice(cursor);
  return { toolCalls, text: remaining.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() };
}
