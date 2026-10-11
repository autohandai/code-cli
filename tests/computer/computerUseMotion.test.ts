import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { McpClientManager } from '../../src/mcp/McpClientManager.js';
import type { McpServerConfig } from '../../src/mcp/types.js';

const resources: Array<{ manager: McpClientManager; root: string }> = [];

afterEach(async () => {
  for (const { manager, root } of resources.splice(0)) {
    await manager.disconnectAll();
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(mode: 'modern' | 'legacy' | 'none', env: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'autohand-cursor-motion-'));
  const manager = new McpClientManager();
  resources.push({ manager, root });
  const config: McpServerConfig = { name: 'autohand-computer-use', transport: 'stdio', stdioFraming: 'newline',
    command: process.execPath, args: [path.resolve('src/testing/scenarios/computer-use-driver.mjs')],
    env: { CUA_DRIVER_CURSOR_THEME_DIR: root, CUA_TEST_CURSOR_MOTION: mode, ...env },
  };
  await manager.connect(config);
  const call = (tool: string, args: Record<string, unknown> = {}, signal?: AbortSignal) =>
    manager.callTool('autohand-computer-use', tool, args, { signal });
  const reconnect = async () => {
    await manager.disconnect(config.name);
    await manager.connect(config);
  };
  return { call, reconnect };
}

describe('managed Computer Use movement budget', () => {
  it('uses the modern start-session field before the first input, once per connection', async () => {
    const { call } = await fixture('modern');
    await Promise.all([call('move_cursor'), call('move_cursor')]);
    const result = await call('get_cursor_fixture_state');
    expect(result).toMatchObject({ structuredContent: {
      theme: 'autohand.light-gray', motion: { glide_duration_ms: 50 }, starts: 1, motionCalls: 0,
      calls: [{ name: 'start_session' }, { name: 'move_cursor' }, { name: 'move_cursor' }, { name: 'get_cursor_fixture_state' }],
    } });
  });

  it('sets legacy motion before input and avoids an extra round trip on later calls', async () => {
    const { call } = await fixture('legacy');
    await call('move_cursor');
    await call('move_cursor');
    expect(await call('get_cursor_fixture_state')).toMatchObject({ structuredContent: {
      motion: { glide_duration_ms: 50 }, starts: 1, motionCalls: 1,
      calls: [{ name: 'start_session' }, { name: 'set_agent_cursor_motion' }, { name: 'move_cursor' },
        { name: 'move_cursor' }, { name: 'get_cursor_fixture_state' }],
    } });
  });

  it.each(['modern', 'legacy'] as const)('applies the budget to an explicit %s start', async mode => {
    const { call } = await fixture(mode);
    await call('start_session', { session: 'task-a' });
    expect(await call('move_cursor', { session: 'task-a' })).toMatchObject({ structuredContent: {
      motion: { glide_duration_ms: 50 }, starts: 1, motionCalls: mode === 'legacy' ? 1 : 0,
    } });
  });

  it('initializes named sessions independently and resets only the session that ended', async () => {
    const { call } = await fixture('legacy');
    await call('move_cursor', { session: 'task-a' });
    await call('move_cursor', { session: 'task-b' });
    await call('end_session', { session: 'task-a' });
    expect(await call('move_cursor', { session: 'task-b' })).toMatchObject({ structuredContent: {
      motion: { glide_duration_ms: 50 }, starts: 2, motionCalls: 2,
    } });
    expect(await call('move_cursor', { session: 'task-a' })).toMatchObject({ structuredContent: {
      motion: { glide_duration_ms: 50 }, starts: 3, motionCalls: 3,
    } });
  });

  it('preserves explicit modern motion and theme choices', async () => {
    const { call } = await fixture('modern', { AUTOHAND_COMPUTER_USE_GLIDE_MS: 'invalid' });
    await call('start_session', { cursor_motion: { glide_duration_ms: 700 },
      cursor_theme: { theme_id: 'custom.theme', reduced_motion: 'off' } });
    expect(await call('move_cursor')).toMatchObject({ structuredContent: {
      theme: 'custom.theme', motion: { glide_duration_ms: 700 }, starts: 1,
    } });
  });

  it('does not overwrite later per-session motion changes', async () => {
    const { call } = await fixture('legacy');
    await call('set_agent_cursor_motion', { glide_duration_ms: 400 });
    expect(await call('move_cursor')).toMatchObject({ structuredContent: {
      motion: { glide_duration_ms: 400 }, starts: 1, motionCalls: 2,
    } });
  });

  it('uses only advertised fields and tools on older servers', async () => {
    const { call } = await fixture('none');
    expect(await call('move_cursor')).toMatchObject({ structuredContent: {
      motion: null, starts: 1, motionCalls: 0,
    } });
  });

  it.each(['0', '150'])('honors a valid %s ms environment override', async value => {
    const { call } = await fixture('legacy', { AUTOHAND_COMPUTER_USE_GLIDE_MS: value });
    expect(await call('move_cursor')).toMatchObject({ structuredContent: {
      motion: { glide_duration_ms: Number(value) },
    } });
  });

  it.each(['-1', '5001', 'Infinity', 'oops', '1.5'])('refuses invalid override %s before input', async value => {
    const { call } = await fixture('legacy', { AUTOHAND_COMPUTER_USE_GLIDE_MS: value });
    await expect(call('move_cursor')).rejects.toThrow('AUTOHAND_COMPUTER_USE_GLIDE_MS');
  });

  it('does not cache a failed motion setup or send the pending input', async () => {
    const { call } = await fixture('legacy', { CUA_TEST_REJECT_MOTION: '1' });
    await expect(call('move_cursor')).rejects.toThrow('cursor motion');
    expect(await call('move_cursor')).toMatchObject({ structuredContent: {
      motion: { glide_duration_ms: 50 }, starts: 2, motionCalls: 2,
      calls: [{ name: 'start_session' }, { name: 'set_agent_cursor_motion' },
        { name: 'start_session' }, { name: 'set_agent_cursor_motion' }, { name: 'move_cursor' }],
    } });
  });

  it.each([0, 50])('cancels initialization after %s ms before motion or input is sent', async delay => {
    const { call } = await fixture('legacy', { CUA_TEST_START_DELAY_MS: '300' });
    const controller = new AbortController();
    const pending = call('move_cursor', {}, controller.signal);
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(await call('move_cursor')).toMatchObject({ structuredContent: {
      motion: { glide_duration_ms: 50 }, motionCalls: 1,
    } });
  });

  it('configures a fresh session after reconnecting the server', async () => {
    const { call, reconnect } = await fixture('legacy');
    const initial = await call('move_cursor');
    expect(initial).toMatchObject({ structuredContent: { starts: 1, motionCalls: 1 } });
    await reconnect();
    expect(await call('move_cursor')).toMatchObject({ structuredContent: {
      motion: { glide_duration_ms: 50 }, starts: 1, motionCalls: 1,
    } });
  });

  it('settles a cancelled waiter promptly without cancelling another caller', async () => {
    const { call } = await fixture('modern', { CUA_TEST_START_DELAY_MS: '400' });
    const first = call('move_cursor');
    const controller = new AbortController();
    const second = call('move_cursor', {}, controller.signal);
    const started = performance.now();
    controller.abort();
    await expect(second).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(250);
    await expect(first).resolves.toMatchObject({ structuredContent: { starts: 1, motion: { glide_duration_ms: 50 } } });
  });
});
