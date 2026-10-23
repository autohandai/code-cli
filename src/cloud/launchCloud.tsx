import React, { useSyncExternalStore } from 'react';
import { randomUUID } from 'node:crypto';
import { render, type Instance } from 'ink';
import open from 'open';
import { z } from 'zod';
import { CloudClient, cloudWorkspaceSchema, parseCloudReference, type CloudConversation, type CloudInteraction } from './CloudClient.js';
import { CloudSession } from './CloudSession.js';
import { CloudScreen, CloudReviewScreen, cloudDisplayText, cloudInteractionText, cloudReviewOptions, cloudReviewTitle } from './CloudScreen.js';
import { ThemeProvider } from '../ui/theme/ThemeContext.js';
import { I18nProvider } from '../ui/i18n/index.js';
import { showInput, showModal, prepareModalRender, cleanupModalRender, resumeModalInput, type ModalOption } from '../ui/ink/components/Modal.js';
import { inkRenderOptions } from '../ui/inkRenderOptions.js';
import { SessionTransferClient, type TransferIdentity } from '../session/transfer/transfer-client.js';
import type { SessionTransfer } from '../session/transfer/session-transfer.js';
import type { CLIOptions, LoadedConfig } from '../types.js';
import { validateCloudOptions } from '../startup/cloudOptions.js';
import { validateCloudPolicy } from './CloudPolicy.js';

interface CloudLaunchContext { config: LoadedConfig; workspaceRoot: string; snapshot?: SessionTransfer }
export type CloudLaunchResult = { kind: 'cancelled' } | { kind: 'detached'; conversationId?: string; accountId?: string } | { kind: 'local'; transferId: string; accountId: string; plan: boolean };
interface CloudLaunchDependencies {
  createClient?(identity: TransferIdentity): CloudClient;
  choose?(title: string, options: ModalOption[]): Promise<string | null>;
  input?(title: string): Promise<string | null>;
  view?(session: CloudSession): Promise<CloudLaunchResult>;
  transferClient?: SessionTransferClient;
}

const workspaceList = z.object({ workspaces: z.array(cloudWorkspaceSchema).max(100) });
const modelsSchema = z.object({ models: z.array(z.object({ id: z.string(), name: z.string().optional(), available: z.boolean() })).max(100) });
const providersSchema = z.object({ providers: z.array(z.object({ id: z.string(), name: z.string(), available: z.boolean() })).max(20) });

async function reviewCloudOperation(interaction: CloudInteraction): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  prepareModalRender(process.stdout, { skipAltScreen: true });
  resumeModalInput();
  await new Promise<void>(resolve => setImmediate(resolve));
  let instance: Instance | undefined;
  try {
    return await new Promise<boolean>((resolve, reject) => {
      let completed = false;
      const decide = (approved: boolean): void => {
        if (completed || !instance) return;
        completed = true;
        instance.unmount();
        void instance.waitUntilExit().then(() => resolve(approved), reject);
      };
      instance = render(<I18nProvider><ThemeProvider><CloudReviewScreen interaction={interaction} onDecision={decide} /></ThemeProvider></I18nProvider>, inkRenderOptions({ exitOnCtrlC: false }));
    });
  } finally {
    instance?.unmount();
    cleanupModalRender(process.stdout, { skipAltScreen: true });
  }
}

