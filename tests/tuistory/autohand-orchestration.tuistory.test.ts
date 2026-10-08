import { createServer, type ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runOrchestrationScenario } from '../../src/testing/scenarios/autohandOrchestrationScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

interface WireRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ function: { name: string } }>;
  extra_body?: { chat_template_kwargs?: { reasoning_effort?: string } };
}

describe('default Autohand AI orchestration', () => {
  it('runs three Fantail readers concurrently and asks Moa to audit before publishing completion', async () => {
    const requests: WireRequest[] = [];
    const waitingWorkers: ServerResponse[] = [];
    let leadTurns = 0;
    let audited = false;
    const reply = (response: ServerResponse, content: string, tool?: { name: string; args: Record<string, unknown> }) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'orchestration-fixture', created: 1,
        choices: [{ index: 0, finish_reason: tool ? 'tool_calls' : 'stop', message: { role: 'assistant', content,
          ...(tool ? { tool_calls: [{ id: `call-${tool.name}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : {}) } }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }));
    };
    const server = createServer((request, response) => {
      void (async () => {
        if (!request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return; }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as WireRequest;
        requests.push(body);
        const system = body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
        if (system.includes('independent Moa advisor')) {
          audited = true;
          reply(response, '{"verdict":"approved","feedback":"Read-only findings and source evidence verified."}');
        } else if (system.startsWith('ORCHESTRATION_WORKER')) {
          if (body.messages.some(message => message.role === 'tool')) reply(response, '{"files":["fixture.txt"],"findings":["FIXTURE_SOURCE"],"uncertainties":[]}');
          else {
            waitingWorkers.push(response);
            if (waitingWorkers.length === 3) for (const worker of waitingWorkers) reply(worker, '', { name: 'read_file', args: { path: 'fixture.txt' } });
          }
        } else {
          leadTurns += 1;
          if (leadTurns === 1) reply(response, 'Inspecting three independent scopes.', { name: 'delegate_parallel', args: { tasks: [1, 2, 3].map(index => ({ agent_name: `reader-${index}`, task: 'Inspect fixture.txt and return structured evidence.' })) } });
          else if (leadTurns === 2) reply(response, 'ORCHESTRATION_VERIFIED: Three source reports agree.');
          else reply(response, `ORCHESTRATION_MODE_${leadTurns === 3 ? 'OFF' : 'ON'}: The requested setting is active.`);
        }
      })().catch(error => { response.writeHead(500).end(String(error)); });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai', autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture', model: 'moa', orchestration: true, baseUrl: `http://127.0.0.1:${address.port}` },
      features: { autohand_inference: true, automaticSpecialists: false },
      agent: { autoMemory: false, maxIterations: 8, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    const saved = JSON.parse(await readFile(state.configPath, 'utf8')) as { autohandai: { orchestration?: boolean } };
    delete saved.autohandai.orchestration;
    await writeFile(state.configPath, JSON.stringify(saved));
    await writeFile(path.join(state.workspaceRoot, 'fixture.txt'), 'FIXTURE_SOURCE');
    const agents = Object.fromEntries([1, 2, 3].map(index => [`reader-${index}`, { description: 'Inspect source', prompt: `ORCHESTRATION_WORKER_${index}`, tools: ['*'] }]));
    const session = await launchBuiltAutohand(['--config', state.configPath, '--path', state.workspaceRoot, '--agents', JSON.stringify(agents), '--yes'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 120, rows: 32, waitForDataTimeout: 15_000,
    });
    try {
      expect(await runOrchestrationScenario(session)).toContain('ORCHESTRATION_VERIFIED');
      expect(audited).toBe(true);
      expect(waitingWorkers).toHaveLength(3);
      const workers = requests.filter(request => request.model === 'fantail');
      expect(workers).toHaveLength(6);
      for (const worker of workers) {
        expect(worker.extra_body?.chat_template_kwargs?.reasoning_effort).toBeUndefined();
        expect(worker.tools?.map(tool => tool.function.name)).toContain('read_file');
        expect(worker.tools?.map(tool => tool.function.name)).not.toContain('write_file');
        expect(worker.tools?.map(tool => tool.function.name)).not.toContain('shell');
      }
      const audit = requests.at(-1)!;
      expect(audit.model).toBe('moa');
      expect(audit.tools).toBeUndefined();
      expect(audit.extra_body?.chat_template_kwargs?.reasoning_effort).toBe('high');
      expect(JSON.stringify(audit.messages)).toContain('fixture.txt');
      expect(JSON.stringify(audit.messages)).toContain('Workspace diff against HEAD');
      for (const mode of ['off', 'on']) {
        await session.type(`/agents orchestration ${mode}`);
        await session.press('enter');
        await session.text({ timeout: 15_000, waitFor: text => text.includes(`Autohand AI orchestration ${mode === 'on' ? 'enabled' : 'disabled'}.`) });
        await session.type(`Confirm the ${mode} setting in a short reply.`);
        await session.press('enter');
        await session.text({ timeout: 15_000, waitFor: text => text.includes(`ORCHESTRATION_MODE_${mode.toUpperCase()}`) });
        const instructions = requests.at(-1)!.messages.filter(message => message.role === 'system' && message.content.startsWith('[Autohand AI orchestration]'));
        expect(instructions.at(-1)?.content).toContain(`orchestration is ${mode === 'on' ? 'enabled' : 'disabled'}`);
      }
      await exitInteractive(session);
    } finally {
      session.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await state.cleanup();
    }
  });
});
