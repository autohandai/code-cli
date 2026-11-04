import { describe, expect, it } from 'vitest';
import { createMockOpenRouterSequenceServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand, waitForExit } from './helpers/autohandTuistory.js';

describe('continuation and command output release regressions', () => {
  it('remembers BANANA-42 across an empty interactive launch and -c', async () => {
    const server = await createMockOpenRouterSequenceServer([JSON.stringify({ finalResponse: 'BANANA-42' })]);
    const state = await createTempAutohandHome({ config: { openrouter: { baseUrl: server.baseUrl },
      features: { automaticSpecialists: false }, agent: { autoMemory: false, maxIterations: 3, sessionRetryLimit: 0 }, ui: { promptSuggestions: false } } });
    try {
      const first = await launchBuiltAutohand(['--config', state.configPath, '--yes', '-p', 'Reply with exactly: BANANA-42'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
      try { await waitForExit(first, 30000); expect(first.getRawOutput()).toContain('BANANA-42'); expect(first.exitInfo?.exitCode).toBe(0); } finally { first.close(); }
      const empty = await launchBuiltAutohand(['--config', state.configPath, '--offline'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
      try { await empty.waitForText('❯'); await exitInteractive(empty); } finally { empty.close(); }
      const continued = await launchBuiltAutohand(['--config', state.configPath, '--yes', '-c', '-p', 'What did I ask you to reply with?'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
      try { await waitForExit(continued, 30000); expect(continued.getRawOutput()).toContain('BANANA-42'); expect(continued.exitInfo?.exitCode).toBe(0); } finally { continued.close(); }
      expect(JSON.stringify(server.requests.at(-1))).toContain('Reply with exactly: BANANA-42');
    } finally { await server.close(); await state.cleanup(); }
  }, 90000);

  it('shows a visible final answer after seq 1 400000 with a bounded provider observation', async () => {
    const server = await createMockOpenRouterSequenceServer([
      JSON.stringify({ toolCalls: [{ tool: 'run_command', args: { command: 'seq 1 400000' } }] }),
      JSON.stringify({ finalResponse: '400000' }),
    ]);
    const state = await createTempAutohandHome({ config: { openrouter: { baseUrl: server.baseUrl },
      features: { automaticSpecialists: false }, agent: { autoMemory: false, maxIterations: 3, sessionRetryLimit: 0 }, ui: { promptSuggestions: false } } });
    try {
      const session = await launchBuiltAutohand(['--config', state.configPath, '--yes', '-p', 'Run seq 1 400000 once and reply with the last number.'],
        { autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { AUTOHAND_STREAM_TOOL_OUTPUT: '1' } });
      try {
        await waitForExit(session, 30000);
        expect(session.getRawOutput()).toContain('400000'); expect(session.exitInfo?.exitCode).toBe(0);
        const request = server.requests.at(-1)!;
        const messages = request.messages as Array<{ role: string; content: string }>;
        const observations = messages.filter(message => message.role === 'tool');
        expect(observations).toHaveLength(1);
        expect(observations[0].content.length).toBeLessThanOrEqual(30000);
        expect(observations[0].content).toContain('400000'); expect(observations[0].content).toContain('Full command output saved to');
      } finally { session.close(); }
    } finally { await server.close(); await state.cleanup(); }
  }, 60000);
});