async function chooseRepository(client: CloudClient, options: CLIOptions, choose: NonNullable<CloudLaunchDependencies['choose']>, input: NonNullable<CloudLaunchDependencies['input']>, repository?: string) {
  let connectorId = options.cloudConnector;
  if (!connectorId) {
    const [github, connectors] = await Promise.all([
      client.call('github', z.object({ connections: z.array(z.object({ id: z.string(), owner: z.string(), status: z.string() })).max(200) })).catch(() => ({ connections: [] })),
      client.call('connectors', z.object({ connectors: z.array(z.object({ id: z.string(), name: z.string(), enabled: z.boolean(), hostedCompatible: z.boolean() })).max(2000) })),
    ]);
    const choices = [
      ...github.connections.filter(connection => connection.status === 'connected').map(connection => ({ value: `github-app:${connection.id}`, label: `GitHub App · ${connection.owner}` })),
      ...connectors.connectors.filter(connector => connector.enabled && connector.hostedCompatible).map(connector => ({ value: connector.id, label: connector.name })),
    ];
    if (!choices.length) throw new Error('Connect repository access in https://dev.autohand.ai before starting a cloud workspace.');
    connectorId = choices.length === 1 ? choices[0].value : await choose('Choose repository access', choices) ?? undefined;
    if (!connectorId) return null;
  }
  let selected = repository;
  if (!selected) {
    const listed = await client.call(`repositories?connector=${encodeURIComponent(connectorId)}`, z.object({ repositories: z.array(z.object({ fullName: z.string(), defaultBranch: z.string() })).max(1000), hasMore: z.boolean().optional() }));
    selected = await choose('Choose a cloud repository', [
      ...listed.repositories.map(item => ({ value: item.fullName, label: item.fullName })),
      ...(listed.hasMore ? [{ value: '__name__', label: 'Enter a repository name' }] : []),
    ]) ?? undefined;
    if (selected === '__name__') selected = await input('Repository owner/name') ?? undefined;
    if (!selected) return null;
  }
  let branch = options.cloudBranch;
  if (!branch) {
    const listed = await client.call(`branches?connector=${encodeURIComponent(connectorId)}&repository=${encodeURIComponent(selected)}`, z.object({ branches: z.array(z.object({ name: z.string() })).max(1000), hasMore: z.boolean().optional() }));
    branch = await choose(`Choose a branch for ${cloudDisplayText(selected)}`, listed.branches.map(item => ({ value: item.name, label: item.name }))) ?? undefined;
    if (!branch) return null;
  }
  const providers = (await client.call('sandbox-providers', providersSchema)).providers.filter(provider => provider.available);
  if (!providers.length) throw new Error('No managed sandbox provider is currently available. Try again shortly.');
  const provider = options.cloudProvider ?? (providers.length === 1 ? providers[0].id : await choose('Choose a managed sandbox', providers.map(item => ({ value: item.id, label: item.name }))));
  if (!provider) return null;
  if (!providers.some(item => item.id === provider)) throw new Error('The selected sandbox provider is unavailable.');
  return { connectorId, repository: selected, branch, provider };
}

function CloudSessionView({ session, detach }: { session: CloudSession; detach(): void }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return <CloudScreen state={state} onSubmit={text => session.submit(text)} onSelect={direction => session.select(direction)} onDetach={detach} />;
}

