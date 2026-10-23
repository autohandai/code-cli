import { describe, expect, it } from 'vitest';
import { parseWorkflowSkillHooks } from '../../../src/modes/acp/workflowHooks.js';

describe('ACP workflow skill hooks', () => {
  it('delivers matching file guidance once and restores guidance after every compaction', async () => {
    const hooks = parseWorkflowSkillHooks([
      { event: 'file-modified', skill: 'testing', context: 'Run relevant tests.', filter: { path: ['src/*.ts'] } },
      { event: 'context:compact', skill: 'context', context: 'Keep the acceptance criteria.' },
    ]);
    const context = { event: 'file-modified' as const, workspace: '/tmp', path: 'docs/readme.md' };
    expect(await hooks[0]!.handler(context)).toBeUndefined();
    expect(await hooks[0]!.handler({ ...context, path: 'src/index.ts' })).toEqual({ additionalContext: 'Run relevant tests.' });
    expect(await hooks[0]!.handler({ ...context, path: 'src/other.ts' })).toBeUndefined();
    const compact = { event: 'context:compact' as const, workspace: '/tmp' };
    expect(await hooks[1]!.handler(compact)).toEqual({ additionalContext: 'Keep the acceptance criteria.' });
    expect(await hooks[1]!.handler(compact)).toEqual({ additionalContext: 'Keep the acceptance criteria.' });
  });

  it('rejects malformed or unbounded metadata instead of silently changing semantics', () => {
    const hook = { event: 'file-modified', skill: 'testing', context: 'Run tests.' };
    expect(parseWorkflowSkillHooks(undefined)).toEqual([]);
    for (const value of [null, {}, [ { ...hook, command: 'publish' } ], [{ ...hook, event: 'not-an-event' }], [{ ...hook, async: true }], [{ ...hook, filter: { tool: 'write_file' } }], [{ ...hook, context: 'x'.repeat(65537) }], Array.from({ length: 101 }, () => hook)]) {
      expect(() => parseWorkflowSkillHooks(value)).toThrow();
    }
  });
  it.each(['pre-tool', 'post-tool'] as const)('delivers %s guidance once for a matching tool', async (event) => {
    const [hook] = parseWorkflowSkillHooks([{ event, skill: 'testing', context: 'Inspect the test evidence.', filter: { tool: ['run_command'] } }]);
    expect(await hook!.handler({ event, workspace: '/tmp', tool: 'read_file' })).toBeUndefined();
    expect(await hook!.handler({ event, workspace: '/tmp', tool: 'run_command' })).toEqual({ additionalContext: 'Inspect the test evidence.' });
    expect(await hook!.handler({ event, workspace: '/tmp', tool: 'run_command' })).toBeUndefined();
  });

});
