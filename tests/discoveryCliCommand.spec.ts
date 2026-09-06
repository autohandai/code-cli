import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'src/index.ts');
const loader = path.join(root, 'node_modules/tsx/dist/loader.mjs');
let temporary: string;
let workspace: string;
let server: Server | undefined;
beforeEach(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'native-discovery-test-'));
  workspace = path.join(temporary, 'repository with spaces');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'native-fixture', scripts: { test: 'DO_NOT_EXECUTE' } }));
});
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; }
  await rm(temporary, { recursive: true, force: true });
});
const run = (args: string[], env: Record<string, string> = {}) => exec(process.execPath, ['--import', loader, cli, ...args], {
  cwd: workspace, timeout: 30_000, env: { ...process.env, AUTOHAND_HOME: path.join(temporary, 'home'), AUTOHAND_CONFIG: '', AUTOHAND_API_KEY: '', AUTOHAND_NO_BANNER: '1', AUTOHAND_DISABLE_AUTO_REPORT: '1', ...env },
});

describe('native discovery command', () => {
  it('shows help and scans without loading project extensions or creating account settings', async () => {
    const extension = path.join(workspace, '.autohand/extensions/autohand.discovery-test');
    await mkdir(extension, { recursive: true });
    await writeFile(path.join(extension, 'autohand.extension.json'), JSON.stringify({ schemaVersion: 1, extensionApi: 1, id: 'autohand.discovery-test', name: 'Never load discovery fixture', version: '1.0.0', description: 'Detect unintended extension startup.', contributes: { runtime: ['runtime.mjs'] } }));
    const marker = path.join(workspace, 'extension-executed.txt');
    await writeFile(path.join(extension, 'runtime.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); export default function() {}`);
    await mkdir(path.join(workspace, '.autohand/extensions/.state'), { recursive: true });
    await writeFile(path.join(workspace, '.autohand/extensions/.state/autohand.discovery-test.json'), JSON.stringify({ disabled: false, trusted: true }));
    expect((await run(['discovery', '--help'])).stdout).toContain('repository');
    const scan = JSON.parse((await run(['--path', workspace, 'discovery', '--json'])).stdout);
    expect(scan.report.repository.name).toBe('native-fixture');
    expect(scan.local.created).toContain('repository-onboarding');
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(temporary, 'home/config.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const list = JSON.parse((await run(['discovery', 'list', '--json'])).stdout);
    expect(list.workflows).toHaveLength(2);
    const preview = JSON.parse((await run(['discovery', 'push', '--dry-run', '--select', 'repository-onboarding'])).stdout);
    expect(preview.payload.workflows).toHaveLength(1);
  });

  it('reuses stored durable credentials despite old expiry metadata, only for an explicit push', async () => {
    const config = path.join(temporary, 'auth.json');
    const key = 'ahc_native_fixture_not_real';
    const configuration = JSON.stringify({ auth: { token: key, expiresAt: '2000-01-01T00:00:00Z' } });
    await writeFile(config, configuration);
    const requests: { authorization: string | undefined; body: string }[] = [];
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ authorization: request.headers.authorization, body });
      const workflows = JSON.parse(body).workflows as { id: string; workflow: { name: string } }[];
      const origin = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ imports: workflows.map((entry) => { const id = crypto.randomUUID(); return { localId: entry.id, id, name: entry.workflow.name, created: true, url: `${origin}/?workflow=${id}` }; }) }));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await run(['discovery']);
    const result = await run(['--config', config, 'discovery', 'push', '--json'], { BUILDMYAGENT_URL: origin });
    expect(JSON.parse(result.stdout).imports).toHaveLength(2);
    expect(requests).toHaveLength(1);
    expect(requests[0].authorization).toBe(`Bearer ${key}`);
    expect(requests[0].body).not.toContain(key);
    expect(result.stdout + result.stderr).not.toContain(key);
    expect(await readFile(config, 'utf8')).toBe(configuration);
    await run(['--config', config, 'discovery', 'push', '--dry-run'], { BUILDMYAGENT_URL: origin });
    expect(requests).toHaveLength(1);
  });

  it('keeps invalid local workflows offline and propagates a nonzero child exit', async () => {
    await run(['discovery']);
    await writeFile(path.join(workspace, '.autohand/workflows/broken.json'), '{');
    await expect(run(['discovery', 'push'])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('broken.json') });
  });

  it('forwards interruption to an active upload and exits with 130', async () => {
    await run(['discovery']);
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    server = createServer(() => { requestStarted(); });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const operation = run(['discovery', 'push'], { AUTOHAND_API_KEY: 'ahc_cancellation_fixture', BUILDMYAGENT_URL: origin });
    const outcome = operation.then(() => null, (error: unknown) => error);
    await started;
    operation.child.kill('SIGINT');
    expect(await outcome).toMatchObject({ code: 130, stderr: expect.stringContaining('cancelled') });
  });
});
