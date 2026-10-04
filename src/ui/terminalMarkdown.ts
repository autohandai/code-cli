/**
 * Terminal rendering for assistant markdown.
 *
 * Parses GitHub-flavored markdown and renders headings, emphasis, inline and
 * fenced code, lists, task lists, block quotes, rules, links, and tables as
 * terminal text. Structure survives without color, so the output stays
 * readable in any terminal, including ones that set NO_COLOR.
 *
 * `ui.renderMarkdown` (default true) chooses between this rendering and the
 * markdown as written.
 *
 * @license Apache-2.0
 */
import chalk, { Chalk, type ChalkInstance } from 'chalk';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import type { List, ListItem, Nodes, PhrasingContent, Root, RootContent, Table } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import stringWidth from 'string-width';
import terminalLink from 'terminal-link';
import { unified } from 'unified';
import wrapAnsi from 'wrap-ansi';
import { renderTerminalMarkdown } from '../core/immediateCommandRouter.js';
import { highlight } from './syntaxHighlight.js';
import { getTheme, isThemeInitialized } from './theme/index.js';
import type { ColorToken } from './theme/types.js';

export interface TerminalMarkdownOptions {
  /** Apply ANSI styling. Defaults to the terminal's color support. */
  color?: boolean;
  /** Available columns for prose, lists, code and tables. */
  width?: number;
  /** Disable terminal hyperlinks while retaining visible destinations. */
  hyperlinks?: boolean;
}

type MarkdownToken = Extract<ColorToken,
  'mdHeading' | 'mdLink' | 'mdLinkUrl' | 'mdCode' | 'mdCodeBlockBorder' | 'mdQuote' | 'mdQuoteBorder' | 'mdHr' | 'mdListBullet'>;

interface Styles {
  color: boolean;
  bold(text: string): string;
  italic(text: string): string;
  strike(text: string): string;
  underline(text: string): string;
  token(token: MarkdownToken, text: string): string;
}

const BULLETS = ['•', '◦', '▪'];
const MAX_RULE_WIDTH = 60;

const identity = (text: string): string => text;

function fallbackTokenStyle(ink: ChalkInstance, token: MarkdownToken): (text: string) => string {
  switch (token) {
    case 'mdHeading':
    case 'mdListBullet':
      return ink.cyan;
    case 'mdLink':
      return ink.blue;
    case 'mdCode':
      return ink.yellow;
    default:
      return ink.gray;
  }
}

function createStyles(color: boolean): Styles {
  if (!color) {
    return { color, bold: identity, italic: identity, strike: identity, underline: identity, token: (_token, text) => text };
  }
  const ink = chalk.level > 0 ? chalk : new Chalk({ level: 1 });
  return {
    color,
    bold: (text) => ink.bold(text),
    italic: (text) => ink.italic(text),
    strike: (text) => ink.strikethrough(text),
    underline: (text) => ink.underline(text),
    token: (token, text) => {
      if (isThemeInitialized()) {
        const themed = getTheme().fg(token, text);
        if (themed !== text) return themed;
      }
      return fallbackTokenStyle(ink, token)(text);
    },
  };
}

interface RenderContext {
  source: string;
  styles: Styles;
  width: number;
  hyperlinks: boolean;
  definitions: Map<string, string>;
  insideLink?: boolean;
}

function wrap(text: string, width: number, trim = true): string[] {
  return wrapAnsi(text, Math.max(1, width), { hard: true, trim }).split('\n');
}

function linkTarget(destination: string): string | undefined {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(destination)) return undefined;
  if (path.isAbsolute(destination)) return pathToFileURL(destination).href;
  if (/^[a-z][a-z\d+.-]*:/i.test(destination)) {
    try {
      const url = new URL(destination);
      return ['https:', 'http:', 'mailto:', 'file:'].includes(url.protocol) ? destination : undefined;
    } catch {
      return undefined;
    }
  }
  return destination.startsWith('#') ? undefined : pathToFileURL(path.resolve(destination)).href;
}

function collectDefinitions(node: Nodes, definitions = new Map<string, string>()): Map<string, string> {
  if (node.type === 'definition' && !definitions.has(node.identifier.toLowerCase())) {
    definitions.set(node.identifier.toLowerCase(), node.url);
  }
  if ('children' in node) {
    for (const child of node.children) collectDefinitions(child, definitions);
  }
  return definitions;
}

function renderLink(label: string, destination: string, ctx: RenderContext): string {
  if (ctx.insideLink) return label;
  const text = ctx.styles.underline(ctx.styles.token('mdLink', label));
  const target = linkTarget(destination);
  if (ctx.hyperlinks && target) {
    return terminalLink(text, target, { fallback: () => `${text} (${destination})` });
  }
  return label === destination || label === destination.replace(/^mailto:/, '')
    ? text
    : `${text} ${ctx.styles.token('mdLinkUrl', `(${destination})`)}`;
}

