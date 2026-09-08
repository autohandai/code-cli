import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { runNativeContextCropScenario } from '../../src/testing/scenarios/nativeContextCropScenario.js';
import {
  createMockAutohandAINativeSequenceServer,
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  type MockNativeToolServer,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

let session: Session | undefined;
let state: TuistoryTempState | undefined;
let server: MockNativeToolServer | undefined;

afterEach(async () => {
  await session?.close();
  await server?.close();
  await state?.cleanup();
  session = undefined;
  server = undefined;
  state = undefined;
});

describe('Native context crop history', () => {
  it('keeps the active native crop call paired with its result and continues the interactive turn (#567, #555, #550)', async () => {
    server = await createMockAutohandAINativeSequenceServer([
      {
        content: '',
        toolCall: {
          id: 'call_active_crop',
          name: 'smart_context_cropper',
          args: { crop_direction: 'bottom', crop_amount: 1 },
        },
      },
      { content: 'NATIVE_CONTEXT_CROP_CONTINUED' },
    ]);
    state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        autohandai: {
          plan: 'cloud',
          authMode: 'api-key',
          apiKey: 'tuistory-autohand-api-key',
          model: 'moa',
          baseUrl: server.baseUrl,
        },
        features: { autohand_inference: true },
        agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
        autoReport: { enabled: false },
        network: { maxRetries: 0, retryDelay: 0 },
        ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      },
    });
    session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '--y',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    });

    await runNativeContextCropScenario(session);

    expect(server.requests).toHaveLength(2);
    const continuation = server.requests[1];
    expect(continuation?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [expect.objectContaining({ id: 'call_active_crop' })],
      }),
      expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call_active_crop',
        content: expect.stringMatching(/Cropped \d+ message|smart_context_cropper: no eligible/),
      }),
    ]));
    expect(continuation?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ function: expect.objectContaining({ name: 'read_file' }) }),
    ]));
    expect(JSON.stringify(continuation?.messages)).not.toContain('[Tool Result Integrity]');
    expect(await session.text()).toContain('NATIVE_CONTEXT_CROP_CONTINUED');
    await exitInteractive(session);
  }, 45_000);
});
