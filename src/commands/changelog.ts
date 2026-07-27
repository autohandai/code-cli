/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getTerminalColumns } from '../utils/asciiArt.js';

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/autohandai/code-cli/releases?per_page=10';
const REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_TERMINAL_COLUMNS = 80;
const MIN_TERMINAL_COLUMNS = 20;

export interface ChangelogRelease {
  tagName: string;
  name: string | null;
  body: string | null;
  publishedAt: string | null;
  url: string;
  prerelease: boolean;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  published_at?: string | null;
  html_url?: string;
  prerelease?: boolean;
}

export interface ChangelogContext {
  terminalColumns?: number;
  loadReleases?: () => Promise<ChangelogRelease[] | null>;
}

export const metadata = {
  command: '/changelog',
  description: 'view recent GitHub release notes',
  implemented: true,
};

function normalizeTerminalColumns(terminalColumns: number): number {
  return Math.max(MIN_TERMINAL_COLUMNS, Math.floor(terminalColumns));
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(`+)(.*?)\1/g, '$2')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .trim();
}

function wrapLine(line: string, width: number, indent = ''): string[] {
  const availableWidth = Math.max(1, width - indent.length);
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [indent.trimEnd()];
  }

  const wrapped: string[] = [];
  let currentLine = indent;

  const appendChunk = (chunk: string): void => {
    if (currentLine.length === indent.length) {
      currentLine += chunk;
      return;
    }
    currentLine += ` ${chunk}`;
  };

  for (const word of words) {
    if (word.length > availableWidth) {
      if (currentLine.length > indent.length) {
        wrapped.push(currentLine);
        currentLine = indent;
      }

      for (let offset = 0; offset < word.length; offset += availableWidth) {
        const chunk = word.slice(offset, offset + availableWidth);
        if (chunk.length === availableWidth) {
          wrapped.push(`${indent}${chunk}`);
        } else {
          currentLine = `${indent}${chunk}`;
        }
      }
      continue;
    }

    const currentContentLength = currentLine.length - indent.length;
    const separatorLength = currentContentLength === 0 ? 0 : 1;
    if (currentContentLength + separatorLength + word.length > availableWidth) {
      wrapped.push(currentLine);
      currentLine = indent;
    }
    appendChunk(word);
  }

  if (currentLine.length > indent.length) {
    wrapped.push(currentLine);
  }

  return wrapped;
}

function wrapText(value: string, width: number, indent = ''): string[] {
  return value.split('\n').flatMap((line) => wrapLine(line, width, indent));
}

function formatPublishedAt(publishedAt: string | null): string | null {
  if (!publishedAt) {
    return null;
  }

  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function getReleaseNotes(body: string | null): string[] {
  if (!body?.trim()) {
    return [];
  }

  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.replace(/^[-*+]\s+|^\d+[.)]\s+/, ''))
    .map(stripMarkdown)
    .filter(Boolean);
}

function formatReleaseUrl(url: string, width: number): string[] {
  const displayUrl = url.replace(/^https?:\/\//, '');
  return wrapText(`Release: ${displayUrl}`, width);
}

export function formatChangelog(
  releases: ChangelogRelease[],
  { terminalColumns = DEFAULT_TERMINAL_COLUMNS }: Pick<ChangelogContext, 'terminalColumns'> = {},
): string {
  const width = normalizeTerminalColumns(terminalColumns);
  const lines = ['Autohand Changelog'];

  if (releases.length === 0) {
    lines.push('', 'No published releases found.');
    return lines.join('\n');
  }

  for (const release of releases) {
    const title = [
      release.tagName,
      ...(release.prerelease ? ['[pre-release]'] : []),
      ...(release.name?.trim() ? [`— ${release.name.trim()}`] : []),
    ].join(' ');
    const publishedAt = formatPublishedAt(release.publishedAt);
    const notes = getReleaseNotes(release.body);

    lines.push('');
    lines.push(...wrapText(title, width));
    if (publishedAt) {
      lines.push(...wrapText(`Published ${publishedAt}`, width));
    }
    if (notes.length === 0) {
      lines.push(...wrapText('No release notes provided.', width));
    } else {
      for (const note of notes) {
        lines.push(...wrapText(note, width, '• '));
      }
    }
    lines.push(...formatReleaseUrl(release.url, width));
  }

  return lines.join('\n');
}

async function loadGitHubReleases(): Promise<ChangelogRelease[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'autohand-cli',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }

    const releases = await response.json() as unknown;
    if (!Array.isArray(releases)) {
      return null;
    }

    return releases.map((release): ChangelogRelease => {
      const value = release as GitHubRelease;
      return {
        tagName: value.tag_name ?? 'Untitled release',
        name: value.name ?? null,
        body: value.body ?? null,
        publishedAt: value.published_at ?? null,
        url: value.html_url ?? '',
        prerelease: value.prerelease === true,
      };
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function changelog(ctx: ChangelogContext = {}): Promise<string> {
  const releases = await (ctx.loadReleases ?? loadGitHubReleases)();
  if (!releases) {
    return 'Unable to load the release changelog. Check your internet connection and try again.';
  }

  return formatChangelog(releases, {
    terminalColumns: ctx.terminalColumns ?? getTerminalColumns(process.stdout),
  });
}