function sourceOf(node: Nodes, ctx: RenderContext): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? '' : ctx.source.slice(start, end);
}

function renderInline(nodes: PhrasingContent[], ctx: RenderContext): string {
  return nodes.map((node) => renderInlineNode(node, ctx)).join('');
}

function renderInlineNode(node: PhrasingContent, ctx: RenderContext): string {
  const { styles } = ctx;
  switch (node.type) {
    case 'text':
      return node.value.replace(/\n/g, ' ');
    case 'strong':
      return styles.bold(renderInline(node.children, ctx));
    case 'emphasis':
      return styles.italic(renderInline(node.children, ctx));
    case 'delete':
      return styles.strike(renderInline(node.children, ctx));
    case 'inlineCode': {
      // Without color, backticks are the only thing marking code apart from prose.
      const styled = styles.token('mdCode', node.value);
      return styled === node.value ? `\`${node.value}\`` : styled;
    }
    case 'break':
      return '\n';
    case 'link': {
      const label = renderInline(node.children, { ...ctx, insideLink: true });
      return renderLink(label, node.url, ctx);
    }
    case 'image':
      return renderLink(`Image: ${node.alt || node.url.split('/').at(-1) || 'image'}`, node.url, ctx);
    case 'linkReference': {
      const destination = ctx.definitions.get(node.identifier.toLowerCase());
      const label = renderInline(node.children, { ...ctx, insideLink: true });
      return destination ? renderLink(label, destination, ctx) : label;
    }
    case 'imageReference': {
      const destination = ctx.definitions.get(node.identifier.toLowerCase());
      return destination ? renderLink(`Image: ${node.alt || 'image'}`, destination, ctx) : sourceOf(node, ctx);
    }
    case 'footnoteReference':
      return `[^${node.label ?? node.identifier}]`;
    case 'html':
      return node.value;
    default:
      return sourceOf(node, ctx);
  }
}

function joinBlocks(blocks: string[][], separated: boolean): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.length === 0) continue;
    if (separated && lines.length > 0) lines.push('');
    lines.push(...block);
  }
  return lines;
}

function renderBlocks(nodes: RootContent[], ctx: RenderContext, separated = true): string[] {
  return joinBlocks(nodes.map((node) => renderBlock(node, ctx)), separated);
}

function renderBlock(node: RootContent, ctx: RenderContext): string[] {
  const { styles } = ctx;
  switch (node.type) {
    case 'paragraph':
      return wrap(renderInline(node.children, ctx), ctx.width);
    case 'heading':
      return wrap(renderInline(node.children, ctx), ctx.width)
        .map((line) => styles.bold(styles.token('mdHeading', line)));
    case 'thematicBreak':
      return [styles.token('mdHr', '─'.repeat(Math.min(ctx.width, MAX_RULE_WIDTH)))];
    case 'blockquote': {
      const border = styles.token('mdQuoteBorder', '│');
      return renderBlocks(node.children, { ...ctx, width: Math.max(1, ctx.width - 2) }).map((line) => (line ? `${border} ${styles.token('mdQuote', line)}` : border));
    }
    case 'code': {
      const lines: string[] = [];
      if (node.lang) {
        lines.push(...wrap(styles.token('mdCodeBlockBorder', node.lang), ctx.width));
      }
      const code = styles.color && node.lang ? highlight(node.value, node.lang) : node.value;
      const border = styles.token('mdCodeBlockBorder', '│');
      lines.push(...wrap(code, ctx.width - 2, false).map((line) => `${border} ${line}`));
      return lines;
    }
    case 'list':
      return renderList(node, 0, ctx);
    case 'table':
      return renderTable(node, ctx);
    case 'html':
      return wrap(node.value, ctx.width);
    case 'definition':
      return [];
    default:
      return sourceOf(node, ctx).split('\n');
  }
}

function renderListItem(item: ListItem, depth: number, ctx: RenderContext): string[] {
  const blocks = item.children.map((child) => (
    child.type === 'list' ? renderList(child, depth + 1, ctx) : renderBlock(child, ctx)
  ));
  return joinBlocks(blocks, item.spread === true);
}

