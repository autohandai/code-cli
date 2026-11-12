import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, saveConfig } from '../../src/config.js';
import { setConfigSetting, SETTINGS_REGISTRY } from '../../src/commands/settings.js';
import { AgentConfigSchema, AgentRegistry, parseInlineAgents } from '../../src/core/agents/AgentRegistry.js';
import { resolveSubagentIterationLimit } from '../../src/core/agents/subagentIterations.js';

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-subagent-limit-')); });
afterEach(async () => { await fs.remove(root); });

describe('sub-agent iteration configuration', () => {
  it('has a separate 30-request default and applies definition then per-call limits', () => {
    expect(resolveSubagentIterationLimit(undefined, undefined)).toBe(30);
    expect(resolveSubagentIterationLimit(50, 30)).toBe(50);
    expect(resolveSubagentIterationLimit(50, 30, 10)).toBe(10);
    expect(resolveSubagentIterationLimit(50, 30, 100)).toBe(50);
    expect(SETTINGS_REGISTRY.find(setting => setting.key === 'agent.subagentMaxIterations')?.defaultValue).toBe(30);
  });

  it.each(['json', 'yaml', 'toml'])('persists a validated default in %s without changing the main-agent limit', async format => {
    const configPath = path.join(root, `config.${format}`);
    await saveConfig({ configPath, provider: 'openai', agent: { maxIterations: 300 } });
    const config = await loadConfig(configPath, undefined, { initializeTheme: false });
    setConfigSetting(config, 'agent.subagentMaxIterations', '60');
    await saveConfig(config);
    const reloaded = await loadConfig(configPath, undefined, { initializeTheme: false });
    expect(reloaded.agent).toMatchObject({ maxIterations: 300, subagentMaxIterations: 60 });
  });

  it.each([0, -1, 1.5, 1001, '30', true, null])('rejects an invalid persisted default %j', async value => {
    const configPath = path.join(root, 'config.json');
    await fs.writeJson(configPath, { agent: { subagentMaxIterations: value } });
    await expect(loadConfig(configPath, undefined, { initializeTheme: false })).rejects.toThrow('agent.subagentMaxIterations must be an integer between 1 and 1000');
  });

  it.each(['0', '-1', '1.5', '1001', 'NaN', 'Infinity'])('rejects an invalid setting %s', value => {
    expect(() => setConfigSetting({ configPath: path.join(root, 'config.json') }, 'agent.subagentMaxIterations', value)).toThrow('integer between 1 and 1000');
  });

  it('preserves inline definition limits in the runtime registry', () => {
    const definitions = parseInlineAgents({ reviewer: { description: 'Review', prompt: 'Review.', maxIterations: 70 } });
    const registry = AgentRegistry.getInstance();
    registry.setSessionAgents(definitions);
    try { expect(registry.getAgent('reviewer')?.maxIterations).toBe(70); }
    finally { registry.clearSessionAgents(); }
  });

  it.each([0, 1.5, 1001, '30', null])('rejects an invalid agent-definition cap %j', maxIterations => {
    expect(() => parseInlineAgents({ reviewer: { description: 'Review', prompt: 'Review.', maxIterations } })).toThrow();
    expect(AgentConfigSchema.safeParse({ description: 'Review', systemPrompt: 'Review.', tools: [], maxIterations }).success).toBe(false);
  });

  it('reads maxIterations from agent frontmatter and skips an invalid definition', async () => {
    const directory = path.join(root, 'agents');
    await fs.ensureDir(directory);
    await fs.writeFile(path.join(directory, 'issue706-valid.md'), '---\ndescription: Review\ntools: read_file\nmaxIterations: 80\n---\nReview source.\n');
    await fs.writeFile(path.join(directory, 'issue706-invalid.md'), '---\ndescription: Invalid\nmaxIterations: -2\n---\nReview source.\n');
    const registry = AgentRegistry.getInstance();
    const original = registry.getExternalPaths();
    registry.setExternalPaths([directory]);
    try {
      await registry.loadAgents();
      expect(registry.getAgent('issue706-valid')?.maxIterations).toBe(80);
      expect(registry.getAgent('issue706-invalid')).toBeUndefined();
    } finally { registry.setExternalPaths(original); await registry.loadAgents(); }
  });
});
