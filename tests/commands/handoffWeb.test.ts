import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../../src/session/SessionManager.js';
import { handoffWeb } from '../../src/commands/handoff-web.js';
import { TransferRequestError, TransferUnsupportedError } from '../../src/session/transfer/transfer-client.js';
import type { TransferReceipt } from '../../src/session/transfer/session-transfer.js';

const receipt: TransferReceipt = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', accountId: 'team_customer', expiresAt: '2026-09-11T00:00:00.000Z' };
let directory: string;
let sessionManager: SessionManager;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'handoff-web-test-'));
  sessionManager = new SessionManager(directory);
  await sessionManager.initialize();
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

async function context() {
  const currentSession = await sessionManager.createSession(directory, 'fantail');
  await currentSession.append({ role: 'user', content: 'Continue my parser', timestamp: '2026-09-10T00:00:00.000Z' });
  await currentSession.append({ role: 'assistant', content: JSON.stringify({ thought: 'private reasoning', finalResponse: 'Parser is ready.' }), timestamp: '2026-09-10T00:00:01.000Z' });
  await currentSession.append({ role: 'tool', content: 'credential-bearing tool result', timestamp: '2026-09-10T00:00:02.000Z' });
  const upload = vi.fn().mockResolvedValue(receipt), openBrowser = vi.fn().mockResolvedValue(undefined), captureRepository = vi.fn().mockResolvedValue(null);
  return { currentSession, sessionManager, workspaceRoot: directory, model: 'fantail', provider: 'autohandai' as const,
    config: { configPath: path.join(directory, 'config.json'), auth: { token: 'private-test-token', user: { id: 'customer', name: 'Customer', email: 'customer@example.test' } }, api: { accountId: receipt.accountId } },
    client: { upload }, openBrowser, captureRepository };
}