function renderList(list: List, depth: number, ctx: RenderContext): string[] {
  const lines: string[] = [];
  const start = list.start ?? 1;
  list.children.forEach((item, index) => {
    let marker: string;
    if (item.checked === true) marker = '☑';
    else if (item.checked === false) marker = '☐';
    else if (list.ordered) marker = `${start + index}.`;
    else marker = BULLETS[depth % BULLETS.length];

    const styledMarker = list.ordered && item.checked == null ? marker : ctx.styles.token('mdListBullet', marker);
    const continuation = ' '.repeat(stringWidth(marker) + 1);
    const itemLines = renderListItem(item, depth, { ...ctx, width: Math.max(1, ctx.width - stringWidth(continuation)) });
    if (itemLines.length === 0) {
      lines.push(styledMarker);
    }
    itemLines.forEach((line, lineIndex) => {
      if (lineIndex === 0) lines.push(`${styledMarker} ${line}`);
      else lines.push(line ? `${continuation}${line}` : '');
    });
    if (list.spread && index < list.children.length - 1) {
      lines.push('');
    }
  });
  return lines;
}

function padCell(text: string, width: number, align: 'left' | 'right' | 'center' | null | undefined): string {
  const gap = Math.max(0, width - stringWidth(text));
  if (align === 'right') return `${' '.repeat(gap)}${text}`;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return `${' '.repeat(left)}${text}${' '.repeat(gap - left)}`;
  }
  return `${text}${' '.repeat(gap)}`;
}

function renderTable(table: Table, ctx: RenderContext): string[] {
  const { styles } = ctx;
  const rows = table.children.map((row) => row.children.map((cell) => renderInline(cell.children, ctx)));
  const columns = Math.max(0, ...rows.map((row) => row.length));
  const naturalWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(0, ...rows.map((row) => stringWidth(row[column] ?? ''))));
  const available = ctx.width - (columns - 1) * 3;
  if (available < columns * 3) {
    return joinBlocks(rows.slice(1).map((row) => row.flatMap((cell, column) =>
      wrap(`${rows[0]?.[column] || column + 1}: ${cell}`, ctx.width))), true);
  }
  const share = Math.floor(available / columns);
  const widths = naturalWidths.map(width => Math.min(width, share));
  let remaining = available - widths.reduce((sum, width) => sum + width, 0);
  while (remaining > 0) {
    const column = widths.findIndex((width, index) => width < naturalWidths[index]);
    if (column < 0) break;
    widths[column]++;
    remaining--;
  }
  const align = table.align ?? [];
  const divider = styles.token('mdHr', '│');

  const lines: string[] = [];
  rows.forEach((row, rowIndex) => {
    const cells = widths.map((width, column) => wrap(row[column] ?? '', width));
    const height = Math.max(...cells.map(cell => cell.length));
    for (let line = 0; line < height; line++) {
      lines.push(cells.map((cell, column) => {
        const padded = padCell(cell[line] ?? '', widths[column], align[column]);
        return rowIndex === 0 ? styles.bold(padded) : padded;
      }).join(` ${divider} `).trimEnd());
    }
    if (rowIndex === 0) {
      lines.push(styles.token('mdHr', widths.map(width => '─'.repeat(width)).join('─┼─')));
    }
  });
  return lines;
}

/** Render markdown as styled terminal text. */
export function renderMarkdownForTerminal(markdown: string, options: TerminalMarkdownOptions = {}): string {
  if (!markdown) return markdown;
  const source = stripVTControlCharacters(markdown).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source) as Root;
  const requestedWidth = options.width ?? process.stdout.columns ?? 80;
  const ctx: RenderContext = {
    source,
    styles: createStyles(options.color ?? chalk.level > 0),
    width: Number.isFinite(requestedWidth) ? Math.max(1, Math.floor(requestedWidth)) : 80,
    hyperlinks: options.hyperlinks !== false && terminalLink.isSupported,
    definitions: collectDefinitions(tree),
  };
  const lines = renderBlocks(tree.children, ctx);
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  return lines.join('\n');
}

let markdownPreference: () => boolean = () => true;

/** Tell the renderer where to read `ui.renderMarkdown`; read on every render so /settings applies live. */
export function setTerminalMarkdownPreference(provider: () => boolean): void {
  markdownPreference = provider;
}

export function isTerminalMarkdownEnabled(): boolean {
  try {
    return markdownPreference() !== false;
  } catch {
    return true;
  }
}

/**
 * Format assistant text for the terminal: rendered markdown when enabled,
 * otherwise the markdown as written with only the legacy bold and italic styling.
 */
export function formatAssistantMarkdown(text: string, options: TerminalMarkdownOptions = {}): string {
  if (!text) return text;
  if (!isTerminalMarkdownEnabled()) {
    return renderTerminalMarkdown(text);
  }
  try {
    return renderMarkdownForTerminal(text, options);
  } catch {
    return renderTerminalMarkdown(text);
  }
}
