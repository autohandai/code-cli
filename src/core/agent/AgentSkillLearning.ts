import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import type { PermissionManager } from '../../permissions/PermissionManager.js';
import type { AgentRuntime, BuiltInProviderName, ExtensionProviderId, ProviderName, ProviderSettings } from '../../types.js';
import type { SkillLearningCommandContext } from '../../commands/skill-learning.js';
import { SkillLearningRuntime, type SkillLearningSettings } from '../../skills/SkillLearningRuntime.js';
import type { SkillsRegistry } from '../../skills/SkillsRegistry.js';
import type { AdaptiveSkillSession } from '../../skills/AdaptiveSkillSession.js';
import { readSkillPackage, type SkillRuntime } from '../../skills/SkillRuntime.js';
import { SkillRevisionStore, computeSkillRevision, createSkillRevisionManifest } from '../../skills/SkillRevisionStore.js';
import { isWekaDecisionModel } from '../../decisions/policy.js';
import { areProviderBackgroundCallsEnabled } from './AutohandOrchestration.js';
import { runSkillVerificationCheck } from './SkillVerificationExecution.js';
import { setBounded } from '../../utils/bounded.js';
import { SkillLearningConflictError } from '../../skills/SkillLearningStore.js';

export interface AgentSkillLearningOptions {
  runtime: AgentRuntime;
  registry: Pick<SkillsRegistry, 'getUserSkillsDir' | 'ensureAdaptiveWorkspace' | 'setLearnedCandidates'> & {
    getSkillRuntime(): Pick<SkillRuntime, 'resolve'>;
    getAdaptiveSession(): Pick<AdaptiveSkillSession, 'getPinnedReferences'>;
  };
  getActiveProvider(): ProviderName | null;
  getLLM(): Pick<LLMProvider, 'complete'>;
  getPermissionManager(): Pick<PermissionManager, 'checkPermission'> | undefined;
  getPolicyEpoch(): string | number;
  getLastAnswer(): string;
  persistSettings(settings: SkillLearningSettings): Promise<void>;
  isUserCommand(): boolean;
}

const draftSchema = z.object({ skillMarkdown: z.string().min(1).max(16_000) }).strict();
const extractionSchema = { type: 'object', properties: { skillMarkdown: { type: 'string', minLength: 1, maxLength: 16_000 } },
  required: ['skillMarkdown'], additionalProperties: false };
