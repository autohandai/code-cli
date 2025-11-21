/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import readline from 'node:readline';
import { TerminalResizeWatcher } from './terminalResize.js';
import type { SlashCommand } from '../core/slashCommands.js';
import { MentionPreview } from './mentionPreview.js';

export type SlashCommandHint = SlashCommand;

export interface PromptIO {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
}

type PromptResult =
  | { kind: 'submit'; value: string }
  | { kind: 'abort' };

export async function readInstruction(
  files: string[],
  slashCommands: SlashCommandHint[],
  statusLine?: string,
  io: PromptIO = {}
): Promise<string | null> {
  const stdInput = (io.input ?? process.stdin) as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  const stdOutput = (io.output ?? process.stdout) as NodeJS.WriteStream;

  // Keep the process alive during UI handoffs (readline <-> Ink)
  const keepAlive = setInterval(() => {}, 10_000);

  try {
    while (true) {
      const result = await promptOnce({
        files,
        slashCommands,
        statusLine,
        stdInput,
        stdOutput
      });

      if (result.kind === 'abort') {
        return 'ABORT';
      }

      return result.value;
    }
  } finally {
    clearInterval(keepAlive);
  }
}

interface PromptOnceOptions {
  files: string[];
  slashCommands: SlashCommandHint[];
  statusLine?: string;
  stdInput: NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  stdOutput: NodeJS.WriteStream;
}

function createReadline(
  stdInput: NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void },
  stdOutput: NodeJS.WriteStream
): { rl: readline.Interface; input: NodeJS.ReadStream; supportsRawMode: boolean } {
  if (stdInput.isPaused && stdInput.isPaused()) {
    stdInput.resume();
  }

  const rl = readline.createInterface({
    input: stdInput,
    output: stdOutput,
    prompt: `${chalk.gray('›')} `,
    terminal: true,
    crlfDelay: Infinity,
    historySize: 100,
    tabSize: 2
  });

  disableReadlineTabBehavior(rl);

  const input = (rl as readline.Interface & { input: NodeJS.ReadStream }).input;
  const supportsRawMode = typeof input.setRawMode === 'function';

  if (supportsRawMode && input.isTTY) {
    input.setRawMode(true);
  }
  input.resume();
  input.setEncoding('utf8');

  return { rl, input, supportsRawMode };
}

async function promptOnce(options: PromptOnceOptions): Promise<PromptResult> {
  const { files, slashCommands, statusLine, stdInput, stdOutput } = options;
  const { rl, input, supportsRawMode } = createReadline(stdInput, stdOutput);

  const mentionPreview = new MentionPreview(rl, files, slashCommands, stdOutput, statusLine);
  const resizeWatcher = new TerminalResizeWatcher(stdOutput, () => {
    mentionPreview.handleResize();
    renderPromptLine(rl, statusLine, stdOutput);
  });

  return new Promise<PromptResult>((resolve) => {
    let ctrlCCount = 0;
    let closed = false;

    const cleanup = () => {
      if (closed) {
        return;
      }
      closed = true;
      mentionPreview.dispose();
      resizeWatcher.dispose();
      input.off('keypress', handleKeypress);
      if (supportsRawMode && input.isTTY) {
        input.setRawMode(false);
      }
      input.pause();
      rl.close();
    };

    const handleKeypress = (_str: string, key: readline.Key) => {
      if (key?.name === 'c' && key.ctrl) {
        if (ctrlCCount === 0) {
          ctrlCCount = 1;
          mentionPreview.reset();
          stdOutput.write(`\n${chalk.gray('Press Ctrl+C again to exit.')}\n`);
          renderPromptLine(rl, statusLine, stdOutput);
          return;
        }
        cleanup();
        resolve({ kind: 'abort' });
        return;
      }

    };

    input.on('keypress', handleKeypress);

    rl.setPrompt(`${chalk.gray('›')} `);
    rl.prompt(true);

    rl.on('line', (value) => {
      stdOutput.write('\n');
      cleanup();
      resolve({ kind: 'submit', value: value.trim() });
    });

    rl.on('SIGINT', () => {
      if (ctrlCCount === 0) {
        ctrlCCount = 1;
        mentionPreview.reset();
        stdOutput.write(`\n${chalk.gray('Press Ctrl+C again to exit.')}\n`);
        renderPromptLine(rl, statusLine, stdOutput);
        return;
      }
      cleanup();
      resolve({ kind: 'abort' });
    });
  });
}


/**
 * Disable readline's built-in tab completion so our custom @ mention handler
 * can own Tab behavior without the default inserter interfering.
 */
function disableReadlineTabBehavior(rl: readline.Interface): void {
  const anyRl = rl as readline.Interface & { completer?: (line: string) => [string[], string]; _tabComplete?: () => void };
  anyRl.completer = (line: string) => [[], line];
  if (typeof anyRl._tabComplete === 'function') {
    anyRl._tabComplete = () => { };
  }
}

import { drawInputBox } from './box.js';

function renderPromptLine(rl: readline.Interface, statusLine: string | undefined, output: NodeJS.WriteStream): void {
  const width = Math.max(20, output.columns || 80);
  const status = (statusLine ?? ' ').padEnd(width).slice(0, width);

  const box = drawInputBox(status, width);

  readline.cursorTo(output, 0);
  output.write(`${box}\n`);

  rl.setPrompt(`${chalk.gray('›')} `);
  rl.prompt(true);
}
