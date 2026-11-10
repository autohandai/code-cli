import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cancelAdaptiveSkillAuthoring, inspectAdaptiveSkillSettings, runAdaptiveSkillsTurn } from '../../src/testing/scenarios/adaptiveSkillsScenario.js';
import { SKILL_DISCOVERY_CONTRACT } from '../../src/skills/feature.js';
import { formatSkillReference } from '../../src/skills/SkillRuntime.js';
import { estimateTokens } from '../../src/core/context/tokenizer.js';
import { exitInteractive, repoRoot } from './helpers/autohandTuistory.js';
import { capturedToolResult, launchAdaptiveSkillsFixture, nativeToolNames, readAdaptiveSkillReceipts, requestMessages, requestText,
  saveAdaptiveRequestCapture, startupSkillContext, type AdaptiveSkillsFixture } from './helpers/adaptiveSkillsFixture.js';

const fixtures: AdaptiveSkillsFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.cleanup(); });

async function launch(options: Parameters<typeof launchAdaptiveSkillsFixture>[0]): Promise<AdaptiveSkillsFixture> {
  const fixture = await launchAdaptiveSkillsFixture(options);
  fixtures.push(fixture);
  return fixture;
}

function expectStableNativeBridge(fixture: AdaptiveSkillsFixture): void {
  expect(new Set(fixture.server.requests.map(request => JSON.stringify(request.tools))).size).toBe(1);
  for (const request of fixture.server.requests) {
    expect(nativeToolNames(request).sort()).toEqual(['ask_followup_question', 'run_tool_script', 'tool_search']);
  }
}

function expectBoundedStartupRequest(request: Record<string, unknown>): void {
  const messages = requestMessages(request);
  const messageEstimate = messages.reduce((sum, message) => sum + estimateTokens(message.content ?? '') + 10, 0);
  const schemaEstimate = estimateTokens(JSON.stringify(request.tools));
  expect(messageEstimate + schemaEstimate).toBeLessThanOrEqual(8_000);
}

