// Must be first — sets DONNA_DB_PATH=':memory:' before any require of src/db
process.env.DONNA_DB_PATH = ':memory:';

const { tools, getGeminiFunctionDeclarations, getTool } = require('../../src/skills/tools');

const EXPECTED_TOOL_COUNT = 20;

describe('Tools Manifest — structural validation', () => {
  it(`has exactly ${EXPECTED_TOOL_COUNT} tools defined`, () => {
    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);
  });

  it('every tool has a non-empty name string', () => {
    tools.forEach((tool, i) => {
      expect(tool.name, `tool[${i}] is missing name`).toBeDefined();
      expect(typeof tool.name, `tool[${i}].name must be a string`).toBe('string');
      expect(tool.name.trim().length, `tool[${i}].name must not be empty`).toBeGreaterThan(0);
    });
  });

  it('every tool has a non-empty description string', () => {
    tools.forEach((tool) => {
      expect(tool.description, `tool "${tool.name}" is missing description`).toBeDefined();
      expect(typeof tool.description, `tool "${tool.name}".description must be a string`).toBe('string');
      expect(tool.description.trim().length, `tool "${tool.name}".description must not be empty`).toBeGreaterThan(0);
    });
  });

  it('every tool has a parameters object', () => {
    tools.forEach((tool) => {
      expect(tool.parameters, `tool "${tool.name}" is missing parameters`).toBeDefined();
      expect(typeof tool.parameters, `tool "${tool.name}".parameters must be an object`).toBe('object');
      expect(tool.parameters).not.toBeNull();
    });
  });

  it('every tool has a callable handler function', () => {
    tools.forEach((tool) => {
      expect(tool.handler, `tool "${tool.name}" is missing handler`).toBeDefined();
      expect(typeof tool.handler, `tool "${tool.name}".handler must be a function`).toBe('function');
    });
  });
});

describe('Tools Manifest — no duplicate names', () => {
  it('all tool names are unique', () => {
    const names = tools.map(t => t.name);
    const unique = new Set(names);
    if (unique.size !== names.length) {
      // Find the duplicates to surface a helpful failure message
      const seen = new Set();
      const duplicates = names.filter(n => {
        if (seen.has(n)) return true;
        seen.add(n);
        return false;
      });
      throw new Error(`Duplicate tool names found: ${duplicates.join(', ')}`);
    }
    expect(unique.size).toBe(names.length);
  });
});

describe('Tools Manifest — JSON Schema validation on parameters', () => {
  it('every tool parameters object has a "type" field', () => {
    tools.forEach((tool) => {
      expect(
        tool.parameters.type,
        `tool "${tool.name}".parameters is missing the "type" field`
      ).toBeDefined();
    });
  });

  it('every tool parameters.type is "object" (Gemini function calling requirement)', () => {
    tools.forEach((tool) => {
      expect(
        tool.parameters.type,
        `tool "${tool.name}".parameters.type must be "object"`
      ).toBe('object');
    });
  });

  it('every tool with required fields lists them as an array', () => {
    tools.forEach((tool) => {
      if (tool.parameters.required !== undefined) {
        expect(
          Array.isArray(tool.parameters.required),
          `tool "${tool.name}".parameters.required must be an array`
        ).toBe(true);
      }
    });
  });

  it('required fields reference properties that actually exist in parameters.properties', () => {
    tools.forEach((tool) => {
      if (!tool.parameters.required || !tool.parameters.properties) return;
      tool.parameters.required.forEach((fieldName) => {
        expect(
          tool.parameters.properties[fieldName],
          `tool "${tool.name}" requires field "${fieldName}" but it is not defined in parameters.properties`
        ).toBeDefined();
      });
    });
  });

  it('each property in parameters.properties has a "type" field', () => {
    tools.forEach((tool) => {
      if (!tool.parameters.properties) return;
      Object.entries(tool.parameters.properties).forEach(([propName, propSchema]) => {
        expect(
          propSchema.type,
          `tool "${tool.name}".parameters.properties["${propName}"] is missing "type"`
        ).toBeDefined();
      });
    });
  });
});

describe('Tools Manifest — helper functions', () => {
  it('getGeminiFunctionDeclarations returns one entry per tool', () => {
    const declarations = getGeminiFunctionDeclarations();
    expect(declarations).toHaveLength(tools.length);
  });

  it('getGeminiFunctionDeclarations entries have name, description, and parameters but no handler', () => {
    const declarations = getGeminiFunctionDeclarations();
    declarations.forEach((decl) => {
      expect(decl.name).toBeDefined();
      expect(decl.description).toBeDefined();
      expect(decl.parameters).toBeDefined();
      expect(decl.handler).toBeUndefined();
    });
  });

  it('getTool returns the correct tool by name', () => {
    const tool = getTool('get_pending_prs');
    expect(tool).toBeDefined();
    expect(tool.name).toBe('get_pending_prs');
    expect(typeof tool.handler).toBe('function');
  });

  it('getTool returns undefined for an unknown name', () => {
    expect(getTool('nonexistent_tool')).toBeUndefined();
  });

  it('getTool returns the same object as the tools array entry', () => {
    tools.forEach((tool) => {
      expect(getTool(tool.name)).toBe(tool);
    });
  });
});

describe('Tools Manifest — known tool spot-checks', () => {
  const EXPECTED_TOOLS = [
    'get_pending_prs',
    'create_task',
    'query_tasks',
    'update_task',
    'set_reminder',
    'query_reminders',
    'summarize_channel',
    'get_triage_status',
    'add_triage_rule',
    'remove_triage_rule',
    'list_triage_rules',
    'get_daily_summary',
    'query_calendar',
    'create_calendar_event',
    'add_mention_watch',
    'remove_mention_watch',
    'list_mention_watches',
    'start_onboarding',
    'evolve_donna',
  ];

  it('all expected tool names are present in the manifest', () => {
    const toolNames = new Set(tools.map(t => t.name));
    EXPECTED_TOOLS.forEach((name) => {
      expect(toolNames.has(name), `Expected tool "${name}" to be in the manifest`).toBe(true);
    });
  });

  it('evolve_donna is marked adminOnly', () => {
    const tool = getTool('evolve_donna');
    expect(tool.adminOnly).toBe(true);
  });

  it('get_pending_prs does not require any parameters', () => {
    const tool = getTool('get_pending_prs');
    expect(tool.parameters.required).toBeUndefined();
  });

  it('create_task requires the title parameter', () => {
    const tool = getTool('create_task');
    expect(tool.parameters.required).toContain('title');
  });

  it('set_reminder requires text and time parameters', () => {
    const tool = getTool('set_reminder');
    expect(tool.parameters.required).toContain('text');
    expect(tool.parameters.required).toContain('time');
  });
});
