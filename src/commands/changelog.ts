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

/** The heading that opens a release's install and update instructions; everything after it is about getting the build. */
const INSTALL_SECTION = /^#{1,6}\s+(?:get it|install(?:ation|ing)?|how to (?:install|update|upgrade)|updat(?:e|ing)|upgrad(?:e|ing)|downloads?)\s*$/i;
const THEMATIC_BREAK = /^(?:-{3,}|\*{3,}|_{3,})$/;
/** Rows the release workflow wraps around the changes: its greeting, the pre-release banner and the compare link. */
const BOILERPLATE_ROWS = [
  /^hey there!/i,
  /what's new since v[\w.-]+:$/i,
  /^>\s*\*\*alpha release\*\*/i,
  /^full comparison:\s/i,
];

/**
 * The part of a release's notes that says what changed. The published notes also greet the
 * reader and explain how to install the build, which someone already running it does not need.
 */
export function releaseChanges(body: string): string {
  const rows = body.replace(/\r\n?/g, '\n').split('\n');
  const installAt = rows.findIndex((row) => INSTALL_SECTION.test(row.trim()));
  const changes = (installAt >= 0 ? rows.slice(0, installAt) : rows)
    .filter((row) => !BOILERPLATE_ROWS.some((pattern) => pattern.test(row.trim())));
  while (changes.length > 0 && (changes.at(-1)!.trim() === '' || THEMATIC_BREAK.test(changes.at(-1)!.trim()))) {
    changes.pop();
  }
  return changes.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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
  const notes = release.body ? releaseChanges(release.body) : '';

  return [
    `## ${escapeMarkdown(title)}`,
    ...(details ? [details] : []),
    notes || 'No release notes provided.',
  ];
}

/**
 * Recent releases as one markdown document holding each release's changes, still as markdown,
 * so whichever surface shows the result lays them out at its own width.
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
