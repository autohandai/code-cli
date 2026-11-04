import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Session } from 'tuistory';
import { z } from 'zod';
import { estimateTokens } from '../../../src/core/context/tokenizer.js';
import { createMockAutohandAINativeSequenceServer, createTempAutohandHome, launchBuiltAutohand, repoRoot,
  type MockNativeAssistantTurn, type MockNativeToolServer, type TuistoryTempState } from './autohandTuistory.js';

export interface AdaptiveSkillsFixture {
  session: Session;
  state: TuistoryTempState;
  server: MockNativeToolServer;
  adaptiveSkills: boolean;
  localSkills: number;
  cleanup(): Promise<void>;
}

export function requestMessages(request: Record<string, unknown>): Array<{ role: string; content?: string; tool_call_id?: string }> {
  return Array.isArray(request.messages) ? request.messages as Array<{ role: string; content?: string; tool_call_id?: string }> : [];
}

export function requestText(request: Record<string, unknown>): string {
  return requestMessages(request).map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')).join('\n');
}

export function startupSkillContext(request: Record<string, unknown>): string {
  const content = requestMessages(request)[0]?.content ?? '';
  const sections: string[] = [];
  for (const match of content.matchAll(/^## (?:Skill Discovery|Available Skills|Active Skills)\n/gm)) {
    const start = match.index;
    const end = content.indexOf('\n## ', start + match[0].length);
    sections.push(content.slice(start, end < 0 ? undefined : end).trim());
  }
  return sections.join('\n\n');
}

export function nativeToolNames(request: Record<string, unknown>): string[] {
  const tools = request.tools as Array<{ function: { name: string } }> | undefined;
  return tools?.map(tool => tool.function.name) ?? [];
}

export function capturedToolResult(server: MockNativeToolServer, callId: string): string {
  for (const request of server.requests) {
    const message = requestMessages(request).find(candidate => candidate.role === 'tool' && candidate.tool_call_id === callId);
    if (typeof message?.content === 'string') return message.content;
  }
  return '';
}

const receiptEventSchema = z.object({ _meta: z.object({ skillReceipt: z.object({
  taskId: z.string(), sessionId: z.string(), requestId: z.string(), contentDigest: z.string(),
  reference: z.object({ authority: z.string(), packageId: z.string(), revision: z.string().optional() }).passthrough(),
  state: z.enum(['submitted', 'supplied']), capability: z.enum(['provider-request', 'external-handoff']),
}).passthrough() }) });

export async function readAdaptiveSkillReceipts(fixture: AdaptiveSkillsFixture): Promise<Array<z.infer<typeof receiptEventSchema>['_meta']['skillReceipt']>> {
  const sessionsRoot = path.join(fixture.state.autohandHome, 'sessions');
  const directories = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const receipts: Array<z.infer<typeof receiptEventSchema>['_meta']['skillReceipt']> = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const content = await readFile(path.join(sessionsRoot, directory.name, 'conversation.jsonl'), 'utf8').catch(() => '');
    for (const line of content.split('\n').filter(Boolean)) {
      const parsed = receiptEventSchema.safeParse(JSON.parse(line));
      if (parsed.success) receipts.push(parsed.data._meta.skillReceipt);
    }
  }
  return receipts;
}

export async function launchAdaptiveSkillsFixture(options: {
  adaptiveSkills: boolean; localSkills?: number; turns: MockNativeAssistantTurn[]; env?: Record<string, string | undefined>;
}): Promise<AdaptiveSkillsFixture> {
  const server = await createMockAutohandAINativeSequenceServer(options.turns);
  const state = await createTempAutohandHome({ config: {
    provider: 'custom:adaptive-fixture',
    customProviders: { 'adaptive-fixture': { id: 'adaptive-fixture', displayName: 'Adaptive Skills Fixture', apiFormat: 'openai-compatible',
      apiKeyRequired: false, model: 'fixture-model', baseUrl: server.baseUrl, backgroundCalls: false, maxConcurrentThreads: 1 } },
    features: { adaptiveSkills: options.adaptiveSkills, codeMode: true, autohand_inference: true },
    agent: { autoMemory: false, maxIterations: 6, sessionRetryLimit: 0 },
    network: { maxRetries: 0, retryDelay: 0 },
    ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
  } });
  const localSkills = options.localSkills ?? 14;
  try {
    await Promise.all(Array.from({ length: localSkills }, async (_, index) => {
      const root = path.join(state.workspaceRoot, '.agents/skills', `adaptive-fixture-${index}`);
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, 'SKILL.md'), `---\nname: adaptive-fixture-${index}\ndescription: Adaptive fixture workflow ${index}\n---\nADAPTIVE_FIXTURE_BODY_${index}\nPreserve every acceptance criterion.\n`);
    }));
    const session = await launchBuiltAutohand(['--config', state.configPath, '--path', state.workspaceRoot], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, rows: 50,
      env: { HOME: state.autohandHome, PATH: process.env.PATH,
        OPENROUTER_API_KEY: undefined, OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined,
        AUTOHAND_API_KEY: undefined, AUTOHAND_AUTH_TOKEN: undefined, AUTOHAND_DEBUG: undefined, ...options.env },
    });
    return { session, state, server, adaptiveSkills: options.adaptiveSkills, localSkills,
      cleanup: async () => { session.close(); await server.close(); await state.cleanup(); } };
  } catch (error) {
    await server.close();
    await state.cleanup();
    throw error;
  }
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }

