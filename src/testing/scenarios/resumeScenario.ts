import path from 'node:path';
import fs from 'fs-extra';
import type { Session as TerminalSession } from 'tuistory';
import { Session } from '../../session/SessionManager.js';
import type { SessionMessage, SessionMetadata } from '../../session/types.js';

interface FixtureMessage { role: 'user' | 'assistant'; content: string; }

interface FixtureSession {
  sessionId: string;
  createdAt: string;
  lastActiveAt: string;
  projectPath: string;
  summary: string;
  /** Empty on purpose for `resume-active` so the picker's empty-session reveal row has something to reveal. */
  messages: FixtureMessage[];
}

const RESUME_NEWER_MESSAGES: FixtureMessage[] = [
  { role: 'user', content: 'Investigate why the terminal caret disappears after a resize.' },
  { role: 'assistant', content: 'Found it - the caret redraw was skipped when Ink invalidated the cursor after a resize event.' },
  { role: 'user', content: 'Add a regression test before landing the fix.' },
  { role: 'assistant', content: 'Added a vitest case that resizes the mock terminal and asserts the caret survives; fix is in, tests are green.' },
];

const ELSEWHERE_SESSION_MESSAGES: FixtureMessage[] = [
  { role: 'user', content: "Set up the elsewhere project's linting config to match the main repo." },
  { role: 'assistant', content: 'Copied the eslint and prettier configs over and adjusted the tsconfig paths; everything lints clean.' },
  { role: 'user', content: 'Wire up a CI workflow too.' },
  { role: 'assistant', content: 'Added a GitHub Actions workflow that runs lint, typecheck, and the test suite on every push.' },
  { role: 'user', content: 'Looks good, ship it.' },
  { role: 'assistant', content: 'Pushed the workflow file and confirmed the first run passes.' },
];

function olderSessionMessages(index: number): FixtureMessage[] {
  const issue = index + 1;
  return [
    { role: 'user', content: `Investigate issue #${issue} in the backlog.` },
    { role: 'assistant', content: `Looked into issue #${issue}; it was a stale cache entry, cleared and verified.` },
  ];
}

export async function seedResumeScenario(autohandHome: string, workspaceRoot: string, olderSessionCount = 0): Promise<void> {
  const fixtures: FixtureSession[] = [
    {
      sessionId: 'resume-active', createdAt: '2026-01-01', lastActiveAt: '2026-01-05',
      projectPath: workspaceRoot, summary: 'Active project session', messages: [],
    },
    {
      sessionId: 'resume-newer', createdAt: '2026-01-03', lastActiveAt: '2026-01-03',
      projectPath: workspaceRoot, summary: 'Newer project session', messages: RESUME_NEWER_MESSAGES,
    },
    {
      sessionId: 'elsewhere-session', createdAt: '2026-01-04', lastActiveAt: '2026-01-06',
      projectPath: path.join(workspaceRoot, 'elsewhere'), summary: 'Other project session', messages: ELSEWHERE_SESSION_MESSAGES,
    },
    ...Array.from({ length: olderSessionCount }, (_, index) => ({
      sessionId: `older-page-${index}`, createdAt: '2025-12-31', lastActiveAt: '2025-12-31',
      projectPath: workspaceRoot, summary: `Older session ${index + 1}`, messages: olderSessionMessages(index),
    })),
  ];

  const byProject: Record<string, string[]> = {};
  const indexSessions: Array<{ id: string; projectPath: string; createdAt: string }> = [];

  for (const { messages, ...fixture } of fixtures) {
    const metadata: SessionMetadata = {
      ...fixture, projectName: path.basename(fixture.projectPath), model: 'openai/gpt-4o-mini',
      messageCount: messages.length, status: 'completed',
    };
    await fs.ensureDir(metadata.projectPath);
    const session = new Session(path.join(autohandHome, 'sessions', metadata.sessionId), metadata);

    let timestamp = Date.parse(metadata.createdAt);
    for (const message of messages) {
      const sessionMessage: SessionMessage = { role: message.role, content: message.content, timestamp: new Date(timestamp).toISOString() };
      await session.appendTransient(sessionMessage);
      timestamp += 60_000;
    }
    await session.save();

    (byProject[metadata.projectPath] ??= []).push(metadata.sessionId);
    indexSessions.push({ id: metadata.sessionId, projectPath: metadata.projectPath, createdAt: metadata.createdAt });
  }

  await fs.writeJson(path.join(autohandHome, 'sessions', 'index.json'), { sessions: indexSessions, byProject });
}

export async function chooseResumeSession(session: TerminalSession): Promise<string> {
  await session.waitForText('Resume a session');
  await session.press('down');
  await session.press('up');
  const screen = await session.text({ immediate: true });
  await session.press('enter');
  return screen;
}

export async function chooseOlderResumeSession(session: TerminalSession): Promise<void> {
  for (let visit = 0; visit < 2; visit += 1) {
    await session.waitForText('Newer project session');
    for (let index = 0; index < 20; index += 1) await session.press('down');
    await session.waitForText('Older sessions');
    await session.press('enter');
    await session.waitForText('Older session 19');
    if (visit === 0) {
      await session.press('down');
      await session.press('enter');
    }
  }
  await session.press('enter');
}
