/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/autohandai/code-cli/releases?per_page=10';
const REQUEST_TIMEOUT_MS = 5_000;
/** Two trailing spaces end a row inside a markdown paragraph. */
const MARKDOWN_LINE_BREAK = '  \n';

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
  loadReleases?: () => Promise<ChangelogRelease[] | null>;
}

export const metadata = {
  command: '/changelog',
  description: 'view recent GitHub release notes',
  implemented: true,
};

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_[\]<>~&]/g, '\\$&');
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

function formatRelease(release: ChangelogRelease): string[] {
  const title = [
    release.tagName,
    ...(release.prerelease ? ['[pre-release]'] : []),
    ...(release.name?.trim() ? [`— ${release.name.trim()}`] : []),
  ].join(' ');
  const publishedAt = formatPublishedAt(release.publishedAt);
  const details = [
    ...(publishedAt ? [`Published ${publishedAt}`] : []),
    ...(release.url ? [`<${release.url}>`] : []),
  ].join(MARKDOWN_LINE_BREAK);
  const notes = release.body?.replace(/\r\n?/g, '\n').trim();

  return [
    `## ${escapeMarkdown(title)}`,
    ...(details ? [details] : []),
    notes || 'No release notes provided.',
  ];
}

/**
 * Recent releases as one markdown document. The release notes are passed through as GitHub
 * published them, so whichever surface shows the result lays them out at its own width.
 */
export function formatChangelog(releases: ChangelogRelease[]): string {
  const blocks = releases.length === 0
    ? ['No published releases found.']
    : releases.flatMap(formatRelease);

  return ['# Autohand Changelog', ...blocks].join('\n\n');
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

  return formatChangelog(releases);
}
