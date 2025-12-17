/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Syntax Highlighting for Terminal Output
 * Uses regex-based tokenization for common languages
 */
import chalk from 'chalk';
import path from 'node:path';

// Language detection by file extension
const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.rb': 'ruby',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'fish',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.sql': 'sql',
  '.md': 'markdown',
  '.dockerfile': 'dockerfile',
  '.prisma': 'prisma',
  '.graphql': 'graphql',
  '.gql': 'graphql',
};

// Common keywords by language family
const KEYWORDS: Record<string, string[]> = {
  typescript: [
    'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum',
    'import', 'export', 'from', 'default', 'async', 'await', 'return', 'if',
    'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
    'try', 'catch', 'finally', 'throw', 'new', 'this', 'super', 'extends',
    'implements', 'static', 'public', 'private', 'protected', 'readonly',
    'abstract', 'as', 'is', 'in', 'of', 'typeof', 'instanceof', 'keyof',
    'never', 'unknown', 'any', 'void', 'null', 'undefined', 'true', 'false',
  ],
  javascript: [
    'const', 'let', 'var', 'function', 'class', 'import', 'export', 'from',
    'default', 'async', 'await', 'return', 'if', 'else', 'for', 'while',
    'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally',
    'throw', 'new', 'this', 'super', 'extends', 'static', 'get', 'set',
    'typeof', 'instanceof', 'in', 'of', 'true', 'false', 'null', 'undefined',
  ],
  python: [
    'def', 'class', 'import', 'from', 'as', 'return', 'if', 'elif', 'else',
    'for', 'while', 'break', 'continue', 'try', 'except', 'finally', 'raise',
    'with', 'as', 'pass', 'lambda', 'yield', 'global', 'nonlocal', 'assert',
    'async', 'await', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is',
  ],
  rust: [
    'fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl', 'trait',
    'type', 'where', 'for', 'loop', 'while', 'if', 'else', 'match', 'return',
    'break', 'continue', 'pub', 'mod', 'use', 'crate', 'super', 'self', 'Self',
    'async', 'await', 'move', 'ref', 'dyn', 'true', 'false', 'as', 'in', 'unsafe',
  ],
  go: [
    'func', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan',
    'package', 'import', 'return', 'if', 'else', 'for', 'range', 'switch',
    'case', 'default', 'break', 'continue', 'go', 'defer', 'select', 'fallthrough',
    'true', 'false', 'nil', 'make', 'new', 'append', 'len', 'cap',
  ],
  bash: [
    'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case',
    'esac', 'function', 'return', 'exit', 'break', 'continue', 'export',
    'local', 'readonly', 'declare', 'unset', 'source', 'alias', 'echo', 'printf',
  ],
  sql: [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'ORDER', 'BY',
    'GROUP', 'HAVING', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AS',
    'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE',
    'DROP', 'ALTER', 'INDEX', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
    'NULL', 'DEFAULT', 'DISTINCT', 'LIMIT', 'OFFSET', 'UNION', 'ALL',
  ],
};

// Built-in types by language
const BUILTIN_TYPES: Record<string, string[]> = {
  typescript: [
    'string', 'number', 'boolean', 'object', 'symbol', 'bigint', 'Array',
    'Map', 'Set', 'Promise', 'Record', 'Partial', 'Required', 'Readonly',
    'Pick', 'Omit', 'Exclude', 'Extract', 'NonNullable', 'ReturnType',
  ],
  rust: [
    'i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'u8', 'u16', 'u32', 'u64',
    'u128', 'usize', 'f32', 'f64', 'bool', 'char', 'str', 'String', 'Vec',
    'Option', 'Result', 'Box', 'Rc', 'Arc', 'Cell', 'RefCell', 'HashMap',
  ],
  go: [
    'int', 'int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16',
    'uint32', 'uint64', 'uintptr', 'float32', 'float64', 'complex64',
    'complex128', 'bool', 'byte', 'rune', 'string', 'error',
  ],
};

interface Token {
  type: 'keyword' | 'string' | 'number' | 'comment' | 'type' | 'function' | 'operator' | 'punctuation' | 'text';
  value: string;
}

/**
 * Detect language from file path or content
 */
export function detectLanguage(filePath?: string, content?: string): string {
  if (filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (EXTENSION_MAP[ext]) {
      return EXTENSION_MAP[ext];
    }
    // Check for special filenames
    const basename = path.basename(filePath).toLowerCase();
    if (basename === 'dockerfile') return 'dockerfile';
    if (basename === 'makefile') return 'makefile';
    if (basename.endsWith('.d.ts')) return 'typescript';
  }

  // Try to detect from content
  if (content) {
    if (content.includes('#!/bin/bash') || content.includes('#!/usr/bin/env bash')) {
      return 'bash';
    }
    if (content.includes('#!/usr/bin/env python') || content.includes('#!/usr/bin/python')) {
      return 'python';
    }
    if (content.includes('#!/usr/bin/env node')) {
      return 'javascript';
    }
  }

  return 'text';
}

/**
 * Tokenize code for syntax highlighting
 */
