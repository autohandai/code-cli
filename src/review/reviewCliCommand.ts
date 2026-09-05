/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Command, InvalidArgumentError } from 'commander';
import {
  formatReviewHelp,
  parseReviewArguments,
  type ReviewRequest,
} from './reviewRequest.js';

export interface ReviewCliRuntimeOptions {
  path?: string;
  config?: string;
  model?: string;
  offline?: boolean;
  bare?: boolean;
  json?: string | boolean;
  outputFormat?: string;
}

export interface ReviewCliInvocation {
  interactive: false;
  request: ReviewRequest;
  runtimeOptions: ReviewCliRuntimeOptions;
}

export interface ReviewServerInvocation {
  reportPath?: string;
  port: number;
  open: boolean;
}

export interface ReviewCliCommandDependencies {
  run(invocation: ReviewCliInvocation): Promise<void>;
  serve(invocation: ReviewServerInvocation): Promise<void>;
}

interface ReviewCommandOptions extends ReviewCliRuntimeOptions {
  audience?: string;
  format?: string;
  base?: string;
  head?: string;
  focus?: string;
  port?: number;
  open?: boolean;
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('Review server port must be an integer from 0 to 65535.');
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new InvalidArgumentError('Review server port must be an integer from 0 to 65535.');
  }
  return port;
}

function appendOption(args: string[], name: string, value: string | undefined): void {
  if (value !== undefined) args.push(name, value);
}

function reviewArguments(
  kind: string | undefined,
  target: string | undefined,
  options: ReviewCommandOptions,
): string[] {
  const args = [kind, target].filter((value): value is string => Boolean(value));
  appendOption(args, '--audience', options.audience);
  appendOption(args, '--format', options.format);
  appendOption(args, '--base', options.base);
  appendOption(args, '--head', options.head);
  appendOption(args, '--focus', options.focus);
  return args;
}

function runtimeOptions(options: ReviewCommandOptions): ReviewCliRuntimeOptions {
  return {
    ...(options.path ? { path: options.path } : {}),
    ...(options.config ? { config: options.config } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.offline !== undefined ? { offline: options.offline } : {}),
    ...(options.bare !== undefined ? { bare: options.bare } : {}),
    ...(options.json !== undefined ? { json: options.json } : {}),
    ...(options.outputFormat ? { outputFormat: options.outputFormat } : {}),
  };
}

export function registerReviewCommand(
  program: Command,
  dependencies: ReviewCliCommandDependencies,
): Command {
  const command = program
    .command('review [kind] [target]')
    .description('Run Autohand Review non-interactively (public beta). Kinds: changes, code, architecture, security, performance, forensics, or serve. Use /review interactively.')
    .option('--audience <audience>', 'Report audience: mixed, executive, technical, or forensic')
    .option('--format <format>', 'Review report format: markdown or json')
    .option('--base <git-ref>', 'Comparison base for change or forensic review')
    .option('--head <git-ref>', 'Comparison head; defaults to the working tree')
    .option('--focus <text>', 'Additional review focus')
    .option('--port <port>', 'Loopback report viewer port; 0 selects a free port', parsePort, 0)
    .option('--no-open', 'Do not open the report viewer in a browser')
    .option('--path <path>', 'Workspace path to review')
    .option('--config <path>', 'Path to the Autohand config file')
    .option('--model <model>', 'Override the configured review model')
    .option('--offline', 'Disable startup network operations', false)
    .option('--bare', 'Use minimal startup for the review', false)
    .option('--json [mode]', 'Stream command lifecycle events as JSON')
    .option('--output-format <format>', 'Command transport format: stream-json')
    .addHelpText('after', `\n${formatReviewHelp()}`)
    .action(async (
      kind: string | undefined,
      target: string | undefined,
      _localOptions: ReviewCommandOptions,
      actionCommand: Command,
    ) => {
      const options = actionCommand.optsWithGlobals<ReviewCommandOptions>();
      if (kind === 'serve') {
        await dependencies.serve({
          ...(target ? { reportPath: target } : {}),
          port: options.port ?? 0,
          open: options.open !== false,
        });
        return;
      }

      const parsed = parseReviewArguments(reviewArguments(kind, target, options));
      if (!parsed.ok) throw new InvalidArgumentError(parsed.error);
      if ('help' in parsed) {
        actionCommand.outputHelp();
        return;
      }

      await dependencies.run({
        interactive: false,
        request: parsed.request,
        runtimeOptions: runtimeOptions(options),
      });
    });

  return command;
}
