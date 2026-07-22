/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { launchTerminal } from 'tuistory';
import { TuistoryVideoRecorder, type TuistoryVideoOutput } from '../drivers/tuistoryVideoRecorder.js';
import {
  DEMO_EXTENSION_FILES,
  DEMO_EXTENSION_ID,
  DEMO_EXTENSION_PROMPT,
  DEMO_EXTENSION_RELATIVE_ROOT,
  createExtensionBuilderDemoResponses,
} from './extensionBuilderAuthoringDemo.js';

const PUBLIC_SKILL_SOURCE = 'https://github.com/autohandai/community-skills';

export interface RecordExtensionBuilderDemoOptions extends TuistoryVideoOutput {
  repoRoot: string;
  installPublicSkill?: boolean;
  keepWorkspace?: boolean;
  tempRoot?: string;
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function startDemoModelServer(responses: string[]): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  let responseIndex = 0;
  const server = createServer((request, response) => {
    if (request.url === '/chat/completions' && request.method === 'POST') {
      request.resume();
      const content = responses[Math.min(responseIndex, responses.length - 1)] ?? '';
      responseIndex += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: `chatcmpl-extension-demo-${responseIndex}`,
        created: Math.floor(Date.now() / 1000),
        choices: [{
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 80,
          total_tokens: 200,
        },
      }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('The extension-builder demo model server did not bind to a TCP port.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function typeCommand(
  recorder: TuistoryVideoRecorder,
  command: string,
  expected: string | RegExp,
  timeout: number,
): Promise<void> {
  await recorder.type(command);
  await recorder.press('enter');
  await recorder.waitForText(expected, timeout);
  await recorder.hold(700);
}

export async function recordExtensionBuilderDemo(
  options: RecordExtensionBuilderDemoOptions,
): Promise<TuistoryVideoOutput> {
  const tempRoot = options.tempRoot ?? path.join(os.tmpdir(), 'autohand-extension-builder-demo');
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const autohandHome = path.join(tempRoot, 'home');
  const binRoot = path.join(tempRoot, 'bin');
  const configPath = path.join(autohandHome, 'config.json');
  const builtCliPath = path.join(options.repoRoot, 'dist', 'index.js');

  if (!await fs.pathExists(builtCliPath)) {
    throw new Error('Built CLI not found. Run `bun run build` before recording the demo.');
  }

  await fs.remove(tempRoot);
  await Promise.all([
    fs.ensureDir(workspaceRoot),
    fs.ensureDir(autohandHome),
    fs.ensureDir(binRoot),
  ]);
  await fs.writeJson(path.join(workspaceRoot, 'package.json'), {
    name: 'workspace-brief-demo',
    version: '1.0.0',
  }, { spaces: 2 });
  await runCommand('git', ['init'], workspaceRoot);

  const modelServer = await startDemoModelServer(createExtensionBuilderDemoResponses());
  await fs.writeJson(configPath, {
    provider: 'openrouter',
    openrouter: {
      apiKey: 'recording-demo-key',
      model: 'openai/gpt-4o-mini',
      baseUrl: modelServer.baseUrl,
    },
    auth: {
      token: 'recording-demo-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      user: {
        id: 'recording-demo-user',
        email: 'demo@autohand.ai',
        name: 'Extension Builder Demo',
      },
    },
    sync: { enabled: false },
    ui: { checkForUpdates: false, promptSuggestions: false },
    agent: { maxIterations: 3 },
  }, { spaces: 2 });

  const wrapperPath = path.join(binRoot, 'autohand');
  await fs.writeFile(wrapperPath, [
    '#!/bin/sh',
    `exec ${shellQuote(process.execPath)} ${shellQuote(builtCliPath)} "$@"`,
    '',
  ].join('\n'));
  await fs.chmod(wrapperPath, 0o755);

  const session = await launchTerminal({
    command: '/bin/zsh',
    args: ['-f'],
    cwd: workspaceRoot,
    cols: 120,
    rows: 36,
    showCursor: true,
    env: {
      ...process.env,
      AUTOHAND_HOME: autohandHome,
      AUTOHAND_NO_BANNER: '1',
      AUTOHAND_SKIP_PING: '1',
      AUTOHAND_SKIP_UPDATE_CHECK: '1',
      CI: 'false',
      CODEX_CI: undefined,
      CODEX_SANDBOX: undefined,
      CODEX_THREAD_ID: undefined,
      FORCE_COLOR: '3',
      NO_COLOR: undefined,
      PATH: `${binRoot}:${process.env.PATH ?? ''}`,
      PROMPT: 'demo $ ',
      PS1: 'demo $ ',
    },
  });
  const recorder = new TuistoryVideoRecorder(session, options);

  try {
    await recorder.waitForText('demo $', 10_000);
    await recorder.hold(900);

    if (options.installPublicSkill ?? true) {
      await typeCommand(
        recorder,
        `npx skills add ${PUBLIC_SKILL_SOURCE} --skill extension-builder -a autohand-code -y`,
        /Installed 1 skill|Done!/,
        120_000,
      );
    } else {
      await typeCommand(
        recorder,
        "printf '%s\\n' 'Using bundled extension-builder for the offline test run'",
        'Using bundled extension-builder for the offline test run',
        10_000,
      );
    }

    await recorder.type('autohand --path . --y');
    await recorder.press('enter');
    await recorder.waitForText('❯', 20_000);
    await recorder.hold(1_000);

    await recorder.type(DEMO_EXTENSION_PROMPT);
    await recorder.press('enter');
    await recorder.waitForText(`Created ${DEMO_EXTENSION_ID} with 2 tools and 1 skill.`, 45_000);
    await recorder.hold(1_500);
    await recorder.type('/quit');
    await recorder.press('enter');
    await recorder.waitForText('demo $', 10_000);

    await typeCommand(
      recorder,
      `autohand --path . extensions validate ./${DEMO_EXTENSION_RELATIVE_ROOT}`,
      `Valid extension ${DEMO_EXTENSION_ID}@1.0.0`,
      20_000,
    );
    await typeCommand(
      recorder,
      `autohand --path . extensions install ./${DEMO_EXTENSION_RELATIVE_ROOT} --scope project`,
      `Installed ${DEMO_EXTENSION_ID}@1.0.0`,
      20_000,
    );
    await typeCommand(
      recorder,
      `autohand --path . extensions show ${DEMO_EXTENSION_ID} --scope project`,
      'Skills: workspace-brief',
      20_000,
    );
    await recorder.hold(2_000);
    await recorder.type('exit');
    await recorder.press('enter');
    await session.waitForExit(10_000);

    for (const [relativePath, expected] of Object.entries(DEMO_EXTENSION_FILES)) {
      const actual = await fs.readFile(path.join(workspaceRoot, DEMO_EXTENSION_RELATIVE_ROOT, relativePath), 'utf8');
      if (actual !== expected) {
        throw new Error(`Recorded demo generated unexpected content for ${relativePath}.`);
      }
    }

    return await recorder.finish();
  } finally {
    session.close();
    await modelServer.close();
    if (!options.keepWorkspace) {
      await fs.remove(tempRoot);
    }
  }
}
