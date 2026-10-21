import { findJsonObjects, recoverToolCallsFromText, toolNameForArgs } from '../../src/assistant/recover';
import { TOOL_NAMES } from '../../src/assistant/tools';

const ALL = new Set<string>(Object.values(TOOL_NAMES));

// The exact shape seen on the device on 2026-10-21 (B9 of the Stage 1 guide).
const DEVICE_REPLY =
  '{"meeting_ref":"mdbn5y4s","changes":{"title":"Nexa proposal call","description":null,"date":null,"time":null,"all_day":null,"timezone":null,"recurrence":null,"clear_recurrence":false,"duration_minutes":null,"location":null,"clear_location":false,"conference":null,"clear_conference":false,"participants":null,"preparation_tips":null,"alert_minutes_before":null,"reset_alert_times":false},"scope":"series","occurrence_date":null,"summary":"Rename the call with Ana to \\"Nexa proposal call\\" and leave the Zoom link to add later.","confidence":97}\n' +
  'I prepared the rename for the Thursday 11:00 call with Ana to "Nexa proposal call". The Zoom link can be added later when you are ready.';

describe('toolNameForArgs', () => {
  it('identifies each tool by its distinctive keys', () => {
    expect(toolNameForArgs({ meeting_ref: 'a', changes: {} })).toBe('update_meeting');
    expect(toolNameForArgs({ meeting_ref: 'a' })).toBe('delete_meeting');
    expect(toolNameForArgs({ meeting_ref: 'a', channel: 'email' })).toBe('share_meeting');
    expect(toolNameForArgs({ task_ref: 't', changes: {} })).toBe('update_task');
    expect(toolNameForArgs({ task_ref: 't' })).toBe('delete_task');
    expect(toolNameForArgs({ title: 'Call', date: '2026-10-22', time: '10:00' })).toBe('create_meeting');
    expect(toolNameForArgs({ title: 'Prepare', due_date: '2026-10-21' })).toBe('create_task');
    expect(toolNameForArgs({ meeting_refs: [] })).toBe('list_meetings');
    expect(toolNameForArgs({ task_refs: [] })).toBe('list_tasks');
    expect(toolNameForArgs({ shift_minutes: 30, meeting_refs: ['a'] })).toBe('list_meetings');
    expect(toolNameForArgs({ decision: 'confirm' })).toBe('resolve_pending');
    expect(toolNameForArgs({ suggestions: ['a'] })).toBe('suggest_replies');
    expect(toolNameForArgs({ hello: 'world' })).toBeNull();
  });
});

describe('findJsonObjects', () => {
  it('finds outermost objects and ignores braces inside strings and prose', () => {
    const text = 'Note {not json} then {"a":"x } y","b":{"c":1}} and {"d":2}.';
    const found = findJsonObjects(text);
    expect(found.map((item) => item.value)).toEqual([{ a: 'x } y', b: { c: 1 } }, { d: 2 }]);
    expect(text.slice(found[0]!.start, found[0]!.end)).toBe('{"a":"x } y","b":{"c":1}}');
  });

  it('returns nothing for plain prose', () => {
    expect(findJsonObjects('Moving it to Thursday at 11.')).toEqual([]);
  });
});

describe('recoverToolCallsFromText', () => {
  it('turns the device reply into an update_meeting call and a clean sentence', () => {
    const { toolCalls, text } = recoverToolCallsFromText(DEVICE_REPLY, ALL);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe('update_meeting');
    expect(JSON.parse(toolCalls[0]!.arguments)).toMatchObject({ meeting_ref: 'mdbn5y4s', changes: { title: 'Nexa proposal call' } });
    expect(text).toBe('I prepared the rename for the Thursday 11:00 call with Ana to "Nexa proposal call". The Zoom link can be added later when you are ready.');
    expect(text).not.toContain('{');
  });

  it('only recovers tools that were offered, but strips every JSON object regardless', () => {
    const { toolCalls, text } = recoverToolCallsFromText('{"task_ref":"t1","changes":{"due_date":"2026-10-22"}} Done.', new Set(['update_meeting']));
    expect(toolCalls).toEqual([]);
    expect(text).toBe('Done.');
  });

  it('leaves a reply without JSON untouched', () => {
    const reply = 'Nothing on your calendar for that.';
    expect(recoverToolCallsFromText(reply, ALL)).toEqual({ toolCalls: [], text: reply });
  });
});
