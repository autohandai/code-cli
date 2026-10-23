import { describe, expect, it, vi } from 'vitest';
import { launchCloud } from '../../src/cloud/launchCloud.js';
import { CloudClient } from '../../src/cloud/CloudClient.js';
import type { LoadedConfig } from '../../src/types.js';
import { SessionTransferClient } from '../../src/session/transfer/transfer-client.js';

const id = '11111111-1111-4111-8111-111111111111', workspaceId = '22222222-2222-4222-8222-222222222222';
const conversation = { id, title: 'Repair parser', model: 'moa', updated_at: '2026-10-12' };
const config: LoadedConfig = { configPath: '/fixture/config.json', auth: { token: 'cloud-fixture-token-1234567890', user: { id: 'ada', email: 'ada@autohand.test', name: 'Ada' } }, api: { accountId: 'personal_fixture' } };
function fixture(tier = 'pro', workspaceStatus = 'ready') {
  const request = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/session')) return Response.json({ session: { user: { id: 'ada' }, account: { account: { id: 'personal_fixture' } } } });
    if (path.endsWith('/account')) return Response.json({ tier, paymentAccess: null });
    if (path.endsWith('/models')) return Response.json({ models: [{ id: 'moa', available: true }, { id: 'auto', available: true }] });
    if (path.endsWith('/sandbox-providers')) return Response.json({ providers: [{ id: 'cloudflare', available: true, name: 'Cloud' }] });
    if (path.endsWith('/workspaces')) return init?.method === 'POST'
      ? Response.json({ workspace: { id: workspaceId, repository: 'autohand/parser', branch: 'main', provider: 'cloudflare', status: workspaceStatus } })
      : Response.json({ workspaces: [] });
    if (path.endsWith('/messages')) return Response.json({ job: { id, state: 'scheduled', revision: 0, content: 'Repair parser' } });
    if (path.endsWith('/queue')) return Response.json({ jobs: [], paused: false });
    if (path.endsWith('/interactions')) return Response.json({ interaction: null });
    if (path.endsWith('/import')) return Response.json({ conversation, repositoryPending: false });
    if (path.endsWith('/conversations')) return init?.method === 'POST' ? Response.json({ conversation }) : Response.json({ conversations: [conversation] });
    if (path.endsWith(`/conversations/${id}`)) return Response.json({ conversation, messages: [] });
    throw new Error(`Unexpected cloud request: ${path}`);
  });
  const view = vi.fn().mockResolvedValue({ kind: 'detached' });
  const createClient = (identity: ConstructorParameters<typeof CloudClient>[0]) => new CloudClient(identity, request);
  return { request, view, createClient, choose: vi.fn().mockResolvedValue(null), input: vi.fn().mockResolvedValue(null) };
}
describe('cloud launch orchestration', () => {
  it('carries read-only plan mode into the local continuation result', async () => {
    const dependencies = fixture();
    dependencies.view.mockResolvedValue({ kind: 'local', transferId: workspaceId, accountId: 'personal_fixture' });
    expect(await launchCloud({ config, workspaceRoot: '/fixture/parser' }, { cloud: true, resume: id, plan: true }, dependencies)).toEqual({ kind: 'local', transferId: workspaceId, accountId: 'personal_fixture', plan: true });
  });
  it('waits for workspace readiness when handing off a transcript without a repository snapshot', async () => {
    const dependencies = fixture('pro', 'creating'), transferClient = new SessionTransferClient();
    vi.spyOn(transferClient, 'upload').mockResolvedValue({ id: workspaceId, accountId: 'personal_fixture', expiresAt: '2027-01-01T00:00:00Z' });
    dependencies.choose.mockResolvedValue('transfer');
    const snapshot = { version: 1 as const, source: 'cli' as const, sourceSessionId: 'parser', title: 'Repair parser', createdAt: '2026-10-12T00:00:00Z', provider: 'autohandai', model: 'moa', repository: null, messages: [{ role: 'user' as const, content: 'Private parser context', createdAt: '2026-10-12T00:00:00Z' }] };
    await expect(launchCloud({ config, workspaceRoot: '/fixture/parser', snapshot }, { cloud: true, prompt: 'Repair parser', cloudRepository: 'autohand/parser', cloudConnector: 'github-app:fixture', cloudBranch: 'main' }, { ...dependencies, transferClient })).rejects.toThrow('workspace is creating');
    expect(dependencies.request.mock.calls.some(([url]) => new URL(String(url)).pathname.endsWith('/messages'))).toBe(false);
    expect(dependencies.view).not.toHaveBeenCalled();
  });
  it('attaches the authorized remote workspace before admitting the task and leaves local config intact', async () => {
    const dependencies = fixture(), before = JSON.stringify(config);
    await launchCloud({ config, workspaceRoot: '/fixture/parser' }, { cloud: true, prompt: 'Repair parser', model: 'moa', cloudRepository: 'autohand/parser', cloudConnector: 'github-app:fixture', cloudBranch: 'main' }, dependencies);
    const paths = dependencies.request.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths.indexOf('/api/native/cloud/workspaces')).toBeLessThan(paths.indexOf(`/api/native/cloud/conversations/${id}/messages`));
    expect(JSON.stringify(config)).toBe(before); expect(dependencies.view).toHaveBeenCalledOnce();
    expect(paths.some(path => path.includes('/chat/completions'))).toBe(false);
  });
  it('resumes saved history without creating, uploading, attaching, or replaying a prompt', async () => {
    const dependencies = fixture();
    await launchCloud({ config, workspaceRoot: '/fixture/parser' }, { cloud: true, resume: `https://dev.autohand.ai/c/${id}?account=personal_fixture` }, dependencies);
    expect(dependencies.request.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(dependencies.view).toHaveBeenCalledOnce();
  });
  it('checks supported plans before provisioning or uploading local context', async () => {
    for (const plan of ['free', 'lite', 'team', 'enterprise', 'unknown']) {
      const dependencies = fixture(plan);
      await expect(launchCloud({ config, workspaceRoot: '/fixture/parser' }, { cloud: true, prompt: 'Repair parser' }, dependencies)).rejects.toThrow('Pro');
      expect(dependencies.request.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
      expect(dependencies.view).not.toHaveBeenCalled();
    }
  });
  it('refuses a resume link from another account before making a network request', async () => {
    const dependencies = fixture();
    await expect(launchCloud({ config, workspaceRoot: '/fixture/parser' }, { cloud: true, resume: `https://dev.autohand.ai/c/${id}?account=foreign` }, dependencies)).rejects.toThrow('account');
    expect(dependencies.request).not.toHaveBeenCalled();
  });
  it('cancels an empty launch without creating a cloud conversation', async () => {
    const dependencies = fixture();
    expect(await launchCloud({ config, workspaceRoot: '/fixture/parser' }, { cloud: true }, dependencies)).toEqual({ kind: 'cancelled' });
    expect(dependencies.request.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });
  it('refuses local deny policies that the hosted runtime cannot enforce before contacting Cloud', async () => {
    for (const permissions of [{ mode: 'restricted' as const }, { denyList: ['run_command:*'] }, { rules: [{ tool: 'write_file', action: 'deny' as const }] }]) {
      const dependencies = fixture();
      await expect(launchCloud({ config: { ...config, permissions }, workspaceRoot: '/fixture/parser' }, { cloud: true, prompt: 'Repair parser' }, dependencies)).rejects.toThrow('local security policy');
      expect(dependencies.request).not.toHaveBeenCalled();
    }
  });
  it('preserves a local git-merge prohibition in hosted read-only plan mode', async () => {
    const dependencies = fixture();
    await launchCloud({ config: { ...config, permissions: { denyList: ['git_merge:*'] } }, workspaceRoot: '/fixture/parser' }, { cloud: true, plan: true, prompt: 'Inspect parser' }, dependencies);
    const send = dependencies.request.mock.calls.find(([url]) => new URL(String(url)).pathname.endsWith('/messages'));
    expect(JSON.parse(String(send?.[1]?.body)).executionMode).toBe('plan');
  });
  it('lets the user cancel context transfer before uploading any local history or repository', async () => {
    const dependencies = fixture(), transferClient = new SessionTransferClient(), upload = vi.spyOn(transferClient, 'upload').mockRejectedValue(new Error('Unexpected upload'));
    const snapshot = { version: 1 as const, source: 'cli' as const, sourceSessionId: 'parser', title: 'Repair parser', createdAt: '2026-10-12T00:00:00Z', provider: 'autohandai', model: 'moa', repository: null, messages: [{ role: 'user' as const, content: 'Private parser context', createdAt: '2026-10-12T00:00:00Z' }] };
    dependencies.input.mockResolvedValue('Repair parser');
    expect(await launchCloud({ config, workspaceRoot: '/fixture/parser', snapshot }, { cloud: true }, { ...dependencies, transferClient })).toEqual({ kind: 'cancelled' });
    expect(upload).not.toHaveBeenCalled();
    expect(dependencies.request.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });
});