describe('/handoff web', () => {
  it('uploads the conversation to its account and opens only an opaque transfer link', async () => {
    const ctx = await context();
    const result = await handoffWeb(ctx);
    const [snapshot, identity] = ctx.client.upload.mock.calls[0];
    expect(snapshot).toMatchObject({ source: 'cli', model: 'fantail', repository: null, messages: [
      { role: 'user', content: 'Continue my parser' }, { role: 'assistant', content: 'Parser is ready.' },
    ] });
    expect(identity).toEqual({ token: 'private-test-token', userId: 'customer', accountId: 'team_customer' });
    expect(JSON.stringify(snapshot)).not.toMatch(/private reasoning|credential-bearing/);
    expect(ctx.captureRepository).not.toHaveBeenCalled();
    const url = new URL(ctx.openBrowser.mock.calls[0][0]);
    expect(url.origin).toBe('https://dev.autohand.ai');
    expect(Object.fromEntries(url.searchParams)).toEqual({ transfer: receipt.id, account: receipt.accountId });
    expect(result).toContain(url.toString());
    expect(result).not.toContain('private-test-token');
    expect(ctx.currentSession.getMessages()).toHaveLength(3);
  });

  it('includes the repository snapshot only when requested and allows a headless handoff', async () => {
    const ctx = await context();
    const repository = { url: 'https://github.com/customer/parser', branch: 'main', revision: 'a'.repeat(40), patch: 'diff --git a/a.ts b/a.ts\n+new code' };
    ctx.captureRepository.mockResolvedValue(repository);
    await handoffWeb(ctx, ['--workspace', '--no-open']);
    expect(ctx.captureRepository).toHaveBeenCalledWith(directory);
    expect(ctx.client.upload.mock.calls[0][0].repository).toEqual(repository);
    expect(ctx.openBrowser).not.toHaveBeenCalled();
  });

  it('keeps a successful transfer usable if opening the browser fails', async () => {
    const ctx = await context(); ctx.openBrowser.mockRejectedValue(new Error('no desktop'));
    expect(await handoffWeb(ctx)).toContain(`transfer=${receipt.id}`);
    expect(ctx.client.upload).toHaveBeenCalledTimes(1);
  });

  it('keeps the source Web account when returning an imported session', async () => {
    const ctx = await context();
    ctx.currentSession.metadata.importedFrom = { source: 'Autohand Code Web', originalId: receipt.id, importedAt: '2026-09-10T00:00:00.000Z', accountId: 'team_customer' };
    await handoffWeb({ ...ctx, config: { ...ctx.config, api: undefined } }, ['--no-open']);
    expect(ctx.client.upload.mock.calls[0][1].accountId).toBe('team_customer');
  });

  it('returns an imported session to its own Web conversation and counts only the new messages', async () => {
    const ctx = await context();
    ctx.currentSession.metadata.summary = 'Continue my parser';
    ctx.currentSession.metadata.importedFrom = { source: 'Autohand Code Web', originalId: receipt.id, importedAt: '2026-09-10T00:00:00.500Z', accountId: 'team_customer' };
    const result = await handoffWeb(ctx, ['--no-open']);
    expect(ctx.client.upload.mock.calls[0][2]).toEqual({ origin: { transferId: receipt.id } });
    expect(result).toContain('This resumes your Web conversation "Continue my parser" with 1 new message.');
    expect(result).not.toContain('opens this as a new conversation');
  });

  it('starts a new Web conversation with --new and ignores a malformed import id', async () => {
    const ctx = await context();
    ctx.currentSession.metadata.importedFrom = { source: 'Autohand Code Web', originalId: receipt.id, importedAt: '2026-09-10T00:00:00.000Z', accountId: 'team_customer' };
    expect(await handoffWeb(ctx, ['--new', '--no-open'])).not.toContain('This resumes');
    expect(ctx.client.upload.mock.calls[0][2]).toEqual({});
    ctx.client.upload.mockClear();
    ctx.currentSession.metadata.importedFrom = { source: 'Autohand Code Web', originalId: 'not-a-transfer-id', importedAt: '2026-09-10T00:00:00.000Z', accountId: 'team_customer' };
    await handoffWeb(ctx, ['--no-open']);
    expect(ctx.client.upload.mock.calls[0][2]).toEqual({});
    expect(await handoffWeb(ctx, ['--brand-new'])).toContain('Usage:');
  });

  it('falls back to a plain upload when the server rejects the origin, and says so', async () => {
    const ctx = await context();
    ctx.currentSession.metadata.importedFrom = { source: 'Autohand Code Web', originalId: receipt.id, importedAt: '2026-09-10T00:00:00.000Z', accountId: 'team_customer' };
    ctx.client.upload.mockRejectedValueOnce(new TransferUnsupportedError()).mockResolvedValueOnce(receipt);
    const result = await handoffWeb(ctx, ['--no-open']);
    expect(ctx.client.upload).toHaveBeenCalledTimes(2);
    expect(ctx.client.upload.mock.calls[1][2]).toBeUndefined();
    expect(result).toContain(`transfer=${receipt.id}`);
    expect(result).toContain('Your Web version opens this as a new conversation.');
    expect(result).not.toContain('This resumes');
    expect(result).not.toContain('private-test-token');
  });

  it('still hands off when the Web conversation moved on, and never resumes into it', async () => {
    const ctx = await context();
    ctx.currentSession.metadata.importedFrom = { source: 'Autohand Code Web', originalId: receipt.id, importedAt: '2026-09-10T00:00:00.000Z', accountId: 'team_customer' };
    ctx.client.upload
      .mockRejectedValueOnce(new TransferRequestError('The messages this handoff started from no longer match.', 409, 'handoff_diverged'))
      .mockResolvedValueOnce(receipt);
    const result = await handoffWeb(ctx, ['--no-open']);
    expect(ctx.client.upload).toHaveBeenCalledTimes(2);
    expect(ctx.client.upload.mock.calls[1][2]).toBeUndefined();
    expect(result).toContain(`transfer=${receipt.id}`);
    expect(result).toContain('opens as a new conversation');
    expect(result).not.toContain('This resumes');
    expect(result).not.toContain('Could not hand off this session');
  });

  it('reports an unrelated failure instead of retrying it as a downgrade', async () => {
    const ctx = await context();
    ctx.currentSession.metadata.importedFrom = { source: 'Autohand Code Web', originalId: receipt.id, importedAt: '2026-09-10T00:00:00.000Z', accountId: 'team_customer' };
    ctx.client.upload.mockRejectedValue(new TransferRequestError('Finish or stop the current task and queue before continuing this conversation.', 409, 'conversation_busy'));
    const result = await handoffWeb(ctx, ['--no-open']);
    expect(ctx.client.upload).toHaveBeenCalledTimes(1);
    expect(result).toContain('Finish or stop the current task');
    expect(result).toContain('Your local conversation is still available.');
  });

  it('preserves embedded images in imported messages and rejects remote image fetches', async () => {
    const ctx = await context();
    const data = 'data:image/png;base64,iVBORw0KGgo=';
    // Existing portable sessions store structured model content in conversation.jsonl.
    await fs.appendFile(path.join(directory, ctx.currentSession.metadata.sessionId, 'conversation.jsonl'), JSON.stringify({ role: 'user', content: [{ type: 'image_url', image_url: { url: data } }], attachmentNames: ['diagram.png'], timestamp: '2026-09-10T00:00:03.000Z' }) + '\n');
    await ctx.currentSession.load();
    await handoffWeb(ctx, ['--no-open']);
    expect(ctx.client.upload.mock.calls[0][0].messages.at(-1)).toMatchObject({ images: [{ name: 'diagram.png', data }] });
    ctx.client.upload.mockClear();
    await fs.appendFile(path.join(directory, ctx.currentSession.metadata.sessionId, 'conversation.jsonl'), JSON.stringify({ role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://localhost/secret' } }], timestamp: '2026-09-10T00:00:04.000Z' }) + '\n');
    await ctx.currentSession.load();
    expect(await handoffWeb(ctx, ['--no-open'])).toContain('embedded');
    expect(ctx.client.upload).not.toHaveBeenCalled();
  });

  it('requires login and an active saved conversation', async () => {
    const ctx = await context();
    expect(await handoffWeb({ ...ctx, config: { configPath: '' } })).toContain('/login');
    expect(await handoffWeb({ ...ctx, currentSession: undefined, sessionManager: new SessionManager(directory) })).toContain('No active session');
    expect(ctx.client.upload).not.toHaveBeenCalled();
  });

  it('rejects unsupported options and unavailable workspace capture before uploading', async () => {
    const ctx = await context();
    expect(await handoffWeb(ctx, ['https://evil.test'])).toContain('Usage:');
    ctx.captureRepository.mockRejectedValue(new Error('Choose a GitHub repository without embedded credentials.'));
    expect(await handoffWeb(ctx, ['--workspace'])).toContain('without embedded credentials');
    expect(ctx.client.upload).not.toHaveBeenCalled();
  });

  it('does not silently truncate large conversations or open a mismatched receipt', async () => {
    const ctx = await context();
    vi.spyOn(ctx.currentSession, 'getMessages').mockReturnValue(Array.from({ length: 501 }, () => ({ role: 'user', content: 'Message', timestamp: '2026-09-10T00:00:00.000Z' })));
    expect(await handoffWeb(ctx)).toContain('500');
    expect(ctx.client.upload).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    ctx.client.upload.mockResolvedValue({ ...receipt, accountId: 'different-account' });
    expect(await handoffWeb(ctx)).toContain('account');
    expect(ctx.openBrowser).not.toHaveBeenCalled();
  });
});
