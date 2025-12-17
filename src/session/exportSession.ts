/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Session Export
 * Export sessions to markdown and other formats
 */
import fs from 'fs-extra';
import path from 'node:path';
import type { SessionMetadata, SessionMessage } from './types.js';

export interface ExportOptions {
  /** Include tool outputs in the export */
  includeToolOutputs?: boolean;
  /** Include timestamps for each message */
  includeTimestamps?: boolean;
  /** Include session metadata header */
  includeMetadata?: boolean;
  /** Maximum length for code blocks before truncation */
  maxCodeBlockLength?: number;
  /** Include table of contents */
  includeToc?: boolean;
}

const DEFAULT_OPTIONS: ExportOptions = {
  includeToolOutputs: true,
  includeTimestamps: false,
  includeMetadata: true,
  maxCodeBlockLength: 500,
  includeToc: false,
};

/**
 * Escape markdown special characters
 */
function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

/**
 * Format a code block with optional language
 */
function formatCodeBlock(code: string, language?: string, maxLength?: number): string {
  let content = code;

  if (maxLength && content.length > maxLength) {
    content = content.slice(0, maxLength) + '\n... (truncated)';
  }

  const lang = language || '';
  return '```' + lang + '\n' + content + '\n```';
}

/**
 * Detect language from file extension or content
 */
function detectLanguage(content: string, context?: string): string {
  // Check context for file path hints
  if (context) {
    const extMatch = context.match(/\.(\w+)$/);
    if (extMatch) {
      const ext = extMatch[1].toLowerCase();
      const langMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        py: 'python',
        rs: 'rust',
        go: 'go',
        rb: 'ruby',
        java: 'java',
        cpp: 'cpp',
        c: 'c',
        sh: 'bash',
        bash: 'bash',
        json: 'json',
        yaml: 'yaml',
        yml: 'yaml',
        md: 'markdown',
        sql: 'sql',
        html: 'html',
        css: 'css',
      };
      return langMap[ext] || ext;
    }
  }

  // Try to detect from content
  if (content.includes('function') || content.includes('const ') || content.includes('let ')) {
    return 'javascript';
  }
  if (content.includes('def ') || content.includes('import ') && content.includes(':')) {
    return 'python';
  }
  if (content.includes('fn ') || content.includes('let mut')) {
    return 'rust';
  }
  if (content.includes('func ') || content.includes('package ')) {
    return 'go';
  }

  return '';
}

/**
 * Format a timestamp for display
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a single message for markdown
 */
function formatMessage(
  message: SessionMessage,
  options: ExportOptions,
  index: number
): string {
  const parts: string[] = [];

  // Message header
  const roleEmoji: Record<string, string> = {
    user: '👤',
    assistant: '🤖',
    tool: '🔧',
    system: '⚙️',
  };

  const emoji = roleEmoji[message.role] || '💬';
  const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1);
  const timestamp = options.includeTimestamps && message.timestamp
    ? ` (${formatTimestamp(message.timestamp)})`
    : '';

  parts.push(`### ${emoji} ${roleLabel}${timestamp}`);
  parts.push('');

  // Message content
  if (message.role === 'tool') {
    if (options.includeToolOutputs) {
      const toolName = message.name || 'Tool';
      parts.push(`**${toolName}**`);
      parts.push('');

      // Try to format as code block if it looks like code/output
      if (message.content.includes('\n') || message.content.length > 100) {
        const lang = detectLanguage(message.content, message.name);
        parts.push(formatCodeBlock(message.content, lang, options.maxCodeBlockLength));
      } else {
        parts.push(`> ${message.content}`);
      }
    } else {
      parts.push('*Tool output omitted*');
    }
  } else {
    // Process content for code blocks
    const content = message.content;

    // Split by code blocks
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Add text before code block
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index).trim());
      }

      // Add code block
      const lang = match[1] || '';
      const code = match[2];
      parts.push(formatCodeBlock(code, lang, options.maxCodeBlockLength));

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      const remaining = content.slice(lastIndex).trim();
      if (remaining) {
        parts.push(remaining);
      }
    }
  }

  parts.push('');
  parts.push('---');
  parts.push('');

  return parts.join('\n');
}

