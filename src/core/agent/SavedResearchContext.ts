/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';

export const SAVED_RESEARCH_DIR = path.join('.autohand', 'research');

export interface SavedResearchReport {
  relativePath: string;
  title: string;
  excerpt: string;
  updatedAtMs: number;
}

const RESEARCH_FILE_PATTERN = /^topic-[a-z0-9][a-z0-9-]*\.md$/i;
const EXCERPT_MAX_LENGTH = 220;

export async function listSavedResearchReports(
  workspaceRoot: string,
  limit = 5
): Promise<SavedResearchReport[]> {
  const researchDir = path.join(workspaceRoot, SAVED_RESEARCH_DIR);
  if (!(await fs.pathExists(researchDir))) {
    return [];
  }

  const entries = await fs.readdir(researchDir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && RESEARCH_FILE_PATTERN.test(entry.name))
    .map((entry) => path.join(researchDir, entry.name));

  const reports = await Promise.all(candidates.map(async (filePath) => {
    const [stat, content] = await Promise.all([
      fs.stat(filePath),
      fs.readFile(filePath, 'utf8').catch(() => ''),
    ]);

    return {
      relativePath: normalizeRelativePath(path.relative(workspaceRoot, filePath)),
      title: extractTitle(content, path.basename(filePath, '.md')),
      excerpt: extractExcerpt(content),
      updatedAtMs: stat.mtimeMs,
    };
  }));

  return reports
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.relativePath.localeCompare(b.relativePath))
    .slice(0, limit);
}

export function formatSavedResearchReports(reports: SavedResearchReport[]): string[] {
  return reports.map((report) => {
    const detail = report.excerpt ? `: ${report.excerpt}` : '';
    return `- ${report.relativePath} - ${report.title}${detail}`;
  });
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function extractTitle(content: string, fallbackName: string): string {
  const heading = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('# '));

  if (heading) {
    return heading.replace(/^#\s+/, '').trim();
  }

  return fallbackName
    .replace(/^topic-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractExcerpt(content: string): string {
  const lines = content.split(/\r?\n/);
  const summaryIndex = lines.findIndex((line) => /^##\s+summary\b/i.test(line.trim()));
  const sourceLines = summaryIndex >= 0 ? lines.slice(summaryIndex + 1) : lines;
  const excerpt = sourceLines
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('---'));

  if (!excerpt) {
    return '';
  }

  return excerpt.length > EXCERPT_MAX_LENGTH
    ? `${excerpt.slice(0, EXCERPT_MAX_LENGTH - 3)}...`
    : excerpt;
}
