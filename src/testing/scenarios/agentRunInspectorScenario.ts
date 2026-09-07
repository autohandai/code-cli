/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

export async function openAgentRunInspector(session: Session): Promise<void> {
  await session.type('/agents view');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('/agents view') });
  await session.press('enter');
  await session.text({ timeout: 15_000, waitFor: (text) => text.includes('Session agents') && text.includes('Enter details') });
}

export async function inspectFixtureAgentProgress(
  session: Session,
  releaseModel: () => void,
  releaseCommand: () => Promise<void>,
): Promise<{ before: string; after: string }> {
  const before = await session.text({ timeout: 10_000, waitFor: (text) => text.includes('esc to cancel') });
  await openAgentRunInspector(session);
  await session.text({
    timeout: 10_000,
    waitFor: (text) => text.includes('inspector-fast · completed')
      && text.includes('inspector-error · failed')
      && text.includes('inspector-slow · running')
      && text.includes('Waiting for model'),
  });
  releaseModel();
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('Running command') });
  await releaseCommand();
  await session.text({
    timeout: 10_000,
    waitFor: (text) => text.includes('Waiting for model') && !text.includes('Running command'),
  });
  await session.press('escape');
  const after = await session.text({ timeout: 10_000, waitFor: (text) => text.includes('esc to cancel') });
  return { before, after };
}

export async function inspectAndCancelFixtureAgent(session: Session): Promise<string> {
  await openAgentRunInspector(session);
  session.writeRaw('\u001b[200~HIDDEN_INSPECTOR_PASTE\u001b[201~');
  await session.press('enter');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('inspector-fast · completed') });
  const frames: string[] = [];
  for (let scroll = 0; scroll < 30; scroll += 1) {
    const frame = await session.text();
    frames.push(frame);
    if (frame.includes('FAST_AGENT_PROOF') && frames.some(text => text.includes('108 tokens'))) break;
    await session.press('down');
  }
  const completedDetail = frames.join('\n');
  if (!completedDetail.includes('FAST_AGENT_PROOF') || !completedDetail.includes('108 tokens')) {
    throw new Error(`Completed agent result or usage missing from inspector:\n${completedDetail}`);
  }
  await session.press('escape');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Enter details') });
  await session.press('down');
  await session.press('c');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Cancel inspector-slow?') });
  await session.press('y');
  await session.text({ timeout: 15_000, waitFor: (text) => text.includes('inspector-slow · cancelled') });
  const cancelledDetail = await session.text({ immediate: true });
  if (cancelledDetail.includes('waiting for agent to stop')) {
    throw new Error('Cancelled agent still reports an outstanding stop request.');
  }
  await session.press('escape');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Enter details') });
  await session.press('down');
  await session.press('enter');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('inspector-error · failed') && text.includes('Error:') });
  return completedDetail;
}

export async function messageAndCancelFixtureAgents(
  session: Session,
  message: string,
  releaseWorkers: () => void,
): Promise<{ receipt: string; reply: string }> {
  await openAgentRunInspector(session);
  await session.text({
    timeout: 10_000,
    waitFor: (text) => text.includes('interaction-reader · running') && text.includes('interaction-writer · running'),
  });
  await session.press('down');
  await session.press('m');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('Message interaction-writer') });
  await session.type(message);
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes(message) });
  await session.press('enter');
  const receipt = await session.text({
    timeout: 10_000,
    waitFor: (text) => text.includes('Message queued for next model request.'),
  });
  releaseWorkers();
  await session.text({ timeout: 15_000, waitFor: (text) => text.includes('interaction-writer · completed') });
  await session.press('enter');
  const frames: string[] = [];
  for (let scroll = 0; scroll < 40; scroll += 1) {
    const frame = await session.text();
    frames.push(frame);
    if (frame.includes('WRITER_REPLY_ACKNOWLEDGED')) break;
    await session.press('down');
  }
  const reply = frames.join('\n');
  if (!reply.includes('WRITER_REPLY_ACKNOWLEDGED')) {
    throw new Error(`The selected worker reply was not visible:\n${reply}`);
  }
  await session.press('escape');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Enter details') });
  await session.press('up');
  await session.press('c');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Cancel interaction-reader?') });
  await session.press('y');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('interaction-reader · cancelled') });
  await session.press('escape');
  await session.press('escape');
  await session.text({ timeout: 15_000, waitFor: (text) => text.includes('INTERACTION_TURN_COMPLETE') && text.includes('❯') });
  return { receipt, reply };
}

export async function inspectReadOnlyExternalAgent(session: Session): Promise<{ list: string; detail: string }> {
  await session.type('/squad view');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('/squad view') });
  await session.press('enter');
  const list = await session.text({
    timeout: 10_000,
    waitFor: (text) => text.includes('Squad runs · external') && text.includes('external-readonly · completed'),
  });
  await session.press('m');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('External Squad runs cannot receive messages here.') });
  await session.press('c');
  await session.press('enter');
  const detail = await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Squad external (independent budget)') });
  return { list, detail };
}
