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
import type { List, ListItem, Nodes, PhrasingContent, Root, RootContent, Table } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import stringWidth from 'string-width';
import { unified } from 'unified';
import { renderTerminalMarkdown } from '../core/immediateCommandRouter.js';
import { highlight } from './syntaxHighlight.js';
import { getTheme, isThemeInitialized } from './theme/index.js';
import type { ColorToken } from './theme/types.js';

export interface TerminalMarkdownOptions {
  /** Apply ANSI styling. Defaults to the terminal's color support. */
  color?: boolean;
  /** Terminal width used for horizontal rules. Defaults to the current terminal. */
  width?: number;
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
      return node.value;
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
      const label = renderInline(node.children, ctx);
      const text = styles.underline(styles.token('mdLink', label));
      if (label === node.url || label === node.url.replace(/^mailto:/, '')) {
        return text;
      }
      return `${text} ${styles.token('mdLinkUrl', `(${node.url})`)}`;
    }
    case 'image':
      return `${node.alt || 'image'} ${styles.token('mdLinkUrl', `(${node.url})`)}`;
    case 'linkReference':
      return renderInline(node.children, ctx);
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
      return renderInline(node.children, ctx).split('\n');
    case 'heading':
      return renderInline(node.children, ctx)
        .split('\n')
        .map((line) => styles.bold(styles.token('mdHeading', line)));
    case 'thematicBreak':
      return [styles.token('mdHr', '─'.repeat(Math.max(3, Math.min(ctx.width, MAX_RULE_WIDTH))))];
    case 'blockquote': {
      const border = styles.token('mdQuoteBorder', '│');
      return renderBlocks(node.children, ctx).map((line) => (line ? `${border} ${styles.token('mdQuote', line)}` : border));
    }
    case 'code': {
      const lines: string[] = [];
      if (node.lang) {
        lines.push(`  ${styles.token('mdCodeBlockBorder', node.lang)}`);
      }
      const code = styles.color && node.lang ? highlight(node.value, node.lang) : node.value;
      lines.push(...code.split('\n').map((line) => `  ${line}`));
      return lines;
    }
    case 'list':
      return renderList(node, 0, ctx);
    case 'table':
      return renderTable(node, ctx);
    case 'html':
      return node.value.split('\n');
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
    const itemLines = renderListItem(item, depth, ctx);
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
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(0, ...rows.map((row) => stringWidth(row[column] ?? ''))));
  const align = table.align ?? [];
  const divider = styles.token('mdHr', '│');

  const lines = rows.map((row, rowIndex) => Array.from({ length: columns }, (_, column) => {
    const cell = padCell(row[column] ?? '', widths[column], align[column]);
    return rowIndex === 0 ? styles.bold(cell) : cell;
  }).join(` ${divider} `).trimEnd());

  if (lines.length > 0) {
    const rule = styles.token('mdHr', widths.map((width) => '─'.repeat(width)).join('─┼─'));
    lines.splice(1, 0, rule);
  }
  return lines;
}

/** Render markdown as styled terminal text. */
export function renderMarkdownForTerminal(markdown: string, options: TerminalMarkdownOptions = {}): string {
  if (!markdown) return markdown;
  const ctx: RenderContext = {
    source: markdown,
    styles: createStyles(options.color ?? chalk.level > 0),
    width: options.width ?? process.stdout.columns ?? 80,
  };
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root;
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
