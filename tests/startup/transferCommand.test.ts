import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerTransferCommand } from '../../src/startup/transferCommand.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const received = { transfer: { id, accountId: 'personal_ada', expiresAt: '2099-01-01T00:00:00.000Z' }, snapshot: {
  version: 1 as const, source: 'web' as const, sourceSessionId: 'web-chat', title: 'Parser work', createdAt: '2026-09-08T00:00:00.000Z',
  model: 'moa', provider: 'autohandai', repository: null, messages: [{ role: 'user' as const, content: 'Continue the parser', createdAt: '2026-09-08T00:00:00.000Z' }],
} };
function fixture(confirmed = true) {
  const program = new Command().exitOverride().option('--auto-mode <prompt>'); program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  const receive = vi.fn(async () => received), prepare = vi.fn(async () => ({ sessionId: `web-${id}`, workspace: '/isolated/parser' }));
  const confirm = vi.fn(async () => confirmed), run = vi.fn(), report = vi.fn();
  registerTransferCommand(program, { receive, prepare, confirm, run, report });
  return { receive, prepare, confirm, run, report, parse: (args: string[]) => program.parseAsync(['transfer', id, '--account', 'personal_ada', ...args], { from: 'user' }) };
}
describe('standalone Web transfer command', () => {
  it('reviews before importing and resumes the imported model without replaying an autonomous prompt', async () => {
    const test = fixture(); await test.parse(['--path', '/checkouts', '--auto-mode', 'must not execute']);
    expect(test.confirm).toHaveBeenCalledWith(received.snapshot);
    expect(test.prepare).toHaveBeenCalledWith(received, '/checkouts');
    expect(test.run).toHaveBeenCalledWith({ path: '/isolated/parser', resumeSessionId: `web-${id}`, model: 'moa', provider: 'autohandai', offline: false, config: undefined });
    expect(test.run.mock.invocationCallOrder[0]).toBeGreaterThan(test.prepare.mock.invocationCallOrder[0]);
  });
  it('cancels without creating a checkout or session', async () => {
    const test = fixture(false); await test.parse([]);
    expect(test.prepare).not.toHaveBeenCalled(); expect(test.run).not.toHaveBeenCalled();
  });
  it('supports explicit noninteractive import without launching inference', async () => {
    const test = fixture(false); await test.parse(['--accept', '--import-only']);
    expect(test.confirm).not.toHaveBeenCalled(); expect(test.prepare).toHaveBeenCalledOnce(); expect(test.run).not.toHaveBeenCalled();
    expect(test.report).toHaveBeenCalledWith(expect.stringContaining(`web-${id}`));
  });
  it('rejects malformed account selectors and preserves download errors before writes', async () => {
    const test = fixture(); await expect(test.parse(['--account', '../other'])).rejects.toThrow('Invalid transfer account');
    expect(test.receive).not.toHaveBeenCalled();
    test.receive.mockRejectedValueOnce(new Error('This transfer expired'));
    await expect(test.parse([])).rejects.toThrow('This transfer expired'); expect(test.prepare).not.toHaveBeenCalled();
  });
});
