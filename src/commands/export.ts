/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import path from 'node:path';
import enquirer from 'enquirer';
import {
  exportToMarkdown,
  exportToJson,
  exportToHtml,
  saveExport,
  getSuggestedFilename,
  type ExportOptions,
} from '../session/exportSession.js';
import { SessionManager, Session } from '../session/SessionManager.js';
import type { SlashCommand } from '../core/slashCommands.js';

export const metadata: SlashCommand = {
  command: '/export',
  description: 'Export current session to markdown',
  implemented: true,
};

interface ExportContext {
  sessionManager: SessionManager;
  currentSession?: Session;
  workspaceRoot: string;
}

export async function execute(args?: string, context?: ExportContext): Promise<void> {
  if (!context?.sessionManager) {
    console.log(chalk.red('Session manager not available.'));
    return;
  }

  const { sessionManager, currentSession, workspaceRoot } = context;

  // Get session to export
  let session = currentSession;

  if (!session) {
    // Ask user to select a session
    const sessions = await sessionManager.listSessions();

    if (sessions.length === 0) {
      console.log(chalk.yellow('No sessions found to export.'));
      return;
    }

    const { Select } = enquirer as any;
    const sessionPrompt = new Select({
      name: 'session',
      message: 'Select a session to export:',
      choices: sessions.slice(0, 10).map((s) => ({
        name: s.sessionId,
        message: `${s.projectName} - ${new Date(s.createdAt).toLocaleString()} (${s.messageCount} messages)`,
      })),
    });

    try {
      const selectedId = await sessionPrompt.run();
      session = await sessionManager.loadSession(selectedId);
    } catch {
      console.log(chalk.gray('Cancelled.'));
      return;
    }
  }

  // Get session data
  const metadata = session.metadata;
  const messages = session.getMessages();

  if (messages.length === 0) {
    console.log(chalk.yellow('No messages in session to export.'));
    return;
  }

  // Choose export format
  const { Select, Confirm, Input } = enquirer as any;

  const formatPrompt = new Select({
    name: 'format',
    message: 'Export format:',
    choices: [
      { name: 'md', message: 'Markdown (.md)' },
      { name: 'json', message: 'JSON (.json)' },
      { name: 'html', message: 'HTML (.html)' },
    ],
  });

  let format: 'md' | 'json' | 'html';
  try {
    format = await formatPrompt.run();
  } catch {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  // Export options for markdown/html
  const options: ExportOptions = {};

  if (format === 'md' || format === 'html') {
    const includeToolsPrompt = new Confirm({
      name: 'includeTools',
      message: 'Include tool outputs?',
      initial: true,
    });

    try {
      options.includeToolOutputs = await includeToolsPrompt.run();
    } catch {
      options.includeToolOutputs = true;
    }

    const includeTocPrompt = new Confirm({
      name: 'includeToc',
      message: 'Include table of contents?',
      initial: false,
    });

    try {
      options.includeToc = await includeTocPrompt.run();
    } catch {
      options.includeToc = false;
    }
  }

  // Get filename
  const suggestedFilename = getSuggestedFilename(metadata, format);

  const filenamePrompt = new Input({
    name: 'filename',
    message: 'Save as:',
    initial: suggestedFilename,
  });

  let filename: string;
  try {
    filename = await filenamePrompt.run();
  } catch {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  // Generate export
  let content: string;
  switch (format) {
    case 'md':
      content = exportToMarkdown(metadata, messages, options);
      break;
    case 'json':
      content = exportToJson(metadata, messages);
      break;
    case 'html':
      content = exportToHtml(metadata, messages, options);
      break;
  }

  // Save file
  const filePath = path.isAbsolute(filename) ? filename : path.join(workspaceRoot, filename);

  try {
    await saveExport(content, filePath);
    console.log();
    console.log(chalk.green('Session exported successfully!'));
    console.log(chalk.cyan(`  ${filePath}`));
    console.log(chalk.gray(`  ${messages.length} messages, ${(Buffer.byteLength(content, 'utf8') / 1024).toFixed(1)} KB`));
    console.log();
  } catch (error) {
    console.log(chalk.red(`Failed to save export: ${(error as Error).message}`));
  }
}
