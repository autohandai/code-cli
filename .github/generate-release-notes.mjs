#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const STABLE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;

function runGit(args, cwd = process.cwd()) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function toTag(version) {
  return version.startsWith('v') ? version : `v${version}`;
}

function parseStableTag(tag) {
  const match = tag.match(STABLE_TAG_PATTERN);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareStableVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function getPreviousStableTag(targetTag, cwd = process.cwd()) {
  const targetVersion = parseStableTag(targetTag);
  const tags = runGit(['tag', '--list', 'v[0-9]*.[0-9]*.[0-9]*'], cwd)
    .split('\n')
    .map(tag => tag.trim())
    .filter(Boolean)
    .map(tag => ({ tag, version: parseStableTag(tag) }))
    .filter(item => item.version && item.tag !== targetTag);

  const candidates = targetVersion
    ? tags.filter(item => compareStableVersions(item.version, targetVersion) < 0)
    : tags;

  candidates.sort((a, b) => compareStableVersions(b.version, a.version));
  return candidates[0]?.tag ?? null;
}

function getPreviousReleaseTag(targetTag, cwd = process.cwd()) {
  try {
    const previous = runGit(['describe', '--tags', '--abbrev=0', `--exclude=${targetTag}`], cwd);
    return previous || null;
  } catch {
    return null;
  }
}

export function getPreviousTag({ version, channel, cwd = process.cwd() }) {
  const targetTag = toTag(version);
  if (channel === 'release') {
    return getPreviousStableTag(targetTag, cwd) ?? getPreviousReleaseTag(targetTag, cwd);
  }
  return getPreviousReleaseTag(targetTag, cwd);
}

function readCommits({ previousTag, cwd = process.cwd() }) {
  const format = '%H%x1f%s%x1f%b%x1e';
  const args = previousTag
    ? ['log', `${previousTag}..HEAD`, `--pretty=format:${format}`]
    : ['log', '-n', '50', `--pretty=format:${format}`];

  const output = runGit(args, cwd);
  if (!output) return [];

  return output
    .split('\x1e')
    .map(record => record.trim())
    .filter(Boolean)
    .map(record => {
      const [hash, subject, body = ''] = record.split('\x1f');
      return { hash, subject: subject.trim(), body: body.trim() };
    })
    .filter(commit => commit.subject && !commit.subject.includes('chore(release):'));
}

function stripConventionalPrefix(subject) {
  return subject
    .replace(/^(feat|fix|chore|docs|refactor|test|ci|perf|build|deps|deps-dev)(\([^)]+\))?!?:\s*/i, '')
    .trim();
}