function tokenize(code: string, language: string): Token[] {
  const tokens: Token[] = [];
  const keywords = KEYWORDS[language] || KEYWORDS.javascript || [];
  const types = BUILTIN_TYPES[language] || [];

  // Simple regex-based tokenization
  const patterns: Array<{ type: Token['type']; regex: RegExp }> = [
    // Comments (single line)
    { type: 'comment', regex: /^(\/\/.*|#.*|--.*)/m },
    // Comments (multi-line for JS/TS/C-style)
    { type: 'comment', regex: /^\/\*[\s\S]*?\*\// },
    // Strings (double quotes)
    { type: 'string', regex: /^"(?:[^"\\]|\\.)*"/ },
    // Strings (single quotes)
    { type: 'string', regex: /^'(?:[^'\\]|\\.)*'/ },
    // Template literals
    { type: 'string', regex: /^`(?:[^`\\]|\\.)*`/ },
    // Numbers
    { type: 'number', regex: /^0x[0-9a-fA-F]+|^0b[01]+|^0o[0-7]+|^\d+\.?\d*(?:[eE][+-]?\d+)?/ },
    // Operators
    { type: 'operator', regex: /^(?:=>|===|!==|==|!=|<=|>=|&&|\|\||[+\-*/%<>=!&|^~?:])+/ },
    // Punctuation
    { type: 'punctuation', regex: /^[{}[\]();,.]/ },
    // Words (identifiers, keywords, types)
    { type: 'text', regex: /^[a-zA-Z_$][a-zA-Z0-9_$]*/ },
    // Whitespace and other
    { type: 'text', regex: /^\s+/ },
    { type: 'text', regex: /^./ },
  ];

  let remaining = code;
  while (remaining.length > 0) {
    let matched = false;

    for (const { type, regex } of patterns) {
      const match = remaining.match(regex);
      if (match) {
        let tokenType = type;
        const value = match[0];

        // Classify words as keywords, types, or identifiers
        if (type === 'text' && /^[a-zA-Z_$]/.test(value)) {
          if (keywords.includes(value)) {
            tokenType = 'keyword';
          } else if (types.includes(value)) {
            tokenType = 'type';
          } else if (/^[A-Z]/.test(value)) {
            tokenType = 'type'; // PascalCase likely a type/class
          }
        }

        tokens.push({ type: tokenType, value });
        remaining = remaining.slice(value.length);
        matched = true;
        break;
      }
    }

    if (!matched) {
      tokens.push({ type: 'text', value: remaining[0] });
      remaining = remaining.slice(1);
    }
  }

  return tokens;
}

/**
 * Apply colors to tokens
 */
function colorToken(token: Token): string {
  switch (token.type) {
    case 'keyword':
      return chalk.magenta(token.value);
    case 'string':
      return chalk.green(token.value);
    case 'number':
      return chalk.yellow(token.value);
    case 'comment':
      return chalk.gray(token.value);
    case 'type':
      return chalk.cyan(token.value);
    case 'function':
      return chalk.blue(token.value);
    case 'operator':
      return chalk.white(token.value);
    case 'punctuation':
      return chalk.white(token.value);
    default:
      return token.value;
  }
}

/**
 * Highlight a single line of code
 */
export function highlightLine(line: string, language: string): string {
  const tokens = tokenize(line, language);
  return tokens.map(colorToken).join('');
}

/**
 * Highlight code with syntax coloring
 */
export function highlight(code: string, language?: string, filePath?: string): string {
  const lang = language || detectLanguage(filePath, code);

  if (lang === 'text') {
    return code; // No highlighting for plain text
  }

  const lines = code.split('\n');
  return lines.map(line => highlightLine(line, lang)).join('\n');
}

/**
 * Highlight code block with line numbers
 */
export function highlightWithLineNumbers(
  code: string,
  options: {
    language?: string;
    filePath?: string;
    startLine?: number;
    highlightLines?: number[];
  } = {}
): string {
  const { language, filePath, startLine = 1, highlightLines = [] } = options;
  const lang = language || detectLanguage(filePath, code);
  const lines = code.split('\n');
  const maxLineNum = startLine + lines.length - 1;
  const lineNumWidth = String(maxLineNum).length;

  return lines.map((line, idx) => {
    const lineNum = startLine + idx;
    const lineNumStr = String(lineNum).padStart(lineNumWidth, ' ');
    const highlighted = lang !== 'text' ? highlightLine(line, lang) : line;
    const isHighlighted = highlightLines.includes(lineNum);

    if (isHighlighted) {
      return chalk.bgYellow.black(` ${lineNumStr} `) + ' ' + highlighted;
    }
    return chalk.gray(` ${lineNumStr} `) + chalk.gray('│') + ' ' + highlighted;
  }).join('\n');
}

/**
 * Format a code block for terminal display
 */
export function formatCodeBlock(
  code: string,
  options: {
    language?: string;
    filePath?: string;
    showLineNumbers?: boolean;
    maxLines?: number;
    title?: string;
  } = {}
): string {
  const { language, filePath, showLineNumbers = true, maxLines, title } = options;
  const lang = language || detectLanguage(filePath, code);

  let lines = code.split('\n');
  let truncated = false;

  if (maxLines && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    truncated = true;
  }

  const output: string[] = [];

  // Header
  if (title || filePath) {
    const headerText = title || filePath || '';
    const langBadge = lang !== 'text' ? chalk.gray(` [${lang}]`) : '';
    output.push(chalk.cyan('─'.repeat(60)));
    output.push(chalk.cyan.bold(headerText) + langBadge);
    output.push(chalk.cyan('─'.repeat(60)));
  }

  // Code content
  const processedCode = lines.join('\n');
  if (showLineNumbers) {
    output.push(highlightWithLineNumbers(processedCode, { language: lang, filePath }));
  } else {
    output.push(highlight(processedCode, lang, filePath));
  }

  // Truncation notice
  if (truncated) {
    output.push(chalk.yellow(`... (${code.split('\n').length - maxLines!} more lines)`));
  }

  return output.join('\n');
}
