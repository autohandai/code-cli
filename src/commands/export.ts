/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import path from 'node:path';
import { showModal, showInput, showConfirm, type ModalOption } from '../ui/ink/components/Modal.js';
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

    const sessionOptions: ModalOption[] = sessions.slice(0, 10).map((s) => ({
      label: `${s.projectName} - ${new Date(s.createdAt).toLocaleString()} (${s.messageCount} messages)`,
      value: s.sessionId,
    }));

    const sessionResult = await showModal({
      title: 'Select a session to export:',
      options: sessionOptions
    });

    if (!sessionResult) {
      console.log(chalk.gray('Cancelled.'));
      return;
    }

    session = await sessionManager.loadSession(sessionResult.value);
  }

  // Get session data
  const metadata = session.metadata;
  const messages = session.getMessages();

  if (messages.length === 0) {
    console.log(chalk.yellow('No messages in session to export.'));
    return;
  }

  // Choose export format
  const formatOptions: ModalOption[] = [
    { label: 'Markdown (.md)', value: 'md' },
    { label: 'JSON (.json)', value: 'json' },
    { label: 'HTML (.html)', value: 'html' },
  ];

  const formatResult = await showModal({
    title: 'Export format:',
    options: formatOptions
  });

  if (!formatResult) {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  const format = formatResult.value as 'md' | 'json' | 'html';

  // Export options for markdown/html
  const options: ExportOptions = {};

  if (format === 'md' || format === 'html') {
    options.includeToolOutputs = await showConfirm({
      title: 'Include tool outputs?',
      defaultValue: true
    });

    options.includeToc = await showConfirm({
      title: 'Include table of contents?',
      defaultValue: false
    });
  }

  // Get filename
  const suggestedFilename = getSuggestedFilename(metadata, format);

  const filename = await showInput({
    title: 'Save as:',
    defaultValue: suggestedFilename
  });

  if (!filename) {
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
