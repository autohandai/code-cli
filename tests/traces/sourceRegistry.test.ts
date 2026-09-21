import { describe, expect, it } from 'vitest';
import { TRACE_HARNESSES, createTraceSourceRegistry } from '../../src/traces/adapters/sourceRegistry.js';

describe('trace source registry', () => {
  it('registers the 18 documented external harnesses plus Autohand', () => {
    expect(TRACE_HARNESSES).toEqual([
      'autohand',
      'claude-code',
      'cursor',
      'opencode',
      'opencode2',
      'codex',
      'pi',
      'amp',
      'copilot',
      'cline',
      'openclaw',
      'hermes',
      'droid',
      'grok',
      'kimi',
      'antigravity',
      'prime-agent',
      'fx',
      'deepseek',
    ]);
    expect(new Set(TRACE_HARNESSES).size).toBe(19);
  });

  it('gives every harness a unique Adapter with bounded source locations and formats', () => {
    const registry = createTraceSourceRegistry({
      homeDirectory: '/Users/tester',
      autohandHome: '/Users/tester/.autohand',
      environment: {
        XDG_DATA_HOME: '/Users/tester/.xdg/data',
        XDG_CONFIG_HOME: '/Users/tester/.xdg/config',
        KIMI_CODE_HOME: '/Users/tester/custom-kimi',
        DSH_HOME: '/Users/tester/custom-deepseek',
        CLAUDE_CONFIG_DIR: '/Users/tester/custom-claude',
        CODEX_HOME: '/Users/tester/custom-codex',
        CLINE_DATA_DIR: '/Users/tester/custom-cline',
        TRACES_CURSOR_GLOBAL_DB: '/Users/tester/mounted-cursor/state.vscdb',
      },
      platform: 'darwin',
    });

    expect(registry.list()).toHaveLength(19);
    for (const harness of TRACE_HARNESSES) {
      const adapter = registry.get(harness);
      expect(adapter?.harness).toBe(harness);
      expect(adapter?.locations.length).toBeGreaterThan(0);
      expect(adapter?.locations.length).toBeLessThanOrEqual(8);
      expect(adapter?.formats.length).toBeGreaterThan(0);
    }
    expect(registry.get('kimi')?.locations).toContain('/Users/tester/custom-kimi/sessions');
    expect(registry.get('deepseek')?.locations).toContain('/Users/tester/custom-deepseek/sessions');
    expect(registry.get('opencode')?.locations).toEqual([
      '/Users/tester/.xdg/data/opencode/opencode.db',
      '/Users/tester/.xdg/data/opencode/storage/session',
      '/Users/tester/.xdg/data/opencode/storage/message',
      '/Users/tester/.xdg/data/opencode/storage/part',
    ]);
    expect(registry.get('opencode2')?.locations).toEqual([
      '/Users/tester/.xdg/data/opencode/opencode.db',
      '/Users/tester/.xdg/data/opencode/opencode-local.db',
    ]);
    expect(registry.get('claude-code')?.locations).toEqual(['/Users/tester/custom-claude/projects']);
    expect(registry.get('codex')?.locations).toEqual(['/Users/tester/custom-codex/sessions']);
    expect(registry.get('cursor')?.locations).toContain('/Users/tester/mounted-cursor/state.vscdb');
    expect(registry.get('cline')?.locations).toContain('/Users/tester/custom-cline/sessions');
  });

  it('covers each native store used by multi-agent and desktop harness variants', () => {
    const registry = createTraceSourceRegistry({
      homeDirectory: '/Users/tester',
      autohandHome: '/Users/tester/.autohand',
      environment: {},
      platform: 'darwin',
    });

    expect(registry.get('claude-code')?.locations).toContain(
      '/Users/tester/Library/Application Support/Claude/local-agent-mode-sessions',
    );
    expect(registry.get('claude-code')?.locations).toContain(
      '/Users/tester/Library/Application Support/Claude/claude-code-sessions',
    );
    expect(registry.get('cursor')?.locations).not.toContain('/Users/tester/.cursor/projects');
    expect(registry.get('cursor')?.locations).toContain(
      '/Users/tester/Library/Application Support/Cursor/User/globalStorage/state.vscdb',
    );
    expect(registry.get('cursor')?.formats).toEqual(expect.arrayContaining(['json', 'jsonl', 'sqlite']));
    expect(registry.get('cline')?.locations).toContain(
      '/Users/tester/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks',
    );
    expect(registry.get('copilot')?.locations).toContain(
      '/Users/tester/Library/Application Support/Code/User/globalStorage/emptyWindowChatSessions',
    );
    expect(registry.get('copilot')?.locations).toContain('/Users/tester/.copilot/session-state');
    expect(registry.get('cline')?.locations).toContain('/Users/tester/.cline/data/tasks');
    expect(registry.get('cline')?.locations).toContain('/Users/tester/.cline/data/sessions');
    expect(registry.get('cline')?.locations).toContain(
      '/Users/tester/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks',
    );
    expect(registry.get('pi')?.locations).toEqual(['/Users/tester/.pi/agent/sessions']);
    expect(registry.get('amp')?.locations).toEqual([
      '/Users/tester/.local/share/amp/threads',
      '/Users/tester/.local/share/amp/history.jsonl',
    ]);
    expect(registry.get('grok')?.locations).toEqual(['/Users/tester/.grok/sessions']);
    expect(registry.get('kimi')?.locations).toEqual(['/Users/tester/.kimi-code/sessions', '/Users/tester/.kimi/sessions']);
    expect(registry.get('hermes')?.locations).toEqual([
      '/Users/tester/.hermes/state.db',
      '/Users/tester/.local/share/hermes/state.db',
    ]);
    expect(registry.get('openclaw')?.locations).toEqual(['/Users/tester/.openclaw/agents']);
    expect(registry.get('antigravity')?.locations).toEqual(expect.arrayContaining([
      '/Users/tester/.gemini/antigravity-cli/sessions',
      '/Users/tester/.gemini/antigravity/conversations',
      '/Users/tester/.gemini/antigravity-ide/conversations',
    ]));
    expect(registry.get('prime-agent')?.locations).toEqual(['/Users/tester/.prime/agent/sessions']);
  });
});
