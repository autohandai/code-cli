import { createServer, type ServerResponse } from 'node:http';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPartialDelegationScenario } from '../../src/testing/scenarios/partialDelegationScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

interface WireRequest {
  messages: Array<{ role: string; content: string }>;
}

describe('partial delegation findings', () => {
  it('delivers a successful sibling report after another research worker exhausts its iterations', async () => {
    let leadTurns = 0;
    let failedTurns = 0;
    let leadObservation = '';
    const reply = (response: ServerResponse, content: string, tool?: { name: string; args: Record<string, unknown> }) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'partial-delegation', created: 1,
        choices: [{ index: 0, finish_reason: tool ? 'tool_calls' : 'stop', message: { role: 'assistant', content,
          ...(tool ? { tool_calls: [{ id: `call-${tool.name}-${failedTurns}`, type: 'function', function: {
            name: tool.name, arguments: JSON.stringify(tool.args),
          } }] } : {}),
        } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }));
    };
    const server = createServer((request, response) => {
      void (async () => {
        if (!request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return; }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as WireRequest;
        const system = body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
        if (system.includes('independent Moa advisor')) {
          reply(response, '{"verdict":"approved","feedback":"Partial findings and remaining work are disclosed."}');
        } else if (system.startsWith('UNFINISHED_READER')) {
          failedTurns += 1;
          reply(response, 'Checked the last file; another file remains.', {
            name: 'read_file', args: { path: `fixture-${failedTurns}.txt` },
          });
        } else if (system.startsWith('FINISHED_READER')) {
          reply(response, '{"findings":["PARTIAL_DOC_SOURCE: installation docs verified"],"uncertainties":[]}');
        } else {
          leadTurns += 1;
          if (leadTurns === 1) {
            reply(response, 'Inspecting independent code and docs scopes.', { name: 'delegate_parallel', args: { tasks: [
              { agent_name: 'unfinished', task: 'Inspect source files.' },
              { agent_name: 'finished', task: 'Inspect documentation.' },
            ] } });
          } else {
            leadObservation = body.messages.filter(message => message.role === 'tool').map(message => message.content).join('\n');
            reply(response, leadObservation.includes('PARTIAL_DOC_SOURCE')
              ? 'SIBLING_REPORT_RECOVERED: Verified installation docs; source research remains incomplete.'
              : 'SIBLING_REPORT_MISSING: The completed documentation findings were discarded.');
          }
        }
      })().catch(error => { response.writeHead(500).end(String(error)); });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture', model: 'moa', orchestration: true,
        baseUrl: `http://127.0.0.1:${address.port}` },
      features: { autohand_inference: true, automaticSpecialists: false },
      agent: { autoMemory: false, maxIterations: 5, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    let session: Awaited<ReturnType<typeof launchBuiltAutohand>> | undefined;
    try {
      for (let index = 1; index <= 10; index += 1) {
        await writeFile(path.join(state.workspaceRoot, `fixture-${index}.txt`), `Source file ${index}`);
      }
      const agents = {
        unfinished: { description: 'Inspect source', prompt: 'UNFINISHED_READER', tools: ['*'] },
        finished: { description: 'Inspect docs', prompt: 'FINISHED_READER', tools: ['*'] },
      };
      session = await launchBuiltAutohand(['--config', state.configPath, '--path', state.workspaceRoot,
        '--agents', JSON.stringify(agents), '--yes'], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 120, rows: 36, waitForDataTimeout: 15_000,
      });
      expect(await runPartialDelegationScenario(session)).toContain('SIBLING_REPORT_RECOVERED');
      expect(leadObservation).toContain('PARTIAL_DOC_SOURCE');
      expect(leadObservation).toContain('Failed to complete task within 10 iterations');
      await exitInteractive(session);
    } finally {
      session?.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await state.cleanup();
    }
  });
});
