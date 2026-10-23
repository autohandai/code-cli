import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import type { Session } from 'tuistory';
import { cancelStalledSessionCompaction, createBackgroundProcessAudit, createSessionLifecycleServer, submitSessionCommand } from '../../src/testing/scenarios/sessionLifecycleScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand, waitForExit, type TuistoryTempState } from './helpers/autohandTuistory.js';

let session: Session | undefined;
let state: TuistoryTempState | undefined;
let server: Awaited<ReturnType<typeof createSessionLifecycleServer>> | undefined;
afterEach(async () => {
  if (session && !session.exitInfo) { await session.close(); await waitForExit(session); }
  await server?.close();
  await state?.cleanup();
});

describe('foreground CLI session lifecycle', () => {
  it('advertises --no-daemon in real command help', async () => {
    session = await launchBuiltAutohand(['--help']);
    await waitForExit(session);
    expect(session.readAll()).toContain('--no-daemon');
  });
  it('compacts through Weka, immediately accepts another turn, then starts an empty new session', async () => {
    server = await createSessionLifecycleServer();
    state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture-key', model: 'moa', baseUrl: server.baseUrl },
      agent: { autoMemory: false, maxIterations: 3 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      features: { automaticSpecialists: false, autohand_inference: true },
      network: { maxRetries: 0 },
      traces: { enabled: true, cloudSync: true, consentVersion: 1 },
      mcp: { enabled: true, servers: [{ name: 'forbidden-helper', transport: 'stdio', command: 'forbidden-background-helper' }] },
    } });
    const audit = await createBackgroundProcessAudit(state.workspaceRoot);
    session = await launchBuiltAutohand(['--no-daemon', '--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      env: { NODE_OPTIONS: `--import=${audit.preload}`, AUTOHAND_AHTRACES_EXECUTABLE: 'forbidden-traces-helper' },
    });
    await submitSessionCommand(session, 'ORIGINAL_REQUEST_FIX_RETRY', 'FINAL_ANSWER_ONE');
    const sessionsDir = path.join(state.autohandHome, 'sessions');
    const before = (await fs.readdir(sessionsDir)).filter(name => !name.endsWith('.json'));
    await submitSessionCommand(session, '/clear', 'Context compacted');
    expect(server.decisions).toHaveLength(1);
    expect(await fs.readdir(sessionsDir)).toEqual(expect.arrayContaining(before));
    await submitSessionCommand(session, 'Continue from the retained handoff.', 'HANDOFF_RECEIVED_TWO');
    const continued = JSON.stringify(server.chats[1]?.messages);
    expect(continued).toContain('[Session Handoff]');
    expect(continued).toContain('ORIGINAL_REQUEST_FIX_RETRY');
    expect(continued).toContain('LEARNT_CANCEL_BEFORE_RETRY');
    const transcript = await fs.readFile(path.join(sessionsDir, before[0]!, 'conversation.jsonl'), 'utf8');
    expect(transcript).toContain('"contextCompaction":true');
    await submitSessionCommand(session, '/new', 'New session started');
    await submitSessionCommand(session, 'Say ready in this new session.', 'FRESH_SESSION_THREE');
    const fresh = JSON.stringify(server.chats[2]?.messages);
    expect(fresh).not.toContain('[Session Handoff]');
    expect(fresh).not.toContain('ORIGINAL_REQUEST_FIX_RETRY');
    expect(fresh).not.toContain('FINAL_ANSWER_ONE');
    expect(server.decisions).toHaveLength(1);
    const after = (await fs.readdir(sessionsDir)).filter(name => !name.endsWith('.json'));
    expect(after).toHaveLength(before.length + 1);
    const records = (await fs.readFile(audit.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { event: string; command?: string; detached?: boolean; pid?: number; args?: string[] });
    expect(records.some(record => record.command?.includes('forbidden-'))).toBe(false);
    expect(records.some(record => record.detached)).toBe(false);
    await vi.waitFor(async () => {
      const events = (await fs.readFile(audit.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { event: string; pid?: number });
      const active = new Set<number>();
      for (const event of events) {
        if (!event.pid) continue;
        if (event.event === 'start') active.add(event.pid);
        else active.delete(event.pid);
      }
      expect([...active]).toEqual([]);
    });
    await exitInteractive(session);
  });

  it('cancels a stalled Weka request with Escape and keeps the previous conversation usable', async () => {
    server = await createSessionLifecycleServer({ stallDecisions: true });
    state = await createTempAutohandHome({ config: {
      provider: 'autohandai', autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture', model: 'moa', baseUrl: server.baseUrl },
      features: { autohand_inference: true, automaticSpecialists: false },
      agent: { autoMemory: false }, ui: { promptSuggestions: false },
    } });
    session = await launchBuiltAutohand(['--no-daemon', '--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
    });
    await submitSessionCommand(session, 'ORIGINAL_REQUEST_FIX_RETRY', 'FINAL_ANSWER_ONE');
    await cancelStalledSessionCompaction(session, () => vi.waitFor(() => expect(server?.decisions).toHaveLength(1)));
    await submitSessionCommand(session, 'Continue after cancellation.', 'HANDOFF_RECEIVED_TWO');
    expect(JSON.stringify(server.chats[1]?.messages)).toContain('ORIGINAL_REQUEST_FIX_RETRY');
    expect(JSON.stringify(server.chats[1]?.messages)).not.toContain('[Session Handoff]');
    await exitInteractive(session);
  });
});
