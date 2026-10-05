/** @license Apache-2.0 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Session } from 'tuistory';

export async function seedUsageReport(home: string, project: string): Promise<void> {
  const now = new Date().toISOString();
  const metadata = {
    sessionId: 'usage-fixture', title: 'Dashboard fixture', createdAt: now, lastActiveAt: now,
    projectPath: project, projectName: 'workspace', model: 'moa', messageCount: 42, status: 'completed',
    usage: { totalTokens: 120000, promptTokens: 100000, completionTokens: 20000, turnCount: 3, tokenUsageStatus: 'actual', updatedAt: now, longestTurnDurationMs: 12000 },
  };
  await mkdir(path.join(home, 'sessions', metadata.sessionId), { recursive: true });
  await writeFile(path.join(home, 'sessions', metadata.sessionId, 'metadata.json'), JSON.stringify(metadata));
  await writeFile(path.join(home, 'sessions', 'index.json'), JSON.stringify({
    sessions: [{ id: metadata.sessionId, projectPath: project, createdAt: now, title: metadata.title }], byProject: { [project]: [metadata.sessionId] },
  }));
  await mkdir(path.join(project, '.autohand', 'memory', 'events'), { recursive: true });
  await writeFile(path.join(project, '.autohand', 'memory', 'events', 'LOG.jsonl'), JSON.stringify({
    version: 1, operation: 'capability_used', level: 'project', eventId: 'fixture-skill', occurredAt: now,
    capability: { kind: 'skill', name: 'release-review', source: 'extension' }, origin: 'user', outcome: 'succeeded',
  }) + '\n');
}

export function usageViewport(session: Session): string {
  const screen = session.getTerminalData();
  return screen.lines.slice(-screen.rows).map(line => line.spans.map(span => span.text).join('').trimEnd()).join('\n');
}

export async function openUsageReport(session: Session): Promise<void> {
  await session.waitForText('❯');
  await session.type('/usage');
  await session.waitForText('❯ /usage');
  await session.press('enter');
  await session.waitForText('Activity overview', { timeout: 20_000 });
}
