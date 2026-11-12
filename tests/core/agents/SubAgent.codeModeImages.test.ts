import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { SubAgent } from '../../../src/core/agents/SubAgent.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';
import type { ActionExecutor } from '../../../src/core/actionExecutor.js';
import type { LoadedConfig } from '../../../src/types.js';

describe('Code Mode image hint through the real worker runtime', () => {
  it('lets real QuickJS detect image evidence while attaching the actual image to the next model request exactly once', async () => {
    const workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-script-image-hint-')));
    try {
      const frame = path.join(workspace, '.autohand', 'test-evidence', 'run-fixture', 'frame-001.png');
      await fs.mkdir(path.dirname(frame), { recursive: true });
      await fs.writeFile(frame, await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } }).png().toBuffer());
      const requests: Array<Parameters<LLMProvider['complete']>[0]> = [];
      const provider: LLMProvider = {
        getName: () => 'openai', getCapabilities: () => ({ nativeToolCalling: true }), listModels: async () => [], isAvailable: async () => true, setModel: () => {},
        complete: async request => {
          requests.push(structuredClone(request));
          return requests.length === 1
            ? { id: 'capture', created: 0, raw: null, content: '', toolCalls: [{ id: 'capture-script', type: 'function', function: { name: 'run_tool_script', arguments: JSON.stringify({ script: "const frame = await tools.capture_test_evidence({url:'http://127.0.0.1/'}); return {sawImages:frame.images,needsVisualInspection:true};" }) } }] }
            : { id: 'vision', created: 0, raw: null, content: 'The fixture contains a red square.' };
        },
      };
      const executeForTool = vi.fn(async () => ({ success: true as const, output: 'Fixture capture available; visual inspection pending.', imagePaths: [frame, frame] }));
      const agent = new SubAgent({ name: 'visual-reader', source: 'session', path: '<test>', description: 'Inspect evidence', systemPrompt: 'Capture and inspect the local fixture.', tools: ['capture_test_evidence'] }, provider, { executeForTool } as unknown as ActionExecutor, {
        clientContext: 'cli', depth: 1, maxDepth: 1, workspaceRoot: workspace, projectMemoryEnabled: false,
        confirmApproval: async () => true,
        featureConfig: { provider: 'openai', features: { codeMode: true } } as LoadedConfig,
      });
      await expect(agent.run('Inspect the fixture.')).resolves.toBe('The fixture contains a red square.');
      expect(executeForTool).toHaveBeenCalledOnce();
      expect(requests).toHaveLength(2);
      const observation = requests[1].messages.find(message => message.role === 'tool');
      expect(JSON.parse(String(observation?.content)).result).toMatchObject({ sawImages: true, needsVisualInspection: true });
      expect(observation?.content).not.toContain('base64');
      const images: string[] = [];
      for (const message of requests[1].messages) {
        if (Array.isArray(message.content)) for (const part of message.content) {
          if (part.type === 'image_url') images.push(part.image_url.url);
        }
      }
      expect(images).toHaveLength(1);
      const pixels = await sharp(Buffer.from(images[0].split(',')[1], 'base64')).raw().toBuffer();
      expect([...pixels.subarray(0, 3)]).toEqual([255, 0, 0]);
    } finally { await fs.rm(workspace, { recursive: true, force: true }); }
  });
});
