import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerCloudOptions, validateCloudOptions } from '../../src/startup/cloudOptions.js';
describe('cloud startup flags', () => {
  it('parses new and resumed cloud sessions using the requested terminal syntax', () => {
    const program = registerCloudOptions(new Command()).exitOverride();
    program.parse(['--cloud', '--resume', 'https://dev.autohand.ai/c/11111111-1111-4111-8111-111111111111'], { from: 'user' });
    expect(program.opts()).toMatchObject({ cloud: true, resume: 'https://dev.autohand.ai/c/11111111-1111-4111-8111-111111111111' });
  });
  it('fails before network work when local-only execution settings would be ignored', () => {
    for (const option of [{ offline: true }, { ephemeral: true }, { unrestricted: true }, { autoMode: 'task' }, { mode: 'rpc' }, { dryRun: true }, { worktree: 'isolated' }, { json: true }]) {
      expect(() => validateCloudOptions({ cloud: true, ...option })).toThrow();
    }
    expect(() => validateCloudOptions({ cloud: true, plan: true })).not.toThrow();
  });
  it('does not let the new resume flag silently change local session selection', () => {
    expect(() => validateCloudOptions({ resume: true })).toThrow('autohand resume');
  });
});