describe('adaptive skills in the built CLI', () => {
  it.each([14, 1_000])('captures compact and adaptive greetings with %i local skills and zero prepared packets', async localSkills => {
    const policies: string[] = [];
    for (const adaptiveSkills of [false, true]) {
      const fixture = await launch({ adaptiveSkills, localSkills, turns: [{ content: 'ADAPTIVE_GREETING_DONE' }, { content: 'ADAPTIVE_SECOND_GREETING_DONE' }] });
      try {
        await runAdaptiveSkillsTurn(fixture.session, 'hello', 'ADAPTIVE_GREETING_DONE');
        await runAdaptiveSkillsTurn(fixture.session, 'thanks', 'ADAPTIVE_SECOND_GREETING_DONE');
        expect(fixture.server.requests).toHaveLength(2);
        expectStableNativeBridge(fixture);
        const first = requestText(fixture.server.requests[0]);
        expect(first).not.toContain('[Skill packet ');
        expect(first).not.toContain('ADAPTIVE_FIXTURE_BODY_');
        expect(first).not.toContain('Adaptive fixture workflow');
        expect(await readAdaptiveSkillReceipts(fixture)).toEqual([]);
        const fixtureNames = new Set(startupSkillContext(fixture.server.requests[0]).match(/\badaptive-fixture-\d+\b/g) ?? []);
        if (adaptiveSkills) {
          expectBoundedStartupRequest(fixture.server.requests[0]);
          expect(first).toContain(SKILL_DISCOVERY_CONTRACT);
          expect(first).not.toContain('<available_skills>');
          expect(fixtureNames.size).toBe(0);
          expect(estimateTokens(startupSkillContext(fixture.server.requests[0]))).toBeLessThanOrEqual(512);
        } else {
          expect(fixtureNames.size).toBe(localSkills);
          expect(fixtureNames.has('adaptive-fixture-0')).toBe(true);
          expect(fixtureNames.has(`adaptive-fixture-${localSkills - 1}`)).toBe(true);
        }
        const prefix = fixture.server.requests.map(request => JSON.stringify(requestMessages(request)[0]));
        expect(new Set(prefix).size).toBe(1);
        policies.push(JSON.stringify(fixture.server.requests[0].tools));
      } finally {
        await saveAdaptiveRequestCapture(fixture, `greeting-${adaptiveSkills ? 'adaptive' : 'eager'}-${localSkills}`);
        await exitInteractive(fixture.session);
      }
    }
    expect(new Set(policies).size).toBe(1);
  }, 120_000);

  it('finds the installed catalog and registry tools through the stable bridge, then attaches selected instructions in task context', async () => {
    const fixture = await launch({ adaptiveSkills: true, turns: [
      { content: 'Discovering skill tools.', toolCall: { id: 'skill-tools', name: 'tool_search', args: { query: 'skill find_agent_skills install_agent_skill', limit: 12 } } },
      { content: 'Searching the installed catalog.', toolCall: { id: 'skill-search', name: 'run_tool_script', args: {
        script: 'return await tools.skill({command:"search",name:"adaptive-fixture-13"});' } } },
      { content: 'Activating the selected skill.', toolCall: { id: 'skill-activate', name: 'run_tool_script', args: {
        script: 'return await tools.skill({command:"activate",name:"adaptive-fixture-13"});' } } },
      { content: 'ADAPTIVE_SKILL_SEARCH_DONE' },
    ] });
    try {
      await runAdaptiveSkillsTurn(fixture.session, 'Find the installed adaptive fixture workflow 13 and use it for this task.', 'ADAPTIVE_SKILL_SEARCH_DONE');
      expectStableNativeBridge(fixture);
      expect(capturedToolResult(fixture.server, 'skill-tools')).toContain('find_agent_skills');
      expect(capturedToolResult(fixture.server, 'skill-tools')).toContain('install_agent_skill');
      expect(capturedToolResult(fixture.server, 'skill-search')).toContain('adaptive-fixture-13');
      const first = requestText(fixture.server.requests[0]);
      expectBoundedStartupRequest(fixture.server.requests[0]);
      expect(first).not.toContain('ADAPTIVE_FIXTURE_BODY_13');
      const finalRequest = fixture.server.requests.at(-1)!;
      expect(requestText(finalRequest)).toContain('ADAPTIVE_FIXTURE_BODY_13');
      expect(requestMessages(finalRequest)[0].content).not.toContain('ADAPTIVE_FIXTURE_BODY_13');
      expect(new Set(fixture.server.requests.map(request => JSON.stringify(requestMessages(request)[0]))).size).toBe(1);
      const receipts = await readAdaptiveSkillReceipts(fixture);
      expect(receipts).toEqual([expect.objectContaining({ state: 'submitted', capability: 'provider-request',
        reference: expect.objectContaining({ packageId: 'adaptive-fixture-13', revision: expect.stringMatching(/^sha256:/) }),
        requestId: expect.any(String), taskId: expect.any(String) })]);
      const instructions = await readFile(path.join(fixture.state.workspaceRoot, '.agents/skills/adaptive-fixture-13/SKILL.md'), 'utf8');
      const suppliedPacket = `[Skill packet ${formatSkillReference(receipts[0].reference)}]\n\nResource: SKILL.md\n${instructions}`;
      expect(requestText(finalRequest)).toContain(suppliedPacket);
      expect(receipts[0].contentDigest).toBe(createHash('sha256').update(suppliedPacket).digest('hex'));
      expect(fixture.session.readAll()).toContain('Loaded adaptive-fixture-13');
    } finally {
      await saveAdaptiveRequestCapture(fixture, 'catalog-search-and-activation');
      await exitInteractive(fixture.session);
    }
  });

  it.each(['explicit', 'deep-research'] as const)('reuses the full built-in research package through %s invocation', async invocation => {
    const fixture = await launch({ adaptiveSkills: true, localSkills: 0, turns: [{ content: 'ADAPTIVE_BUILTIN_DONE' }] });
    try {
      const prompt = invocation === 'explicit' ? 'Use $deep-research to inspect this fixture topic.' : '/deep-research fixture topic';
      await runAdaptiveSkillsTurn(fixture.session, prompt, 'ADAPTIVE_BUILTIN_DONE');
      expectStableNativeBridge(fixture);
      const request = fixture.server.requests[0];
      const fullInstructions = await readFile(path.join(repoRoot(), 'src/skills/builtin/deep-research/SKILL.md'), 'utf8');
      const text = requestText(request);
      expect(text).toContain(fullInstructions);
      expect(text).toContain('[Skill packet skill://autohand%3Abuiltin/deep-research');
      expect(text.split(fullInstructions).length - 1).toBe(1);
      const body = fullInstructions.replace(/^---[\s\S]*?---\s*/, '').trim();
      expect(text.split(body).length - 1).toBe(1);
      expect(requestMessages(request)[0].content).not.toContain(fullInstructions);
      expect(await readAdaptiveSkillReceipts(fixture)).toEqual([expect.objectContaining({ state: 'submitted', capability: 'provider-request',
        reference: expect.objectContaining({ authority: 'autohand:builtin', packageId: 'deep-research' }) })]);
    } finally {
      await saveAdaptiveRequestCapture(fixture, `builtin-${invocation}`);
      await exitInteractive(fixture.session);
    }
  });

  it('retains local skill authoring and cancels its prompt before any model dispatch', async () => {
    const fixture = await launch({ adaptiveSkills: true, turns: [{ content: 'AUTHORING_UNEXPECTED_DISPATCH' }] });
    try {
      await cancelAdaptiveSkillAuthoring(fixture.session);
      expect(fixture.server.requests).toEqual([]);
      expect(await readAdaptiveSkillReceipts(fixture)).toEqual([]);
    } finally {
      await saveAdaptiveRequestCapture(fixture, 'local-authoring-cancel');
      await exitInteractive(fixture.session);
    }
  });

  it('exposes separate skill settings in the existing agent menu without enabling remote work', async () => {
    const fixture = await launch({ adaptiveSkills: true, turns: [{ content: 'SETTINGS_UNEXPECTED_DISPATCH' }] });
    try {
      const screen = await inspectAdaptiveSkillSettings(fixture.session);
      expect(screen).toContain('Automatic skill learning');
      const config = JSON.parse(await readFile(fixture.state.configPath, 'utf8')) as { features: { adaptiveSkills: boolean }; skills?: { learning?: { enabled?: boolean }; decisions?: { enabled?: boolean } } };
      expect(config.features.adaptiveSkills).toBe(true);
      expect(config.skills?.learning?.enabled).toBe(false);
      expect(config.skills?.decisions?.enabled).toBeUndefined();
      expect(fixture.server.requests).toEqual([]);
      expect(await readAdaptiveSkillReceipts(fixture)).toEqual([]);
    } finally {
      await saveAdaptiveRequestCapture(fixture, 'settings-controls');
      await exitInteractive(fixture.session);
    }
  });
});
