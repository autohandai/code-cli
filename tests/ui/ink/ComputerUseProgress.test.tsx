import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { ComputerUseProgress } from '../../../src/ui/ink/ComputerUseProgress.js';

describe('Computer Use progress', () => {
  it('shows a bounded lane with an explicit count of earlier actions', () => {
    const view = render(<ComputerUseProgress steps={Array.from({ length: 15 }, (_, index) => ({
      id: String(index), label: `Action ${index}`, status: 'done' as const,
    }))} />);
    expect(view.lastFrame()).toContain('3 earlier steps');
    expect(view.lastFrame()).not.toContain('Action 2\n');
    expect(view.lastFrame()).toContain('Action 14');
    expect(view.lastFrame()?.split('\n')).toHaveLength(14);
    view.unmount();
  });
  it('renders one readable lane with honest action and verification status', () => {
    const view = render(<ComputerUseProgress steps={[
      { id: 'find', label: 'Finding Messages', status: 'done' },
      { id: 'write', label: 'Writing text', status: 'unverified', detail: 'Needs verification' },
      { id: 'check', label: 'Verifying the result', status: 'running' },
    ]} />);
    expect(view.lastFrame()).toBe([
      'Computer Use',
      '├─ ✓ Finding Messages',
      '├─ ? Writing text · Needs verification',
      '└─ › Verifying the result',
    ].join('\n'));
    view.unmount();
  });
});