export async function launchCloud(context: CloudLaunchContext, options: CLIOptions, dependencies: CloudLaunchDependencies = {}): Promise<CloudLaunchResult> {
  validateCloudOptions({ ...options, cloud: true });
  await validateCloudPolicy(context.config, context.workspaceRoot, options.plan === true);
  const token = context.config.auth?.token;
  if (!token) throw new Error('Sign in with autohand login before using cloud sessions.');
  const reference = typeof options.resume === 'string' ? parseCloudReference(options.resume) : undefined;
  const accountId = options.cloudAccount ?? context.config.api?.accountId;
  if (accountId && reference?.accountId && accountId !== reference.accountId) throw new Error('The resume link belongs to another account. Select it explicitly with --cloud-account.');
  const makeClient = dependencies.createClient ?? (identity => new CloudClient(identity));
  const initial = makeClient({ token, userId: context.config.auth?.user?.id ?? 'authenticated', accountId: reference?.accountId ?? accountId });
  const identity = await initial.session();
  const client = makeClient({ token, userId: identity.user.id, accountId: identity.account.account.id });
  const choose = dependencies.choose ?? (async (title, choices) => (await showModal({ title: cloudDisplayText(title), options: choices.map(option => ({ ...option, label: cloudDisplayText(option.label) })) }))?.value ?? null);
  const input = dependencies.input ?? (title => showInput({ title, validate: value => value.trim().length > 0 && value.length <= 32_000 || 'Enter a task of up to 32,000 characters.' }));
  let conversation: CloudConversation, prompt = options.prompt;
  if (options.resume !== undefined) {
    let selected = reference?.id;
    if (!selected) selected = await choose('Resume a cloud session', (await client.list()).conversations.map(item => ({ value: item.id, label: item.title, description: item.updated_at }))) ?? undefined;
    if (!selected) return { kind: 'cancelled' };
    conversation = (await client.detail(selected)).conversation;
  } else {
    const plan = await client.call('account', z.object({ tier: z.string().nullable(), paymentAccess: z.unknown().nullish() }));
    if (plan.paymentAccess || !['pro', 'pro_plus', 'max'].includes(plan.tier ?? '')) throw new Error('Cloud CLI sessions are available on Pro, Pro+, and Max. Upgrade in Console.');
    prompt = prompt ?? await input(context.snapshot ? 'Task for the cloud agent after handoff' : 'Task for your cloud agent') ?? undefined;
    if (!prompt?.trim()) return { kind: 'cancelled' };
    const models = (await client.call('models', modelsSchema)).models;
    const model = options.model ?? 'auto';
    if (!models.some(item => item.id === model && item.available)) throw new Error(`Model ${model} is unavailable in this cloud account. Choose an available hosted model.`);
    let workspace: Awaited<ReturnType<typeof chooseRepository>> = null;
    if (options.cloudRepository || context.snapshot?.repository) {
      const repository = options.cloudRepository ?? context.snapshot!.repository!.url.slice('https://github.com/'.length);
      workspace = await chooseRepository(client, options, choose, input, repository);
      if (!workspace) return { kind: 'cancelled' };
    } else if (!dependencies.view && process.stdin.isTTY && process.stdout.isTTY) {
      const attach = await choose('Cloud environment', [{ value: 'repository', label: 'Attach a repository and run in an isolated workspace' }, { value: 'conversation', label: 'Start a hosted conversation without a repository' }, { value: 'cancel', label: 'Cancel' }]);
      if (attach === 'cancel' || !attach) return { kind: 'cancelled' };
      if (attach === 'repository') { workspace = await chooseRepository(client, options, choose, input); if (!workspace) return { kind: 'cancelled' }; }
    }
    if (context.snapshot) {
      const snapshot = context.snapshot;
      const summary = `Transfer ${snapshot.messages.length} saved messages to Cloud${snapshot.repository ? `\nRepository: ${snapshot.repository.url}\nCommit: ${snapshot.repository.revision}\nLocal patch: ${Buffer.byteLength(snapshot.repository.patch)} bytes` : ''}`;
      while (true) {
        const decision = await choose(summary, [{ value: 'cancel', label: 'Cancel' }, { value: 'transfer', label: 'Transfer the reviewed context' }, ...(snapshot.repository?.patch ? [{ value: 'review', label: 'Print the repository patch for review' }] : [])]);
        if (decision === 'review') { process.stdout.write(cloudDisplayText(snapshot.repository!.patch!) + '\n'); continue; }
        if (decision !== 'transfer') return { kind: 'cancelled' };
        break;
      }
      const transfer = await (dependencies.transferClient ?? new SessionTransferClient()).upload(context.snapshot, client.identity);
      conversation = (await client.import(transfer.id, model)).conversation;
      if (workspace && context.snapshot.repository) {
        const restored = await client.restore(transfer.id, conversation.id, workspace.connectorId, workspace.provider);
        if (restored.workspace.status !== 'ready') throw new Error(`Restored workspace is ${restored.workspace.status}. Resume ${conversation.id} to inspect it before sending the task.`);
      } else if (workspace) {
        const result = await client.call('workspaces', z.object({ workspace: cloudWorkspaceSchema }), 'POST', { ...workspace, conversationId: conversation.id, requestId: randomUUID() });
        if (result.workspace.status !== 'ready') throw new Error(`Cloud workspace is ${result.workspace.status}. Resume ${conversation.id} to inspect it before sending the task.`);
      }
    } else {
      conversation = await client.create(prompt.trim().replace(/\s+/g, ' ').slice(0, 120), model);
      if (workspace) {
        const result = await client.call('workspaces', z.object({ workspace: cloudWorkspaceSchema }), 'POST', { ...workspace, conversationId: conversation.id, requestId: randomUUID() });
        if (result.workspace.status !== 'ready') throw new Error(`Cloud workspace is ${result.workspace.status}. Resume ${conversation.id} to inspect it before sending the task.`);
      }
    }
  }
  let renderer: Instance | undefined, finish: ((result: CloudLaunchResult) => void) | undefined;
  let active = true;
  const draw = () => { renderer = render(<I18nProvider><ThemeProvider><CloudSessionView session={session} detach={() => finish?.({ kind: 'detached' })} /></ThemeProvider></I18nProvider>, inkRenderOptions({ exitOnCtrlC: false })); };
  const dialog = async <T,>(run: () => Promise<T>): Promise<T> => {
    renderer?.unmount(); renderer = undefined;
    try { return await run(); } finally { if (active && !dependencies.view) draw(); }
  };
  const session = new CloudSession(client, conversation, {
    open,
    detach: () => finish?.({ kind: 'detached' }),
    confirmApproval: interaction => dialog(async () => {
      if (!dependencies.choose) return reviewCloudOperation(interaction);
      process.stdout.write(`\n${cloudDisplayText(cloudInteractionText(interaction))}\n\n`);
      return await choose(cloudReviewTitle, cloudReviewOptions) === 'approve';
    }),
    answerQuestions: interaction => dialog(async () => {
      if (interaction.payload.kind !== 'question') return null;
      const answers: Array<{ id: string; value: string }> = [];
      for (const question of interaction.payload.questions) {
        const value = question.options.length ? await choose(question.title, question.options.map(value => ({ value, label: value }))) : await input(question.title);
        if (!value) return null;
        answers.push({ id: question.id, value });
      }
      return answers;
    }),
    handoff: () => dialog(async () => {
      const jobs = (await client.queue(conversation.id)).jobs;
      if (jobs.length) throw new Error('Finish or stop cloud work before importing its repository locally.');
      if (await choose('Bring this cloud session into a separate local checkout?', [{ value: 'cancel', label: 'Stay in Cloud' }, { value: 'local', label: 'Review and continue locally' }]) !== 'local') return;
      const transfer = await client.export(conversation.id);
      finish?.({ kind: 'local', transferId: transfer.id, accountId: transfer.accountId, plan: options.plan === true });
    }),
  }, options.plan ? 'plan' : 'auto');
  try {
    await session.start();
    if (prompt && !(await session.submit(prompt))) throw new Error(`${session.getSnapshot().notice}\nResume ${conversation.id} to check admission before retrying.`);
    if (dependencies.view) {
      const result = await dependencies.view(session);
      return result.kind === 'detached' ? { ...result, conversationId: conversation.id, accountId: client.identity.accountId } : result.kind === 'local' ? { ...result, plan: options.plan === true } : result;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) { process.stdout.write(`Cloud session ${conversation.id}\nhttps://dev.autohand.ai/c/${conversation.id}?account=${encodeURIComponent(client.identity.accountId ?? '')}\nThe hosted run continues. Reconnect with autohand --cloud --resume ${conversation.id}.\n`); return { kind: 'detached' }; }
    const result = await new Promise<CloudLaunchResult>(resolve => { finish = resolve; draw(); });
    return result.kind === 'detached' ? { ...result, conversationId: conversation.id, accountId: client.identity.accountId } : result;
  } finally { active = false; session.dispose(); renderer?.unmount(); await session.settled(); }
}
