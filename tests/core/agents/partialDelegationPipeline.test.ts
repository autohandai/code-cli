import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionExecutor } from '../../../src/core/actionExecutor.js';
import { FileActionManager } from '../../../src/actions/filesystem.js';
import { AgentDelegator } from '../../../src/core/agents/AgentDelegator.js';
import { AgentRegistry } from '../../../src/core/agents/AgentRegistry.js';
import { ToolManager, CODE_MODE_TOOL_DEFINITION, DEFAULT_TOOL_DEFINITIONS } from '../../../src/core/toolManager.js';
import { runCodeModeScript } from '../../../src/core/agent/CodeModeRunner.js';
import { PermissionManager } from '../../../src/permissions/PermissionManager.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';
import type { LoadedConfig } from '../../../src/types.js';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });

describe('partial delegation through the real tool pipeline', () => {
  it.each(['native', 'code-mode'] as const)('preserves typed partial work through %s dispatch, child tools and the final report', async route => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-partial-pipeline-'));
    directories.push(directory);
    await fs.writeFile(path.join(directory, 'fixture.txt'), 'REAL_FILESYSTEM_FINDING');
    const config = { configPath: '', provider: 'openai', features: { codeMode: true }, agent: { subagentMaxIterations: 2 } } as LoadedConfig;
    const requests: Array<Parameters<LLMProvider['complete']>[0]> = [];
    const provider: LLMProvider = {
      getName: () => 'openai', setModel: () => {}, listModels: async () => [], isAvailable: async () => true,
      getCapabilities: () => ({ nativeToolCalling: true }),
      complete: async request => {
        requests.push(structuredClone(request));
        return request.tools
          ? { id: 'read', created: 0, raw: null, content: '', toolCalls: [{ id: 'read-script', type: 'function', function: { name: 'run_tool_script', arguments: JSON.stringify({ script: "return await tools.read_file({path:'fixture.txt'});" }) } }] }
          : { id: 'partial', created: 0, raw: null, content: 'Inspected fixture; further validation remains.' };
      },
    };
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue({ name: 'reader', source: 'session', path: '<inline>', description: 'Read fixture', systemPrompt: 'Read assigned fixture.', tools: ['read_file'] });
    const permissionManager = new PermissionManager({ mode: 'unrestricted' });
    const executor = new ActionExecutor({ runtime: { workspaceRoot: directory, config, options: {} }, files: new FileActionManager(directory), permissionManager, resolveWorkspacePath: value => path.resolve(directory, value), confirmDangerousAction: async () => true });
    const delegator = new AgentDelegator(provider, executor, { workspaceRoot: directory, projectMemoryEnabled: false, featureConfig: config, maxDepth: 1, authorization: { permissionManager } });
    const manager: ToolManager = new ToolManager({
      definitions: [...DEFAULT_TOOL_DEFINITIONS.filter(definition => definition.name === 'delegate_task'), CODE_MODE_TOOL_DEFINITION],
      authorization: { permissionManager }, confirmApproval: async () => true,
      executor: async (action, context) => {
        if (action.type === 'delegate_task') return delegator.delegateTaskForTool(action.agent_name, action.task, { signal: context?.signal });
        if (action.type === 'run_tool_script') return runCodeModeScript(manager, { script: action.script, toolCallId: context?.toolCallId ?? 'outer-script', signal: context?.signal, context });
        throw new Error('Unexpected outer tool');
      },
    });
    const [result] = await manager.execute([route === 'native'
      ? { tool: 'delegate_task', args: { agent_name: 'reader', task: 'Read fixture and verify all behavior.' } }
      : { tool: 'run_tool_script', args: { script: "const worker = await tools.delegate_task({agent_name:'reader',task:'Read fixture and verify all behavior.'}); if (worker.status !== 'partial') throw new Error('Partial status was lost in the real tool pipeline'); return {status:worker.status,reason:worker.reason,output:worker.output};" } }]);
    expect(result.success).toBe(true);
    const delivered = route === 'native' ? result : JSON.parse(result.output ?? '{}').result;
    expect(delivered).toMatchObject({ status: 'partial', reason: 'iteration_limit', output: expect.stringContaining('Inspected fixture') });
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1].messages)).toContain('REAL_FILESYSTEM_FINDING');
    expect(requests[1].tools).toBeUndefined();
  });
});
