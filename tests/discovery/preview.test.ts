/** @license Apache-2.0 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDiscoveryPreview, isWorkflowDiscoveryShortcut } from '../../src/discovery/preview.js';
import { isAgentSlashCommand, parseAgentSlashCommand } from '../../src/core/agent/AgentCommandRuntime.js';
import type { SkillDefinition } from '../../src/skills/types.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(source: string) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'discovery-preview-'));
  roots.push(workspaceRoot);
  const entry = path.join(workspaceRoot, 'fixture.mjs');
  await writeFile(entry, source);
  return { workspaceRoot, executable: process.execPath, prefix: [entry] };
}

const skill: SkillDefinition = { name: 'workflow-discovery', description: 'fixture', body: 'fixture', source: 'builtin', path: '/fixture/SKILL.md', isActive: false };
describe('workflow discovery front door', () => {
  it('routes only the current bundled bare invocation and preserves other skill identities and worker requests', () => {
    const registry = { getSkill: () => skill };
    const host = { runtime: { options: {} }, skillsRegistry: registry };
    expect(isAgentSlashCommand(host, '$workflow-discovery')).toBe(true);
    expect(parseAgentSlashCommand(host, '$workflow-discovery')).toEqual({ command: '/discovery', args: [] });
    for (const input of ['$workflow-discovery Analyze the supplied evidence', 'Use $workflow-discovery', '$other-skill']) {
      expect(isWorkflowDiscoveryShortcut(input, registry)).toBe(false);
    }
    expect(isWorkflowDiscoveryShortcut('$workflow-discovery', registry, true)).toBe(false);
    expect(isWorkflowDiscoveryShortcut('$workflow-discovery', { getSkill: () => ({ ...skill, source: 'agent-project' }) })).toBe(false);
    expect(isWorkflowDiscoveryShortcut('$workflow-discovery')).toBe(false);
  });

  it('executes the isolated collector with a literal workspace and read-only local flags', async () => {
    const options = await fixture(`console.log(JSON.stringify({args:process.argv.slice(2),child:process.env.AUTOHAND_DISCOVERY_CHILD,key:process.env.AUTOHAND_API_KEY}));`);
    const result = JSON.parse(await runDiscoveryPreview(options));
    expect(result.args).toEqual(['discovery', 'scan', '--workspace', options.workspaceRoot, '--depth', '0', '--dry-run', '--no-behavior']);
    expect(result.child).toBe('1'); expect(result.key).toBeUndefined();
    expect(result.args).not.toContain('--analyze'); expect(result.args).not.toContain('--push');
  });

  it('bounds failed child diagnostics without exposing access keys', async () => {
    const options = await fixture(`console.error('collector failed ahc_private_fixture sk-private_fixture');process.exit(2);`);
    await expect(runDiscoveryPreview(options)).rejects.toThrow('collector failed [redacted] [redacted]');
  });

  it('rejects empty and oversized reports', async () => {
    const empty = await fixture('process.exit(0)');
    await expect(runDiscoveryPreview(empty)).rejects.toThrow('no report');
    const oversized = await fixture(`process.stdout.write('x'.repeat(600000));`);
    await expect(runDiscoveryPreview(oversized)).rejects.toThrow('preview failed');
  });

  it('terminates a stalled collector at the deadline and supports cancellation before and after launch', async () => {
    const options = await fixture('setInterval(()=>{},1000)');
    await expect(runDiscoveryPreview({ ...options, timeoutMs: 50 })).rejects.toThrow('timed out');
    const stopped = new AbortController(); stopped.abort();
    await expect(runDiscoveryPreview({ ...options, signal: stopped.signal })).rejects.toThrow();
    const live = new AbortController();
    const pending = runDiscoveryPreview({ ...options, signal: live.signal });
    live.abort();
    await expect(pending).rejects.toThrow('cancelled');
  });
});
