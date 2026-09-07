import path from 'node:path';
import fs from 'fs-extra';
import type { Session as TerminalSession } from 'tuistory';
import { Session } from '../../session/SessionManager.js';
import type { SessionMetadata } from '../../session/types.js';

export async function seedResumeScenario(autohandHome: string, workspaceRoot: string, olderSessionCount = 0): Promise<void> {
  const sessions: SessionMetadata[] = [
    { sessionId: 'resume-active', createdAt: '2026-01-01', lastActiveAt: '2026-01-05', projectPath: workspaceRoot, summary: 'Active project session' },
    { sessionId: 'resume-newer', createdAt: '2026-01-03', lastActiveAt: '2026-01-03', projectPath: workspaceRoot, summary: 'Newer project session' },
    { sessionId: 'elsewhere-session', createdAt: '2026-01-04', lastActiveAt: '2026-01-06', projectPath: path.join(workspaceRoot, 'elsewhere'), summary: 'Other project session' },
    ...Array.from({ length: olderSessionCount }, (_, index) => ({
      sessionId: `older-page-${index}`, createdAt: '2025-12-31', lastActiveAt: '2025-12-31',
      projectPath: workspaceRoot, summary: `Older session ${index + 1}`,
    })),
  ].map((metadata) => ({
    ...metadata, projectName: path.basename(metadata.projectPath), model: 'openai/gpt-4o-mini',
    messageCount: 0, status: 'completed',
  }));
  const byProject: Record<string, string[]> = {};
  for (const metadata of sessions) {
    await fs.ensureDir(metadata.projectPath);
    const session = new Session(path.join(autohandHome, 'sessions', metadata.sessionId), metadata);
    await session.save();
    (byProject[metadata.projectPath] ??= []).push(metadata.sessionId);
  }
  await fs.writeJson(path.join(autohandHome, 'sessions', 'index.json'), {
    sessions: sessions.map((metadata) => ({ id: metadata.sessionId, projectPath: metadata.projectPath, createdAt: metadata.createdAt })),
    byProject,
  });
}

export async function chooseResumeSession(session: TerminalSession): Promise<string> {
  await session.waitForText('Choose a session');
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
    await session.waitForText('More sessions');
    await session.press('enter');
    await session.waitForText('Older session 19');
    if (visit === 0) {
      await session.press('down');
      await session.press('enter');
    }
  }
  await session.press('enter');
}
