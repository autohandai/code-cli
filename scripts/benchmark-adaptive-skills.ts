import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { estimateTokens } from '../src/core/context/tokenizer.js';
import { SystemPromptBuilder } from '../src/core/agent/SystemPromptBuilder.js';
import { SkillRuntime, formatSkillReference } from '../src/skills/SkillRuntime.js';
import { SKILL_DISCOVERY_CONTRACT } from '../src/skills/feature.js';
import { ADAPTIVE_AUTHORIZED_SCOPES, ADAPTIVE_CATALOG_SIZES, createAdaptiveCatalog, loadAdaptiveSkillsCorpus } from '../tests/skills/helpers/adaptiveSkillsCorpus.js';

const COLD_ROUNDS = 7;
const WARM_ROUNDS = 200;

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function rounded(value: number): number { return Number(value.toFixed(4)); }
function summarize(samples: number[]): { samplesMs: number[]; p50Ms: number; p95Ms: number } {
  const sorted = samples.slice().sort((a, b) => a - b);
  return { samplesMs: samples.map(rounded), p50Ms: rounded(sorted[Math.ceil(sorted.length * 0.5) - 1] ?? 0),
    p95Ms: rounded(sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0) };
}

function startupSkillSection(prompt: string): string {
  const marker = /^## (?:Skill Discovery|Available Skills|Active Skills)\n/m.exec(prompt);
  if (!marker) return '';
  const end = prompt.indexOf('\n## ', marker.index + marker[0].length);
  return prompt.slice(marker.index, end < 0 ? undefined : end).trim();
}

async function measureStartupPrompt(entries: ReturnType<typeof createAdaptiveCatalog>, adaptiveSkills: boolean) {
  let catalogReads = 0;
  let activeInstructionReads = 0;
  const prompt = await new SystemPromptBuilder({
    runtime: { options: { bare: true }, workspaceRoot: '/synthetic-adaptive-skills-workspace',
      config: { configPath: '/synthetic-adaptive-skills-workspace/config.json', features: { adaptiveSkills, codeMode: true, slashGoal: false }, agent: { autoMemory: false } } },
    supportsNativeToolCalling: true,
    getToolDefinitions: () => [], getContextMemories: async () => '', loadInstructionFiles: async () => [], getTeam: () => null,
    listSkills: () => {
      catalogReads++;
      return entries.filter(entry => entry.enabled && entry.compatible !== false && ADAPTIVE_AUTHORIZED_SCOPES.has(entry.scope))
        .map(entry => ({ name: entry.name, description: entry.description }));
    },
    getActiveSkills: () => { activeInstructionReads++; return []; },
  }).build();
  const section = startupSkillSection(prompt);
  return { adaptiveSkills, catalogReads, activeInstructionReads, systemPromptChars: prompt.length, estimatedSystemPromptTokens: estimateTokens(prompt),
    leadingPolicySha256: sha256(prompt), skillSectionChars: section.length, estimatedSkillSectionTokens: estimateTokens(section),
    skillSectionSha256: sha256(section), systemPrompt: prompt };
}

