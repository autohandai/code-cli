import type { Command } from 'commander';
import type { CLIOptions } from '../types.js';

export interface CloudOptions {
  cloud?: boolean;
  resume?: string | boolean;
  cloudAccount?: string;
  cloudRepository?: string;
  cloudConnector?: string;
  cloudBranch?: string;
  cloudProvider?: string;
}
export function registerCloudOptions(program: Command): Command {
  return program.option('--cloud', 'Run with a durable hosted Autohand agent (Pro, Pro+, Max)', false)
    .option('--cloud-account <id>', 'Select the Autohand account for the cloud session')
    .option('--cloud-repository <owner/repo>', 'Attach an authorized repository to a new cloud session')
    .option('--cloud-connector <id>', 'Repository connector or GitHub App connection to use')
    .option('--cloud-branch <branch>', 'Remote branch for the cloud workspace')
    .option('--cloud-provider <provider>', 'Managed sandbox provider: cloudflare, daytona, or box');
}
export function validateCloudOptions(options: CLIOptions & CloudOptions & { mode?: string }): void {
  if (!options.cloud) {
    if (options.cloudAccount || options.cloudRepository || options.cloudConnector || options.cloudBranch || options.cloudProvider) throw new Error('Cloud workspace options require --cloud.');
    return;
  }
  if (options.mode && options.mode !== 'interactive') throw new Error('--cloud requires terminal mode. Hosted agent execution stays in Autohand Cloud.');
  const localOnly = ['offline', 'ephemeral', 'unrestricted', 'restricted', 'yes', 'dryRun', 'autoMode', 'autoCommit', 'worktree', 'tmux', 'zit', 'json', 'outputFormat', 'outputSchema', 'patch', 'yolo', 'allowedTools', 'disallowedTools', 'mcpConfig', 'sysPrompt', 'appendSysPrompt', 'addDir', 'answerOnly', 'setupOnly', 'maxRequests', 'maxTokens', 'maxDuration'] as const;
  for (const name of localOnly) if (Reflect.get(options, name) !== undefined && Reflect.get(options, name) !== false) throw new Error(`--cloud cannot apply the local ${name} option. Cloud uses the account's hosted security policies and approval flow.`);
  if (options.cloudProvider && !['cloudflare', 'daytona', 'box'].includes(options.cloudProvider)) throw new Error('Choose cloudflare, daytona, or box for --cloud-provider.');
  if (options.resume !== undefined && (options.cloudRepository || options.cloudConnector || options.cloudBranch || options.cloudProvider)) throw new Error('Resume the existing cloud workspace without new repository options.');
}
