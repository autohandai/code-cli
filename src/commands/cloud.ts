import open from 'open';
import { cloudSessionUrl } from '../cloud/CloudClient.js';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { SlashCommandContext, SlashCommand } from '../core/slashCommandTypes.js';
import { launchCloud, type CloudLaunchResult } from '../cloud/launchCloud.js';
import { conversationSnapshot } from './handoff-web.js';
import { captureTransferRepository } from '../session/transfer/transfer-workspace.js';
import type { SessionManager } from '../session/SessionManager.js';

export const metadata: SlashCommand = { command: '/cloud', description: 'start or resume a durable hosted agent (Pro, Pro+, Max)', implemented: true };
export const handoffMetadata: SlashCommand = { command: '/handoff cloud', description: 'continue this conversation and repository in a cloud agent', implemented: true };
export const openMetadata: SlashCommand = { command: '/open', description: 'open the current cloud session in Web or Desktop', implemented: true };
type CloudCommandContext = Pick<SlashCommandContext, 'config' | 'workspaceRoot' | 'sessionManager' | 'currentSession' | 'onBeforeModal' | 'onAfterModal' | 'isNonInteractive'> & Partial<Pick<SlashCommandContext, 'model' | 'provider' | 'permissionManager' | 'getInteractionMode'>>;
const attached = new WeakMap<SessionManager, { id: string; accountId: string }>();
interface CloudCommandDependencies { launch?: typeof launchCloud; continueLocally?(result: Extract<CloudLaunchResult, { kind: 'local' }>): Promise<void> }

export async function cloudCommand(ctx: CloudCommandContext, args: string[] = [], dependencies: CloudCommandDependencies = {}, handoff = false): Promise<string> {
  if (ctx.isNonInteractive) return '/cloud requires an interactive terminal. Run autohand --cloud from your terminal.';
  if (!ctx.config?.auth?.token) return 'Sign in first with /login, then run /cloud.';
  if (ctx.sessionManager.isEphemeral()) return 'Cloud sessions are saved remotely. Start a regular local session before handing off to Cloud.';
  let resume: string | boolean | undefined;
  if (args[0] === '--resume') { if (args.length > 2) return 'Usage: /cloud [task] or /cloud --resume [ID|Web URL]'; resume = args[1] ?? true; }
  else if (args[0]?.startsWith('--')) return 'Usage: /cloud [task] or /cloud --resume [ID|Web URL]';
  const current = ctx.currentSession ?? ctx.sessionManager.getCurrentSession();
  if (handoff && !current) return 'Start a local conversation before using /handoff.';
  try {
    if (ctx.permissionManager?.getRunToolScope()) throw new Error('Cloud cannot enforce the local tool scope. Keep this task local.');
    if (ctx.permissionManager && ['restricted', 'external'].includes(ctx.permissionManager.getMode())) throw new Error('Cloud cannot enforce this local security policy. Keep this task local.');
    await ctx.onBeforeModal?.();
    const snapshot = handoff && current ? conversationSnapshot(current, { ...ctx, model: ctx.model ?? 'auto', config: ctx.config }) : undefined;
    if (snapshot) snapshot.repository = await captureTransferRepository(ctx.workspaceRoot);
    const result = await (dependencies.launch ?? launchCloud)({ config: ctx.config, workspaceRoot: ctx.workspaceRoot, ...(snapshot ? { snapshot } : {}) }, { cloud: true, plan: ctx.getInteractionMode?.() === 'plan', ...(resume !== undefined ? { resume } : args.length ? { prompt: args.join(' ') } : {} ) });
    if (result.kind === 'cancelled') return 'Cloud launch cancelled.';
    if (result.kind === 'local') {
      if (dependencies.continueLocally) await dependencies.continueLocally(result);
      else await continueCloudLocally(ctx, result);
      return 'Returned from the imported cloud session. The original local session is active.';
    }
    if (result.conversationId && result.accountId) {
      attached.set(ctx.sessionManager, { id: result.conversationId, accountId: result.accountId });
      return `Cloud work continues. Reconnect: autohand --cloud --resume ${result.conversationId} --cloud-account ${result.accountId}`;
    }
    return 'Detached from Cloud. The hosted run continues.';
  } catch (error) { return `Could not open Cloud. ${error instanceof Error ? error.message : 'Try again.'}`; }
  finally { await ctx.onAfterModal?.(); }
}

async function continueCloudLocally(ctx: CloudCommandContext, result: Extract<CloudLaunchResult, { kind: 'local' }>): Promise<void> {
  const runtime = /^(node|bun)(\.exe)?$/.test(path.basename(process.execPath));
  const args = [...(runtime ? [process.argv[1]] : []), 'transfer', result.transferId, '--account', result.accountId, '--path', ctx.workspaceRoot, ...(result.plan ? ['--plan'] : []), ...(ctx.config?.configPath ? ['--config', ctx.config.configPath] : [])];
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  const cleanup = () => { child.kill(); };
  process.once('exit', cleanup);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => { if (code === 0 || signal === 'SIGINT') resolve(); else reject(new Error(`Local transfer exited with ${code ?? signal}. Resume it with autohand transfer ${result.transferId} --account ${result.accountId}.`)); });
    });
  } finally { process.removeListener('exit', cleanup); child.removeAllListeners(); }
}

export async function openCloudSession(ctx: Pick<CloudCommandContext, 'sessionManager' | 'config'>, args: string[], openUrl: (url: string) => Promise<unknown> = open): Promise<string> {
  if (args.length > 1 || args[0] && !['web', 'desktop'].includes(args[0])) return 'Usage: /open [web|desktop]';
  const current = attached.get(ctx.sessionManager);
  if (!current) return 'Start or resume a cloud session with /cloud, then use /open web.';
  if (ctx.config?.api?.accountId && current.accountId !== ctx.config.api.accountId) return 'Resume the cloud session in the selected account before opening it.';
  const url = cloudSessionUrl(current.id, current.accountId, args[0] === 'desktop' ? 'desktop' : 'web');
  try { await openUrl(url); } catch { return `Open this cloud session: ${url}`; }
  return url;
}
