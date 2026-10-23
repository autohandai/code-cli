import type { Session } from 'tuistory';

export async function runCheckpointFooterScenario(session: Session): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('Read package.json and summarize the verified repository facts.');
  await session.press('enter');
  return session.text({ timeout: 20_000, waitFor: text =>
    (text.includes('Work remains pending Moa review') || text.includes('CHECKPOINT_FOOTER_ANSWER'))
    && (text.includes('Failed in') || text.includes('Completed in')),
  });
}

export async function runGoalCompletionScenario(session: Session): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('Create a goal to deliver the changelog, queue the installer repair, and complete only the changelog goal with its final answer.');
  await session.press('enter');
  return session.text({ timeout: 25_000, waitFor: text =>
    (text.includes('Work remains pending Moa review') || text.includes('DELIVERED_CHANGELOG'))
    && (text.includes('Failed in') || text.includes('Completed in')),
  });
}