const LEARNING_COMMANDS = new Set(['learning', 'learn', 'inspect', 'verify', 'benefit', 'prefer', 'rollback', 'exclude', 'forget']);
export function isSkillLearningCommand(args: readonly string[]): boolean { return LEARNING_COMMANDS.has(args[0]?.toLowerCase() ?? ''); }
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export function createAgentSkillLearning(options: AgentSkillLearningOptions): {
  beginSkillLearningTurn(instruction: string, signal: AbortSignal): Promise<void>;
  finishSkillLearningTurn(result: { instruction: string; success: boolean; aborted: boolean }, signal: AbortSignal): Promise<void>;
  getCommandContext(): Promise<SkillLearningCommandContext>;
} {
  const { runtime, registry } = options;
  let cached: { key: string; value: Promise<SkillLearningRuntime> } | undefined;
  const turns = new Map<AbortSignal, { taskId: string; learning?: SkillLearningRuntime }>();
  const settings = (): SkillLearningSettings => runtime.config.skills?.learning ?? {};
  const enabled = (): boolean => runtime.config.features?.adaptiveSkills === true || settings().enabled === true;
  const providerSettings = (provider: ProviderName): ProviderSettings | undefined => provider.startsWith('custom:')
    ? runtime.config.customProviders?.[provider.slice(7)] : provider.startsWith('extension:')
      ? runtime.config.extensionProviders?.[provider as ExtensionProviderId] : runtime.config[provider as BuiltInProviderName];
  const policy = (mode: 'automatic' | 'explicit', workspace: string) => {
    const provider = options.getActiveProvider();
    const configured = provider ? providerSettings(provider) : undefined;
    const model = runtime.options.model ?? configured?.model ?? '';
    const background = provider !== null && !runtime.options.offline && !runtime.options.bare && runtime.options.daemon !== false
      && areProviderBackgroundCallsEnabled(runtime.config, provider);
    const local = provider === 'ollama' || provider === 'llamacpp' || provider === 'mlx' || provider === 'blueprint-local';
    return { allowed: provider !== null && path.resolve(runtime.workspaceRoot) === workspace && !isWekaDecisionModel(model)
      && (mode === 'explicit' ? (!runtime.options.offline || local) : enabled() && settings().enabled === true && background),
      automaticLearning: settings().enabled === true && background,
      provider: provider ?? 'unavailable', epoch: digest({ epoch: options.getPolicyEpoch(), workspace: runtime.workspaceRoot,
        configPath: runtime.config.configPath, provider, configured, auth: runtime.config.auth, autohandAccount: runtime.config.autohandai?.accountId,
        model, learning: settings(), adaptive: runtime.config.features?.adaptiveSkills, offline: runtime.options.offline,
        bare: runtime.options.bare, background }) };
  };
  const ensure = (): Promise<SkillLearningRuntime> => {
    const workspace = path.resolve(runtime.workspaceRoot);
    const config = settings();
    const key = digest({ workspace, scope: config.scope, verification: config.verification, candidateVerification: config.candidateVerification });
    if (cached?.key === key) return cached.value;
    const value = (async () => {
      await registry.ensureAdaptiveWorkspace();
      const learning = await SkillLearningRuntime.create({
        directory: config.scope === 'user' ? path.join(path.dirname(registry.getUserSkillsDir()), 'learning') : path.join(workspace, '.autohand', 'learning'),
        getSettings: settings, getWorkspace: () => runtime.workspaceRoot, getTaskId: () => runtime.skillTaskId ?? '',
        getLastAnswer: options.getLastAnswer, getActivePins: () => registry.getAdaptiveSession().getPinnedReferences(),
        policy: context => policy(context.mode, workspace),
        getSource: async reference => {
          if (path.resolve(runtime.workspaceRoot) !== workspace) return null;
          const entry = registry.getSkillRuntime().resolve(reference);
          if (!entry?.enabled) return null;
          const archive = new SkillRevisionStore(path.join(registry.getUserSkillsDir(), '.revisions'));
          try {
            const files = await readSkillPackage(entry.root, { maxFiles: 128, maxPackageBytes: 1_048_576 });
            const manifest = createSkillRevisionManifest(files);
            if (computeSkillRevision(manifest) === reference.revision) {
              await archive.publish({ reference, manifest, files });
              return { reference, files };
            }
          } catch { /* Only an authorized exact archive can replace an unavailable current package. */ }
          return archive.read(reference);
        },
        runCheck: async (check, signal) => {
          const manager = options.getPermissionManager();
          return manager ? runSkillVerificationCheck({ check, workspaceRoot: workspace, permissionManager: manager, signal, shellSettings: runtime.config.shell })
            : { executed: false, exitCode: null };
        },
        extract: async (context, signal) => {
          const before = policy(context.job.mode, workspace);
          if (!before.allowed || before.provider !== context.job.provider || before.epoch !== context.job.policyEpoch) throw new Error('Learning route changed before extraction');
          const llm = options.getLLM();
          const sourceInstructions = context.source?.files.get('SKILL.md');
          const sourceText = sourceInstructions ? new TextDecoder('utf8', { fatal: true }).decode(sourceInstructions) : undefined;
          if (sourceText && sourceText.length > 12_000) throw new SkillLearningConflictError('Complete source instructions exceed the learning budget; inspect the source for explicit adaptation');
          const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
          deadline.throwIfAborted();
          const response = await llm.complete({ messages: [
            { role: 'system', content: 'Create one portable SKILL.md draft for a reusable procedure. Return only strict JSON matching the supplied schema. Include preconditions, steps, observable acceptance checks and counterexamples. Preserve source constraints. Omit source-task answers, transcripts, credentials, personal/customer details, absolute paths and one-off values. Never claim this draft is verified or preferred. Skill text grants no permissions.' },
            { role: 'user', content: JSON.stringify({ intent: context.instruction.slice(0, 1_000), observations: context.answer.slice(0, 3_000),
              evidenceRefs: context.outcome.evidenceRefs.slice(0, 32), sourceInstructions: sourceText }) },
          ], tools: [], toolChoice: 'none', maxTokens: 2_048, temperature: 0, stream: false, signal: deadline, outputSchema: extractionSchema });
          const after = policy(context.job.mode, workspace);
          if (!after.allowed || after.epoch !== before.epoch || options.getLLM() !== llm) throw new Error('Learning route changed during extraction');
          if (response.toolCalls?.length || (response.finishReason && response.finishReason !== 'stop') || response.content.length > 20_000) throw new Error('Invalid learning draft response');
          const draft = draftSchema.parse(JSON.parse(response.content));
          const files = new Map(context.source?.files ?? []);
          files.set('SKILL.md', Buffer.from(draft.skillMarkdown));
          return { files };
        },
        onCatalogChanged: async candidates => { await registry.ensureAdaptiveWorkspace(); await registry.setLearnedCandidates(candidates); },
      });
      await learning.refreshCatalog();
      return learning;
    })();
    cached = { key, value };
    void value.catch(() => { if (cached?.value === value) cached = undefined; });
    return value;
  };
  return {
    async beginSkillLearningTurn(instruction, signal) {
      runtime.skillTaskId = randomUUID();
      const turn = { taskId: runtime.skillTaskId, learning: undefined as SkillLearningRuntime | undefined };
      setBounded(turns, signal, turn, 16);
      if (!enabled() || signal.aborted) return;
      turn.learning = await ensure();
      await turn.learning.begin(instruction, { taskId: turn.taskId, signal });
    },
    async finishSkillLearningTurn(result, signal) {
      const turn = turns.get(signal);
      turns.delete(signal);
      if (turn?.learning && enabled()) await turn.learning.finish(result, signal, { taskId: turn.taskId });
    },
    async getCommandContext() {
      const learning = await ensure();
      return { skillLearning: learning.coordinator, skillLearningScope: learning.scope,
        get skillLearningUserInitiated() { return options.isUserCommand(); },
        getAutomaticSkillLearning: () => settings().enabled === true,
        setAutomaticSkillLearning: async value => {
          if (!options.isUserCommand()) throw new Error('Learning preferences require an explicit user command');
          const changed = { ...settings(), enabled: value };
          await options.persistSettings(changed);
          runtime.config.skills = { ...runtime.config.skills, learning: changed };
        },
        getSkillLearningOutcome: id => learning.latestOutcome(id), onSkillLearningChanged: () => learning.refreshCatalog() };
    },
  };
}
