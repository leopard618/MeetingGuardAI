import { ASSISTANT_TOOLS, RESOLVE_PENDING_TOOL, TASK_TOOLS, TOOL_NAMES } from '../../src/assistant/tools';

type Schema = Record<string, unknown>;

/** Keywords we deliberately avoid so every model that supports strict tools accepts the schema. */
const AVOIDED_KEYWORDS = ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'format', 'default', '$ref'];

function collectIssues(schema: Schema, path: string, issues: string[]): void {
  for (const keyword of AVOIDED_KEYWORDS) {
    if (keyword in schema) issues.push(`${path}: uses "${keyword}"`);
  }
  if (Array.isArray(schema.anyOf)) {
    (schema.anyOf as Schema[]).forEach((branch, index) => collectIssues(branch, `${path}.anyOf[${index}]`, issues));
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes('object')) {
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    if (schema.additionalProperties !== false) issues.push(`${path}: additionalProperties must be false`);
    const required = (schema.required ?? []) as string[];
    if ([...required].sort().join(',') !== Object.keys(properties).sort().join(',')) {
      issues.push(`${path}: every property must be required`);
    }
    for (const [key, value] of Object.entries(properties)) collectIssues(value, `${path}.${key}`, issues);
  }
  if (types.includes('array')) {
    if (!schema.items) issues.push(`${path}: array without items`);
    else collectIssues(schema.items as Schema, `${path}[]`, issues);
  }
}

/** Every tool the model can ever see: the base set plus the conditional v4 and v5 tools. */
const ALL_TOOLS = [...ASSISTANT_TOOLS, ...TASK_TOOLS, RESOLVE_PENDING_TOOL];

describe('assistant tools', () => {
  it('defines one strict tool per action type plus suggestions, tasks and pending resolution', () => {
    expect(ALL_TOOLS.map((tool) => tool.function.name).sort()).toEqual(Object.values(TOOL_NAMES).sort());
    for (const tool of ALL_TOOLS) {
      expect(tool.type).toBe('function');
      expect(tool.function.strict).toBe(true);
      expect(tool.function.name).toMatch(/^[a-z_]{1,64}$/);
      expect(tool.function.description.length).toBeGreaterThan(10);
    }
  });

  it('keeps resolve_pending OUT of the base tool set (offered only with pending proposals)', () => {
    expect(ASSISTANT_TOOLS.map((tool) => tool.function.name)).not.toContain(TOOL_NAMES.resolve);
  });

  it('keeps the task tools OUT of the base tool set (offered only to v5 clients)', () => {
    const base = ASSISTANT_TOOLS.map((tool) => tool.function.name);
    for (const tool of TASK_TOOLS) expect(base).not.toContain(tool.function.name);
  });

  it('uses only strict-mode compatible JSON Schema', () => {
    const issues: string[] = [];
    for (const tool of ALL_TOOLS) {
      const parameters = tool.function.parameters;
      expect(parameters.type).toBe('object');
      collectIssues(parameters, tool.function.name, issues);
    }
    expect(issues).toEqual([]);
  });

  it('asks for every action with a summary and confidence', () => {
    for (const tool of ASSISTANT_TOOLS) {
      if (tool.function.name === TOOL_NAMES.suggest) continue;
      const properties = tool.function.parameters.properties as Record<string, unknown>;
      expect(properties).toHaveProperty('summary');
      expect(properties).toHaveProperty('confidence');
    }
  });
});