/**
 * Export a session to markdown format
 */
export function exportToMarkdown(
  metadata: SessionMetadata,
  messages: SessionMessage[],
  options: ExportOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const parts: string[] = [];

  // Title
  parts.push(`# ${metadata.projectName} - Session ${metadata.sessionId.slice(0, 8)}`);
  parts.push('');

  // Metadata
  if (opts.includeMetadata) {
    parts.push('## Session Info');
    parts.push('');
    parts.push(`| Property | Value |`);
    parts.push(`|----------|-------|`);
    parts.push(`| **Project** | ${metadata.projectName} |`);
    parts.push(`| **Started** | ${formatTimestamp(metadata.createdAt)} |`);
    if (metadata.closedAt) {
      parts.push(`| **Ended** | ${formatTimestamp(metadata.closedAt)} |`);
    }
    parts.push(`| **Model** | ${metadata.model} |`);
    parts.push(`| **Messages** | ${metadata.messageCount} |`);
    parts.push(`| **Status** | ${metadata.status} |`);
    parts.push('');

    if (metadata.summary) {
      parts.push('### Summary');
      parts.push('');
      parts.push(metadata.summary);
      parts.push('');
    }

    parts.push('---');
    parts.push('');
  }

  // Table of contents
  if (opts.includeToc) {
    parts.push('## Table of Contents');
    parts.push('');
    let userCount = 0;
    for (const message of messages) {
      if (message.role === 'user') {
        userCount++;
        const preview = message.content.slice(0, 50).replace(/\n/g, ' ');
        parts.push(`${userCount}. [${preview}...](#message-${userCount})`);
      }
    }
    parts.push('');
    parts.push('---');
    parts.push('');
  }

  // Messages
  parts.push('## Conversation');
  parts.push('');

  let userCount = 0;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    // Add anchor for TOC
    if (opts.includeToc && message.role === 'user') {
      userCount++;
      parts.push(`<a name="message-${userCount}"></a>`);
      parts.push('');
    }

    parts.push(formatMessage(message, opts, i));
  }

  // Footer
  parts.push('---');
  parts.push('');
  parts.push(`*Exported from Autohand CLI on ${new Date().toLocaleString()}*`);

  return parts.join('\n');
}

/**
 * Export a session to JSON format
 */
export function exportToJson(
  metadata: SessionMetadata,
  messages: SessionMessage[],
  pretty = true
): string {
  const data = {
    metadata,
    messages,
    exportedAt: new Date().toISOString(),
    version: '1.0',
  };

  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

/**
 * Export a session to HTML format
 */
export function exportToHtml(
  metadata: SessionMetadata,
  messages: SessionMessage[],
  options: ExportOptions = {}
): string {
  const markdown = exportToMarkdown(metadata, messages, options);

  // Simple markdown to HTML conversion
  const html = markdown
    // Headers
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Tables (basic)
    .replace(/\|([^|]+)\|/g, '<td>$1</td>')
    // Blockquotes
    .replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${metadata.projectName} - Session ${metadata.sessionId.slice(0, 8)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; }
    h1, h2, h3 { color: #333; }
    pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }
    code { background: #f5f5f5; padding: 0.2rem 0.4rem; border-radius: 3px; font-size: 0.9em; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #ddd; margin: 0; padding-left: 1rem; color: #666; }
    hr { border: none; border-top: 1px solid #ddd; margin: 1.5rem 0; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
  </style>
</head>
<body>
  <p>${html}</p>
</body>
</html>`;
}

/**
 * Save exported session to file
 */
export async function saveExport(
  content: string,
  filePath: string
): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf8');
}

/**
 * Get suggested filename for export
 */
export function getSuggestedFilename(
  metadata: SessionMetadata,
  format: 'md' | 'json' | 'html'
): string {
  const date = new Date(metadata.createdAt);
  const dateStr = date.toISOString().split('T')[0];
  const projectSlug = metadata.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const sessionShort = metadata.sessionId.slice(0, 8);

  return `${projectSlug}-${dateStr}-${sessionShort}.${format}`;
}