async function packageManifests(base: string): Promise<Array<{ packageId: string; resources: Array<{ path: string; sha256: string; bytes: number }> }>> {
  const packages = await readdir(base, { withFileTypes: true }).catch(() => []);
  const manifests: Array<{ packageId: string; resources: Array<{ path: string; sha256: string; bytes: number }> }> = [];
  for (const directory of packages) {
    if (!directory.isDirectory()) continue;
    const root = path.join(base, directory.name);
    const resources: Array<{ path: string; sha256: string; bytes: number }> = [];
    const walk = async (relative: string): Promise<void> => {
      for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
        const resource = path.join(relative, entry.name);
        if (entry.isDirectory()) await walk(resource);
        else if (entry.isFile()) {
          const content = await readFile(path.join(root, resource));
          resources.push({ path: resource.split(path.sep).join('/'), sha256: createHash('sha256').update(content).digest('hex'), bytes: content.byteLength });
        }
      }
    };
    await walk('');
    manifests.push({ packageId: directory.name, resources: resources.sort((a, b) => a.path.localeCompare(b.path)) });
  }
  return manifests.sort((a, b) => a.packageId.localeCompare(b.packageId));
}

export async function saveAdaptiveRequestCapture(fixture: AdaptiveSkillsFixture, name: string): Promise<void> {
  const outputRoot = process.env.AUTOHAND_ADAPTIVE_EVAL_OUTPUT;
  if (!outputRoot) return;
  await mkdir(outputRoot, { recursive: true });
  const requests = fixture.server.requests;
  const summaries = requests.map((request, index) => {
    const text = requestText(request);
    const firstMessage = requestMessages(request)[0];
    const tools = JSON.stringify(request.tools ?? []);
    const skillContext = startupSkillContext(request);
    return { index, messageChars: text.length, estimatedMessageTokens: estimateTokens(text),
      startupSkillContextChars: skillContext.length, estimatedStartupSkillContextTokens: estimateTokens(skillContext),
      nativeSchemaChars: tools.length, estimatedNativeSchemaTokens: estimateTokens(tools), nativeToolNames: nativeToolNames(request),
      nativeSchemaSha256: hash(tools), leadingPolicySha256: hash(JSON.stringify(firstMessage)),
      preparedPacketCount: (text.match(/\[Skill packet skill:\/\//g) ?? []).length,
      fixtureInstructionBodies: (text.match(/ADAPTIVE_FIXTURE_BODY_\d+/g) ?? []).length,
      catalogMetadataEntries: (text.match(/Adaptive fixture workflow \d+/g) ?? []).length };
  });
  await writeFile(path.join(outputRoot, `${name}.json`), `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), kind: 'real-built-cli-local-http-fixture',
    repositoryCommit: execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: repoRoot() }).trim(),
    adaptiveSkills: fixture.adaptiveSkills, localSkills: fixture.localSkills, provider: 'custom:adaptive-fixture', model: 'fixture-model',
    settings: { backgroundCalls: false, autoMemory: false, codeMode: true },
    limitations: ['Scripted local HTTP responses; no inference or task-quality measurement.',
      'Usage values from the mock response are fixture constants and are not tokenizer or billing evidence.',
      'Token counts are the repository character heuristic; no provider prompt-cache or billed-token measurement.'],
    packageManifestSha256: hash(await readFile(path.join(repoRoot(), 'package.json'), 'utf8')),
    builtEntrypointSha256: hash(await readFile(path.join(repoRoot(), 'dist/index.js'), 'utf8')),
    builtinPackageManifests: await packageManifests(path.join(repoRoot(), 'src/skills/builtin')),
    localPackageManifests: await packageManifests(path.join(fixture.state.workspaceRoot, '.agents/skills')),
    paidInferenceRequests: 0, summaries, requests, receipts: await readAdaptiveSkillReceipts(fixture), terminal: fixture.session.readAll() }, null, 2)}\n`);
}
