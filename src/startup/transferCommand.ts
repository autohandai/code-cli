import type { Command } from 'commander';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { AUTOHAND_PATHS } from '../constants.js';
import { loadConfig } from '../config.js';
import { ensureAuthenticated } from '../auth/ensureAuth.js';
import { showModal } from '../ui/ink/components/Modal.js';
import { SessionTransferClient, type ReceivedTransfer } from '../session/transfer/transfer-client.js';
import { importTransferSession } from '../session/transfer/transfer-session-store.js';
import { createTransferCheckout, applyTransferPatch, transferRepositoryUrl } from '../session/transfer/transfer-workspace.js';
import { isRecord } from '../session/transfer/record.js';
import type { SessionTransfer } from '../session/transfer/session-transfer.js';

interface TransferOptions { account: string; path?: string; config?: string; offline: boolean; accept?: boolean; importOnly?: boolean }
export interface TransferRunOptions { path: string; resumeSessionId: string; model: string; provider: 'autohandai'; offline: boolean; config?: string }
interface TransferDependencies {
  run(options: TransferRunOptions): Promise<void>;
  receive?(id: string, options: TransferOptions): Promise<ReceivedTransfer>;
  prepare?(received: ReceivedTransfer, directory: string): Promise<{ sessionId: string; workspace: string }>;
  confirm?(snapshot: SessionTransfer): Promise<boolean>;
  report?(message: string): void;
}

async function receive(id: string, options: TransferOptions): Promise<ReceivedTransfer> {
  const config = await ensureAuthenticated(await loadConfig(options.config));
  if (!config.auth?.token) throw new Error('Run autohand login before importing this transfer.');
  return new SessionTransferClient().download(id, { token: config.auth.token, userId: config.auth.user?.id ?? 'authenticated', accountId: options.account });
}

export async function prepareCliTransfer({ snapshot, transfer }: ReceivedTransfer, directory: string): Promise<{ sessionId: string; workspace: string }> {
  let workspace = path.resolve(directory);
  const sessionId = `web-${transfer.id}`;
  try {
    const saved: unknown = JSON.parse(await fs.readFile(path.join(AUTOHAND_PATHS.sessions, sessionId, 'metadata.json'), 'utf8'));
    if (!isRecord(saved) || !isRecord(saved.importedFrom) || saved.importedFrom.originalId !== transfer.id || saved.importedFrom.accountId !== transfer.accountId || typeof saved.projectPath !== 'string') throw new Error('This local session belongs to a different transfer.');
    if (!(await fs.stat(saved.projectPath)).isDirectory()) throw new Error('The previously imported workspace is unavailable.');
    return { sessionId, workspace: saved.projectPath };
  } catch (error) { if (!isRecord(error) || error.code !== 'ENOENT') throw error; }
  if (snapshot.repository) {
    const existing = await transferRepositoryUrl(workspace) === snapshot.repository.url ? workspace : undefined;
    const name = `${snapshot.repository.url.split('/').at(-1)}-${transfer.id.slice(0, 8)}`;
    workspace = await createTransferCheckout(snapshot.repository, path.join(workspace, name), existing);
    await applyTransferPatch(snapshot.repository, workspace);
  }
  await importTransferSession(snapshot, transfer, workspace, AUTOHAND_PATHS.sessions);
  return { sessionId, workspace };
}

async function confirm(snapshot: SessionTransfer): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Use --accept to import noninteractively after reviewing this transfer on the Web.');
  const clean = (value: string) => [...value].filter(character => character === '\n' || character === '\t' || character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join('');
  while (true) {
    const choice = await showModal({ title: `Continue ${clean(snapshot.title)} · ${snapshot.messages.length} saved messages`, options: [
      { label: 'Continue in this terminal', value: 'continue' },
      ...(snapshot.repository?.patch ? [{ label: 'Review repository changes', value: 'review' }] : []),
      { label: 'Cancel', value: 'cancel' },
    ] });
    if (choice?.value !== 'review') return choice?.value === 'continue';
    process.stdout.write(clean(snapshot.repository!.patch) + '\n');
  }
}

export function registerTransferCommand(program: Command, dependencies: TransferDependencies): Command {
  return program.command('transfer <id>')
    .description('Import a private Autohand Code Web conversation and continue locally')
    .requiredOption('--account <id>', 'The Autohand account shown in the Web transfer')
    .option('--path <directory>', 'Parent for a new repository checkout, or the workspace for a chat without a repository')
    .option('--config <path>', 'Path to the Autohand config file')
    .option('--offline', 'Skip model catalogue refresh when resuming', false)
    .option('--accept', 'Accept the reviewed transfer without an interactive confirmation')
    .option('--import-only', 'Save the local session without starting the interactive CLI')
    .action(async (id: string, _options: TransferOptions, command: Command) => {
      try {
        const options = command.optsWithGlobals<TransferOptions>();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid transfer ID.');
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(options.account)) throw new Error('Invalid transfer account.');
        const received = await (dependencies.receive ?? receive)(id, options);
        if (received.snapshot.provider !== 'autohandai') throw new Error('Open this transfer in Autohand Code Web and select its model before continuing in the CLI.');
        if (!options.accept && !await (dependencies.confirm ?? confirm)(received.snapshot)) return;
        const imported = await (dependencies.prepare ?? prepareCliTransfer)(received, path.resolve(options.path ?? process.cwd()));
        if (options.importOnly) { (dependencies.report ?? (message => process.stdout.write(message + '\n')))(`Imported session ${imported.sessionId} in ${imported.workspace}`); return; }
        await dependencies.run({ path: imported.workspace, resumeSessionId: imported.sessionId, model: received.snapshot.model, provider: 'autohandai', offline: options.offline, config: options.config });
      } catch (error) { command.error(error instanceof Error ? error.message : 'This transfer could not be imported.'); }
    });
}