async function main(): Promise<void> {
  const outputIndex = process.argv.indexOf('--output');
  const outputRoot = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] ?? '' : './.artifacts/adaptive-skills');
  const corpus = await loadAdaptiveSkillsCorpus();
  const queries = corpus.queries.map(fixture => fixture.query);
  const startupPrompts = new Map<number, { eager: Awaited<ReturnType<typeof measureStartupPrompt>>; adaptive: Awaited<ReturnType<typeof measureStartupPrompt>> }>();
  for (const size of ADAPTIVE_CATALOG_SIZES) {
    const entries = createAdaptiveCatalog(corpus, size);
    startupPrompts.set(size, { eager: await measureStartupPrompt(entries, false), adaptive: await measureStartupPrompt(entries, true) });
  }
  const results = ADAPTIVE_CATALOG_SIZES.map(size => {
    const entries = createAdaptiveCatalog(corpus, size);
    const createRuntime = () => new SkillRuntime({ catalog: () => entries, authorizedScopes: () => ADAPTIVE_AUTHORIZED_SCOPES });
    const coldSamples: number[] = [];
    for (let round = 0; round < COLD_ROUNDS; round++) {
      const started = performance.now();
      createRuntime().search('debugging failures', 8);
      coldSamples.push(performance.now() - started);
    }
    const runtime = createRuntime();
    runtime.search('debugging failures', 8);
    const warmSamples: number[] = [];
    for (let round = 0; round < WARM_ROUNDS; round++) {
      const started = performance.now();
      runtime.search(queries[round % queries.length], 8);
      warmSamples.push(performance.now() - started);
    }
    const selection = corpus.queries.map(fixture => {
      const actual = runtime.search(fixture.query, 32).map(result => formatSkillReference(result.entry.reference)).sort();
      const expected = size === 0 ? [] : fixture.expected.slice().sort();
      return { query: fixture.query, expected, actual, passed: JSON.stringify(actual) === JSON.stringify(expected),
        ...(fixture.language ? { language: fixture.language, support: fixture.support } : {}) };
    });
    const exactTargets = entries.filter(entry => entry.enabled && entry.compatible !== false && ADAPTIVE_AUTHORIZED_SCOPES.has(entry.scope));
    const exactSamples = [exactTargets[0], exactTargets[Math.floor(exactTargets.length / 2)], exactTargets.at(-1)].filter(entry => entry !== undefined);
    const warm = summarize(warmSamples);
    return { catalogSize: size, catalogMetadataChars: entries.reduce((sum, entry) => sum + entry.name.length + entry.description.length, 0),
      authorizedCompatibleEntries: exactTargets.length, cold: summarize(coldSamples), warm,
      provisionalWarmP95TargetMs: 200, withinProvisionalTarget: warm.p95Ms <= 200,
      fixtureCases: selection, explicitSampleCount: exactSamples.length,
      explicitSamplesPassed: exactSamples.every(entry => runtime.resolve(formatSkillReference(entry.reference)) === entry),
      startupDiscoveryContract: { chars: SKILL_DISCOVERY_CONTRACT.length, estimatedTokens: estimateTokens(SKILL_DISCOVERY_CONTRACT),
        sha256: sha256(SKILL_DISCOVERY_CONTRACT), includesCatalog: false, includesInstructions: false },
      startupPrompts: startupPrompts.get(size)!,
      receiptsAfterMetadataOnlyWork: runtime.receipts().length };
  });
  const report = { version: 1, generatedAt: new Date().toISOString(), kind: 'deterministic-local-contract-and-lookup-benchmark',
    repositoryCommit: execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: path.resolve(import.meta.dirname, '..') }).trim(),
    dirtyTree: execFileSync('/usr/bin/git', ['status', '--porcelain'], { encoding: 'utf8', cwd: path.resolve(import.meta.dirname, '..') }).trim().length > 0,
    manifestSha256: sha256(await readFile(path.join(import.meta.dirname, '../package.json'), 'utf8')),
    corpusSha256: sha256(JSON.stringify(corpus)), harnessSha256: sha256(await readFile(import.meta.filename, 'utf8')),
    runtimeSha256: sha256(await readFile(path.join(import.meta.dirname, '../src/skills/SkillRuntime.ts'), 'utf8')),
    machine: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(), runtime: process.version, bun: process.versions.bun ?? null },
    settings: { coldRounds: COLD_ROUNDS, warmRounds: WARM_ROUNDS, topK: 8, scopes: [...ADAPTIVE_AUTHORIZED_SCOPES],
      tokenizer: 'src/core/context/tokenizer.ts estimateTokens default character heuristic; not a model tokenizer',
      network: 'no network requests', provider: null, decisionModel: null, learnedLibrary: null },
    costs: { paidInferenceRequests: 0, providerBilledTokens: null, providerBilledCost: null },
    adaptiveStartupPrefixInvariant: new Set([...startupPrompts.values()].map(prompt => prompt.adaptive.leadingPolicySha256)).size === 1,
    limitations: ['Fixture selection cases are deterministic contracts, not a powered task-quality or learned-transfer experiment.',
      'Character counts and heuristic token estimates are separate metrics; no provider usage, billing, or prompt-cache savings are measured.',
      'Cold lookup includes constructing the metadata token cache; fixture JSON parsing and filesystem catalog discovery are excluded.',
      'Multilingual cases demonstrate lexical Unicode metadata matching, not translation or cross-language semantic retrieval.',
      'SystemPromptBuilder captures use synthetic callbacks and bare workspace options; actual CLI request captures are reported separately.'],
    results };
  const rows = results.map(result => `| ${result.catalogSize} | ${result.authorizedCompatibleEntries} | ${result.cold.p50Ms} | ${result.cold.p95Ms} | ${result.warm.p50Ms} | ${result.warm.p95Ms} | ${result.fixtureCases.filter(fixture => fixture.passed).length}/${result.fixtureCases.length} |`).join('\n');
  const promptRows = results.map(result => `| ${result.catalogSize} | ${result.startupPrompts.eager.skillSectionChars} | ${result.startupPrompts.eager.estimatedSkillSectionTokens} | ${result.startupPrompts.adaptive.skillSectionChars} | ${result.startupPrompts.adaptive.estimatedSkillSectionTokens} |`).join('\n');
  const markdown = `# Adaptive skills deterministic evaluation\n\nGenerated ${report.generatedAt}. Commit ${report.repositoryCommit}; working tree modified.\n\nNo inference or paid calls. No task-quality, learning, or reuse claim.\n\n| Catalog | Authorized compatible | Cold p50 ms | Cold p95 ms | Warm p50 ms | Warm p95 ms | Fixture cases |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows}\n\n| Catalog | Eager skill chars | Eager estimated tokens | Adaptive skill chars | Adaptive estimated tokens |\n| --- | --- | --- | --- | --- |\n${promptRows}\n\nAdaptive full startup prefix invariant across catalog sizes: ${report.adaptiveStartupPrefixInvariant}. Constant discovery contract: ${SKILL_DISCOVERY_CONTRACT.length} characters; ${estimateTokens(SKILL_DISCOVERY_CONTRACT)} estimated tokens using the repository character heuristic. Actual request context is measured separately.\n\n${report.limitations.map(value => `- ${value}`).join('\n')}\n`;
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, 'adaptive-skills-benchmark.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(outputRoot, 'adaptive-skills-benchmark.md'), markdown);
  console.log(JSON.stringify({ outputRoot, results: results.map(result => ({ catalogSize: result.catalogSize, coldP95Ms: result.cold.p95Ms, warmP95Ms: result.warm.p95Ms,
    fixtureCasesPassed: result.fixtureCases.filter(fixture => fixture.passed).length, fixtureCasesTotal: result.fixtureCases.length })) }, null, 2));
  if (!report.adaptiveStartupPrefixInvariant || results.some(result => !result.explicitSamplesPassed
    || result.startupPrompts.adaptive.estimatedSkillSectionTokens > 512 || result.startupPrompts.adaptive.catalogReads > 0
    || result.startupPrompts.adaptive.activeInstructionReads > 0 || result.fixtureCases.some(fixture => !fixture.passed))) process.exitCode = 1;
}

await main();
