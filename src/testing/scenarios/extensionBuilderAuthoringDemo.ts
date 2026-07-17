/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

export const DEMO_EXTENSION_ID = 'autohand.workspace-brief';
export const DEMO_EXTENSION_RELATIVE_ROOT = DEMO_EXTENSION_ID;
export const DEMO_EXTENSION_PROMPT = [
  '$extension-builder create a project extension named autohand.workspace-brief.',
  'Add safe tools for git status and recent commits plus a workspace-brief skill.',
  'Write the complete package so I can validate and install it.',
].join(' ');

export const DEMO_EXTENSION_FILES = {
  'autohand.extension.json': `${JSON.stringify({
    $schema: 'https://raw.githubusercontent.com/autohandai/code-extensions/main/schema/autohand.extension.schema.json',
    schemaVersion: 1,
    extensionApi: 1,
    id: DEMO_EXTENSION_ID,
    name: 'Workspace Brief',
    version: '1.0.0',
    description: 'Gather a concise workspace snapshot and guide evidence-based project briefings.',
    license: 'Apache-2.0',
    repository: 'https://github.com/autohandai/code-cli',
    contributes: {
      tools: ['tools/workspace-status.json', 'tools/recent-commits.json'],
      skills: ['skills/workspace-brief/SKILL.md'],
    },
  }, null, 2)}\n`,
  'README.md': [
    '# Workspace Brief',
    '',
    'Creates an evidence-backed project briefing from the current Git status and recent commits.',
    '',
    '```sh',
    'autohand extensions validate ./examples/extensions/autohand.workspace-brief',
    'autohand extensions install ./examples/extensions/autohand.workspace-brief',
    '```',
    '',
    'Invoke `$workspace-brief` in a new Autohand prompt. Both tools run through the normal shell permission flow.',
    '',
    '```sh',
    'autohand extensions remove autohand.workspace-brief --yes',
    '```',
    '',
  ].join('\n'),
  'tools/workspace-status.json': `${JSON.stringify({
    name: 'brief_workspace_status',
    description: 'Show the current Git workspace status for a project briefing',
    parameters: { type: 'object', properties: {} },
    handler: 'git status --short',
    source: 'user',
  }, null, 2)}\n`,
  'tools/recent-commits.json': `${JSON.stringify({
    name: 'brief_recent_commits',
    description: 'Show a bounded number of recent commits for a project briefing',
    parameters: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Maximum number of recent commits',
        },
      },
      required: ['count'],
    },
    handler: 'git log --max-count={{count}} --oneline',
    source: 'user',
  }, null, 2)}\n`,
  'skills/workspace-brief/SKILL.md': [
    '---',
    'name: workspace-brief',
    'description: Build a concise, evidence-backed briefing from workspace status and recent commits.',
    '---',
    '',
    '# Prepare a workspace brief',
    '',
    'Use `brief_workspace_status` and `brief_recent_commits` before writing the brief.',
    'Summarize active changes, recent direction, immediate risks, and the next concrete action.',
    'Distinguish observed repository evidence from inference and do not claim the workspace is clean without checking.',
    '',
  ].join('\n'),
} as const;

export function createExtensionBuilderDemoResponses(): string[] {
  const toolCalls = Object.entries(DEMO_EXTENSION_FILES).map(([file, contents]) => ({
    tool: 'write_file',
    args: {
      path: `${DEMO_EXTENSION_RELATIVE_ROOT}/${file}`,
      contents,
    },
  }));

  return [
    JSON.stringify({
      thought: 'Use the requested extension-builder contract and write the complete declarative package.',
      toolCalls,
    }),
    JSON.stringify({
      reflection: 'The manifest, tools, skill, and README were written successfully.',
      toolCalls: [],
      finalResponse: [
        `Created ${DEMO_EXTENSION_ID} with 2 tools and 1 skill.`,
        `Package: ./${DEMO_EXTENSION_RELATIVE_ROOT}`,
        'Next: validate and install it with the extensions CLI.',
      ].join('\n'),
    }),
  ];
}

export async function driveExtensionBuilderAuthoring(session: Session): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type(DEMO_EXTENSION_PROMPT);
  await session.press('enter');
  await session.waitForText(`Created ${DEMO_EXTENSION_ID} with 2 tools and 1 skill.`, {
    timeout: 45_000,
  });
  return session.readAll();
}