function humanize(subject) {
  const withoutPrefix = stripConventionalPrefix(subject)
    .replace(/\s+\(#\d+\)$/g, '')
    .trim();

  if (!withoutPrefix) return null;
  return withoutPrefix.charAt(0).toUpperCase() + withoutPrefix.slice(1);
}

function categorizeCommits(commits) {
  const sections = {
    breaking: [],
    features: [],
    fixes: [],
    improvements: [],
    updates: [],
  };

  for (const commit of commits) {
    const item = humanize(commit.subject);
    if (!item) continue;

    if (commit.subject.includes('!:') || commit.body.includes('BREAKING CHANGE')) {
      sections.breaking.push(item);
    } else if (/^feat(\(|:)/i.test(commit.subject)) {
      sections.features.push(item);
    } else if (/^fix(\(|:)/i.test(commit.subject)) {
      sections.fixes.push(item);
    } else if (/^(refactor|perf|chore|docs|test|ci|build|deps|deps-dev)(\(|:)/i.test(commit.subject)) {
      sections.improvements.push(item);
    } else {
      sections.updates.push(item);
    }
  }

  return sections;
}

function appendSection(lines, heading, items, intro) {
  if (items.length === 0) return;
  lines.push(`### ${heading}`, '');
  if (intro) {
    lines.push(intro, '');
  }
  for (const item of items) {
    lines.push(`- ${item}`);
  }
  lines.push('');
}

function appendInstallSection(lines, channel) {
  lines.push('---', '', '### Get it', '');

  if (channel === 'alpha') {
    lines.push(
      '**Install this alpha build:**',
      '```bash',
      'curl -fsSL https://autohand.ai/install.sh | sh -s -- --alpha',
      '```',
      '',
      '**Or install the latest stable release:**',
      '```bash',
      'curl -fsSL https://autohand.ai/install.sh | sh',
      '```',
      '',
    );
  } else {
    lines.push(
      '**Quickest way:**',
      '```bash',
      'curl -fsSL https://autohand.ai/install.sh | sh',
      '```',
      '',
      '**Via npm or bun:**',
      '```bash',
      'npm install -g autohand-cli',
      '```',
      '',
      '**Via Homebrew:**',
      '```bash',
      'brew install autohandai/code/autohand-code',
      '```',
      '',
    );
  }

  lines.push(
    '**Or grab a binary below** for your platform.',
    '',
    '| Platform | Architecture | Binary |',
    '|----------|--------------|--------|',
    '| macOS | Apple Silicon | `autohand-macos-arm64` |',
    '| macOS | Intel | `autohand-macos-x64` |',
    '| Linux | x64 | `autohand-linux-x64` |',
    '| Linux | ARM64 | `autohand-linux-arm64` |',
    '| Windows | x64 | `autohand-windows-x64.exe` |',
    '',
  );
}

export function generateReleaseNotes({
  version,
  channel,
  repo = 'autohandai/code-cli',
  cwd = process.cwd(),
}) {
  const targetTag = toTag(version);
  const previousTag = getPreviousTag({ version, channel, cwd });
  const commits = readCommits({ previousTag, cwd });
  const sections = categorizeCommits(commits);
  const lines = [];

  if (channel === 'alpha') {
    lines.push('> **Alpha Release** - This is a pre-release build from the latest `main` branch. It may contain bugs or incomplete features.', '');
  }

  if (previousTag) {
    lines.push(`Hey there! We've been busy making Autohand better. Here's what's new since ${previousTag}:`, '');
  } else {
    lines.push("Hey there! Here's what's new in this release:", '');
  }

  appendSection(lines, 'Heads up! Breaking Changes', sections.breaking, 'These changes might require updates to your setup:');
  appendSection(lines, 'New Stuff', sections.features);
  appendSection(lines, 'Bug Fixes', sections.fixes, sections.fixes.length === 1 ? 'We squashed a bug:' : `We squashed ${sections.fixes.length} bugs:`);
  appendSection(lines, 'Updates', sections.updates);
  appendSection(lines, 'Under the Hood', sections.improvements, 'Some housekeeping and improvements:');

  const totalItems = Object.values(sections).reduce((sum, items) => sum + items.length, 0);
  if (totalItems === 0) {
    lines.push('No code changes were found in this comparison range.', '');
  }

  if (repo && previousTag) {
    lines.push(`Full comparison: https://github.com/${repo}/compare/${previousTag}...${targetTag}`, '');
  }

  appendInstallSection(lines, channel);

  return {
    markdown: lines.join('\n'),
    previousTag,
    targetTag,
    commitCount: commits.length,
  };
}

function parseArgs(argv) {
  const args = {
    repo: 'autohandai/code-cli',
    output: 'release-notes.md',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--version' && next) {
      args.version = next;
      index += 1;
    } else if (arg === '--channel' && next) {
      args.channel = next;
      index += 1;
    } else if (arg === '--repo' && next) {
      args.repo = next;
      index += 1;
    } else if (arg === '--output' && next) {
      args.output = next;
      index += 1;
    }
  }

  if (!args.version) {
    throw new Error('Missing required --version argument');
  }
  if (!args.channel) {
    throw new Error('Missing required --channel argument');
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = generateReleaseNotes(args);
  writeFileSync(args.output, result.markdown, 'utf8');
  console.log(`Release notes written to ${args.output}`);
  console.log(`Target tag: ${result.targetTag}`);
  console.log(`Previous tag: ${result.previousTag ?? 'none'}`);
  console.log(`Commits included: ${result.commitCount}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
