/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { showModal, showInput } = vi.hoisted(() => ({
  showModal: vi.fn(),
  showInput: vi.fn(),
}));

vi.mock('../../src/ui/ink/components/Modal.js', () => ({ showModal, showInput }));

type ModalCall = { title: string; options: Array<{ label: string; value: string }> };

function labelsOf(call: ModalCall): string[] {
  return call.options.map((option) => option.label);
}

describe('permission confirm prompt', () => {
  beforeEach(() => {
    vi.stubEnv('AUTOHAND_PERMISSION_CALLBACK_URL', '');
    vi.stubEnv('AUTOHAND_NON_INTERACTIVE', '');
    vi.stubEnv('AUTOHAND_YES', '');
    vi.stubEnv('CI', '');
    showModal.mockReset();
    showInput.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('offers an always-allow prefix option for command prompts and stores it in the chosen scope', async () => {
    const { confirm } = await import('../../src/ui/promptCallback.js');
    showModal
      .mockResolvedValueOnce({ label: 'prefix', value: 'allow_prefix' })
      .mockResolvedValueOnce({ label: 'Project', value: 'project' });

    const result = await confirm('Run this command?', { tool: 'run_command', command: 'git status --porcelain' });

    expect(result).toEqual({ decision: 'allow_prefix_project' });
    const [first, scope] = showModal.mock.calls.map(([call]) => call as ModalCall);
    expect(labelsOf(first!)).toEqual([
      'Yes',
      'No',
      'Allow Once',
      'Deny Once',
      'Allow Always',
      'Always allow `git` commands',
      'Deny Always',
      'Run a different command instead...',
    ]);
    expect(scope!.title).toBe('Choose where to save this decision');
    expect(showInput).not.toHaveBeenCalled();
  });

  it('denies once when the prefix scope picker is cancelled', async () => {
    const { confirm } = await import('../../src/ui/promptCallback.js');
    showModal
      .mockResolvedValueOnce({ label: 'prefix', value: 'allow_prefix' })
      .mockResolvedValueOnce(null);

    await expect(confirm('Run this command?', { tool: 'shell', command: 'npm test' }))
      .resolves.toEqual({ decision: 'deny_once' });
  });

  it('keeps path prompts free of the prefix option and asks for a replacement path', async () => {
    const { confirm } = await import('../../src/ui/promptCallback.js');
    showModal.mockResolvedValueOnce({ label: 'alt', value: 'alternative' });
    showInput.mockResolvedValueOnce('  docs/other.md ');

    const result = await confirm('Write to this file?', { tool: 'write_file', path: 'docs/readme.md' });

    expect(result).toEqual({ decision: 'alternative', alternative: 'docs/other.md' });
    const [first] = showModal.mock.calls.map(([call]) => call as ModalCall);
    expect(labelsOf(first!)).toEqual([
      'Yes', 'No', 'Allow Once', 'Deny Once', 'Allow Always', 'Deny Always', 'Use a different path instead...',
    ]);
    expect(showInput).toHaveBeenCalledWith({ title: 'Replacement path to use instead (empty to cancel)' });
  });

  it('labels the replacement input as a command that will run for command prompts', async () => {
    const { confirm } = await import('../../src/ui/promptCallback.js');
    showModal.mockResolvedValueOnce({ label: 'alt', value: 'alternative' });
    showInput.mockResolvedValueOnce('');

    await expect(confirm('Run this command?', { tool: 'run_command', command: 'yes always' }))
      .resolves.toEqual({ decision: 'deny_once' });
    expect(showInput).toHaveBeenCalledWith({ title: 'Replacement command to run instead (empty to cancel)' });
  });

  it('omits the prefix option when no context is available', async () => {
    const { confirm } = await import('../../src/ui/promptCallback.js');
    showModal.mockResolvedValueOnce({ label: 'Yes', value: 'allow_once' });

    await expect(confirm('Allow tool?')).resolves.toEqual({ decision: 'allow_once' });
    const [first] = showModal.mock.calls.map(([call]) => call as ModalCall);
    expect(labelsOf(first!)).not.toContainEqual(expect.stringContaining('Always allow'));
  });
});
