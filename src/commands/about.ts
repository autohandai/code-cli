/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'node:child_process';
import terminalLink from 'terminal-link';
import { t } from '../i18n/index.js';
import { createCommandTheme } from './commandTheme.js';
import { ASCII_FRIEND } from '../utils/asciiArt.js';
import packageJson from '../../package.json' with { type: 'json' };
import type { LoadedConfig } from '../types.js';
import { getUserGreetingName } from './accountDisplay.js';

/**
 * Get git commit hash (short)
 */
function getCommitFromAlphaVersion(version: string): string | null {
  const match = version.match(/-alpha\.([0-9a-f]{7,40})$/i);
  return match?.[1] ?? null;
}

function getGitCommit(): string {
  // Use build-time embedded commit if available
  if (process.env.BUILD_GIT_COMMIT && process.env.BUILD_GIT_COMMIT !== 'undefined') {
    return process.env.BUILD_GIT_COMMIT;
  }
  // For alpha builds, version suffix encodes the source commit
  const alphaCommit = getCommitFromAlphaVersion(packageJson.version);
  if (alphaCommit) {
    return alphaCommit;
  }
  // Fallback for development (running from source)
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Get full version string with git commit
 */
function getVersionString(): string {
  const commit = getGitCommit();
  return commit !== 'unknown' ? `${packageJson.version} (${commit})` : packageJson.version;
}

/**
 * About command - shows information about Autohand
 */
export async function about(ctx: { config?: LoadedConfig } = {}): Promise<string | null> {
  const theme = createCommandTheme();
  const greetingName = getUserGreetingName(ctx.config);

  const lines: string[] = [
    theme.muted(ASCII_FRIEND),
    '',
    theme.accent(`${t('commands.about.title')} v${getVersionString()}`),
    theme.muted(t('commands.about.subtitle')),
    '',
  ];

  if (greetingName) {
    lines.push(theme.text(`Hey ${greetingName}, here are a few suggestions for what you could do next:`));
    lines.push(theme.text(`   • Review model, context, and account usage: ${theme.accent('/usage')}`));
    lines.push(theme.text(`   • Check current session and runtime status: ${theme.accent('/status')}`));
    lines.push(theme.text(`   • Discover feature toggles available to you: ${theme.accent('/features')}`));
    lines.push('');
  }

  const websiteUrl = 'https://autohand.ai';
  const githubUrl = 'https://github.com/autohandai/';
  const docsUrl = 'https://docs.autohand.ai';

  const websiteLink = terminalLink(theme.link('autohand.ai'), websiteUrl);
  const githubLink = terminalLink(theme.link('github.com/autohandai/'), githubUrl);
  const docsLink = terminalLink(theme.link('docs.autohand.ai'), docsUrl);

  lines.push(`${theme.text('🌐')} ${theme.text(t('commands.about.website') + ':')}    ${websiteLink}`);
  lines.push(`${theme.text('📦')} ${theme.text(t('commands.about.github') + ':')}     ${githubLink}`);
  lines.push(`${theme.text('📚')} ${theme.text(t('commands.about.docs') + ':')}       ${docsLink}`);
  lines.push('');

  // Contribution section
  lines.push(theme.text(`💡 ${t('commands.about.contribute')}`));
  lines.push(theme.text(`   • ${t('commands.about.feedback')}:     ${theme.accent('/feedback')}`));
  lines.push(theme.text(`   • ${t('commands.about.submitPR')}:         ${theme.accent('gh pr create')}`));

  const issuesUrl = 'https://github.com/autohandai/code-cli/issues';
  const issuesLink = terminalLink(theme.link('github.com/autohandai/code-cli/issues'), issuesUrl);
  lines.push(theme.text(`   • ${t('commands.about.reportIssues')}:     ${issuesLink}`));

  return lines.join('\n');
}

export const metadata = {
  command: '/about',
  description: 'show information about Autohand',
  implemented: true
};
