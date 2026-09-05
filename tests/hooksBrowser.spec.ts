import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HookManager } from '../src/core/HookManager.js';
import { hooks } from '../src/commands/hooks.js';
const { showModal, showInput, create } = vi.hoisted(() => ({ showModal: vi.fn(), showInput: vi.fn(), create: vi.fn() }));
vi.mock('../src/ui/ink/components/Modal.js', () => ({ showModal, showInput }));

describe('lifecycle hook browser', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it('opens an event table, selects an empty event and creates from plain English', async () => {
    const manager = new HookManager({ workspaceRoot: '/test' });
    showModal.mockResolvedValueOnce({ value: 'pre-tool' }).mockResolvedValue(null);
    showInput.mockResolvedValue('Log each tool before it runs');
    create.mockResolvedValue({ status: 'created', scriptPath: '/test/hooks/log.cjs', active: true, hook: { event: 'pre-tool' } });
    await hooks({ hookManager: manager, authoring: { create } });
    expect(showModal.mock.calls[0][0]).toMatchObject({ title: expect.stringContaining('Lifecycle hooks from config and enabled plugins'),
      options: expect.arrayContaining([expect.objectContaining({ value: 'pre-tool', label: expect.stringContaining('0') })]) });
    expect(showInput).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('pre-tool') }));
    expect(create).toHaveBeenCalledWith({ event: 'pre-tool', prompt: 'Log each tool before it runs' });
  });
  it('cancels prompt without generating a hook and returns to the table', async () => {
    showModal.mockResolvedValueOnce({ value: 'stop' }).mockResolvedValue(null);
    showInput.mockResolvedValue(null);
    await hooks({ hookManager: new HookManager({ workspaceRoot: '/test' }), authoring: { create } });
    expect(create).not.toHaveBeenCalled();
    expect(showModal).toHaveBeenCalledTimes(2);
  });
  it('lists events without a terminal or a model', async () => {
    const output = await hooks({ hookManager: new HookManager({ workspaceRoot: '/test' }) }, 'list');
    expect(output).toContain('Installed');
    expect(output).toContain('context:critical');
    expect(showModal).not.toHaveBeenCalled();
  });
});
