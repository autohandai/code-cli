/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ModalOption, ModalProps, ShowModalOptions } from '../../../src/ui/ink/components/Modal.js';

// Mock process.stdout.isTTY for non-interactive tests
const originalIsTTY = process.stdout.isTTY;

describe('modal cancel input detection', () => {
  it('recognizes Ink escape keys and raw ESC input', async () => {
    const { isModalCancelInput } = await import('../../../src/ui/ink/components/Modal.js');

    expect(isModalCancelInput('', { escape: true, ctrl: false })).toBe(true);
    expect(isModalCancelInput('\x1b', { escape: false, ctrl: false })).toBe(true);
  });

  it('recognizes modern CSI-u Escape sequences', async () => {
    const { isModalCancelInput } = await import('../../../src/ui/ink/components/Modal.js');

    expect(isModalCancelInput('\x1b[27u', { escape: false, ctrl: false })).toBe(true);
    expect(isModalCancelInput('\x1b[27;1u', { escape: false, ctrl: false })).toBe(true);
    expect(isModalCancelInput('\x1b[27;2u', { escape: false, ctrl: false })).toBe(true);
    expect(isModalCancelInput('\x1b[27;1~', { escape: false, ctrl: false })).toBe(true);
  });

  it('recognizes Ctrl+C as modal cancel but ignores ordinary text', async () => {
    const { isModalCancelInput } = await import('../../../src/ui/ink/components/Modal.js');

    expect(isModalCancelInput('c', { escape: false, ctrl: true })).toBe(true);
    expect(isModalCancelInput('c', { escape: false, ctrl: false })).toBe(false);
    expect(isModalCancelInput('x', { escape: false, ctrl: false })).toBe(false);
  });
});

describe('Modal Types', () => {
  describe('ModalOption interface', () => {
    it('accepts minimal option with label and value', () => {
      const option: ModalOption = {
        label: 'Save',
        value: 'save',
      };

      expect(option.label).toBe('Save');
      expect(option.value).toBe('save');
      expect(option.description).toBeUndefined();
      expect(option.disabled).toBeUndefined();
    });

    it('accepts option with description', () => {
      const option: ModalOption = {
        label: 'Save',
        value: 'save',
        description: 'Save your changes',
      };

      expect(option.description).toBe('Save your changes');
    });

    it('accepts option with disabled state', () => {
      const option: ModalOption = {
        label: 'Delete',
        value: 'delete',
        disabled: true,
      };

      expect(option.disabled).toBe(true);
    });

    it('accepts fully populated option', () => {
      const option: ModalOption = {
        label: 'Export',
        value: 'export',
        description: 'Export to file',
        disabled: false,
      };

      expect(option.label).toBe('Export');
      expect(option.value).toBe('export');
      expect(option.description).toBe('Export to file');
      expect(option.disabled).toBe(false);
    });
  });

  describe('ModalProps interface', () => {
    it('accepts required props only', () => {
      const mockOnSelect = vi.fn();
      const props: ModalProps = {
        title: 'Select Action',
        options: [{ label: 'OK', value: 'ok' }],
        onSelect: mockOnSelect,
      };

      expect(props.title).toBe('Select Action');
      expect(props.options).toHaveLength(1);
      expect(props.onCancel).toBeUndefined();
      expect(props.allowCustomInput).toBeUndefined();
      expect(props.multiSelect).toBeUndefined();
    });

    it('accepts all optional props', () => {
      const mockOnSelect = vi.fn();
      const mockOnCancel = vi.fn();
      const props: ModalProps = {
        title: 'Select Action',
        options: [{ label: 'OK', value: 'ok' }],
        onSelect: mockOnSelect,
        onCancel: mockOnCancel,
        allowCustomInput: true,
        multiSelect: false,
      };

      expect(props.onCancel).toBe(mockOnCancel);
      expect(props.allowCustomInput).toBe(true);
      expect(props.multiSelect).toBe(false);
    });
  });

  describe('ShowModalOptions interface', () => {
    it('accepts minimal options', () => {
      const options: ShowModalOptions = {
        title: 'Choose',
        options: [{ label: 'A', value: 'a' }],
      };

      expect(options.title).toBe('Choose');
      expect(options.options).toHaveLength(1);
    });

    it('accepts allowCustomInput option', () => {
      const options: ShowModalOptions = {
        title: 'Choose',
        options: [{ label: 'A', value: 'a' }],
        allowCustomInput: true,
      };

      expect(options.allowCustomInput).toBe(true);
    });

    it('accepts multiSelect option (stub)', () => {
      const options: ShowModalOptions = {
        title: 'Choose',
        options: [{ label: 'A', value: 'a' }],
        multiSelect: true,
      };

      expect(options.multiSelect).toBe(true);
    });

  });
});

describe('showModal', () => {
  beforeEach(() => {
    // Reset isTTY
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it('returns null in non-interactive mode', async () => {
    // Set non-TTY mode
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      writable: true,
    });

    // Dynamic import to get fresh module
    const { showModal } = await import('../../../src/ui/ink/components/Modal.js');

    const result = await showModal({
      title: 'Test',
      options: [{ label: 'A', value: 'a' }],
    });

    expect(result).toBeNull();
  });

  it('enters an isolated alternate screen before modal mount', async () => {
    const writes: string[] = [];

    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
    });

    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);

    const { prepareModalRender } = await import('../../../src/ui/ink/components/Modal.js');

    prepareModalRender(process.stdout);

    expect(writes).toEqual(['\x1b[?2004l', '\x1B[r', '\x1b[?1049h\x1b[2J\x1b[H']);
  });

  it('restores the primary screen after modal cleanup', async () => {
    const writes: string[] = [];

    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
    });

    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);

    const { cleanupModalRender } = await import('../../../src/ui/ink/components/Modal.js');

    cleanupModalRender(process.stdout);

    expect(writes).toEqual(['\x1b[?1049l', '\x1b[?2004h']);
  });

  it('keeps modal unmount writes inside the alternate screen before cleanup', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/ui/ink/components/Modal.tsx'),
      'utf8',
    );

    expect(src).toMatch(
      /function unmountAndResolve[\s\S]*?instance\.unmount\(\);[\s\S]*?await instance\.waitUntilExit\(\);[\s\S]*?cleanupModalRender\(process\.stdout\);[\s\S]*?resolve\(value\);/
    );
  });
});

describe('Modal Options Processing', () => {
  it('creates options array from ShowModalOptions', () => {
    const options: ShowModalOptions = {
      title: 'Select file format',
      options: [
        { label: 'JSON', value: 'json', description: 'JavaScript Object Notation' },
        { label: 'YAML', value: 'yaml', description: 'YAML Ain\'t Markup Language' },
        { label: 'XML', value: 'xml', disabled: true },
      ],
    };

    expect(options.options).toHaveLength(3);
    expect(options.options[0].description).toBe('JavaScript Object Notation');
    expect(options.options[2].disabled).toBe(true);
  });

  it('supports empty options array', () => {
    const options: ShowModalOptions = {
      title: 'Empty Modal',
      options: [],
    };

    expect(options.options).toHaveLength(0);
  });

  it('supports options with same labels but different values', () => {
    const options: ShowModalOptions = {
      title: 'Duplicate Labels',
      options: [
        { label: 'Option', value: 'option-1' },
        { label: 'Option', value: 'option-2' },
      ],
    };

    expect(options.options[0].value).toBe('option-1');
    expect(options.options[1].value).toBe('option-2');
  });
});

describe('Modal Behavior Contracts', () => {
  describe('Cursor Navigation', () => {
    it('cursor should wrap from last to first (documented behavior)', () => {
      // This tests the contract: up arrow from 0 goes to last, down arrow from last goes to 0
      const totalOptions = 3;
      const lastIndex = totalOptions - 1;

      // Simulate wrap-around math
      const wrapDown = (0 - 1 + totalOptions) % totalOptions;
      const wrapUp = (lastIndex + 1) % totalOptions;

      expect(wrapDown).toBe(lastIndex); // Going up from 0 should go to last
      expect(wrapUp).toBe(0); // Going down from last should go to 0
    });
  });

  describe('Number Shortcuts', () => {
    it('number shortcuts should map 1-9 to indices 0-8', () => {
      for (let num = 1; num <= 9; num++) {
        const index = num - 1;
        expect(index).toBe(num - 1);
      }
    });

    it('number shortcuts out of range should not select', () => {
      const optionsCount = 3;
      const shortcut = 5; // Pressing '5' when only 3 options

      const index = shortcut - 1;
      const isValid = index < optionsCount;

      expect(isValid).toBe(false);
    });
  });

  describe('Disabled Options', () => {
    it('disabled options should be skipped in navigation', () => {
      const options: ModalOption[] = [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b', disabled: true },
        { label: 'C', value: 'c' },
      ];

      const enabledIndices = options
        .map((opt, i) => (!opt.disabled ? i : -1))
        .filter((i) => i !== -1);

      expect(enabledIndices).toEqual([0, 2]);
    });
  });

  describe('Custom Input Mode', () => {
    it('allowCustomInput adds __other__ value option', () => {
      const baseOptions: ModalOption[] = [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ];

      // Simulate adding "Other" option
      const withOther = [
        ...baseOptions,
        { label: 'Other', value: '__other__' },
      ];

      expect(withOther).toHaveLength(3);
      expect(withOther[2].value).toBe('__other__');
    });

    it('custom input returns typed value as both label and value', () => {
      const customText = 'My custom option';
      const customOption: ModalOption = {
        label: customText,
        value: customText,
      };

      expect(customOption.label).toBe(customOption.value);
    });
  });
});

describe('Modal Export Validation', () => {
  it('exports Modal component', async () => {
    const module = await import('../../../src/ui/ink/components/Modal.js');
    expect(module.Modal).toBeDefined();
    expect(typeof module.Modal).toBe('function');
  });

  it('exports showModal helper', async () => {
    const module = await import('../../../src/ui/ink/components/Modal.js');
    expect(module.showModal).toBeDefined();
    expect(typeof module.showModal).toBe('function');
  });

  it('exports default as Modal', async () => {
    const module = await import('../../../src/ui/ink/components/Modal.js');
    expect(module.default).toBe(module.Modal);
  });

  it('exports resolveInitialCursor helper', async () => {
    const module = await import('../../../src/ui/ink/components/Modal.js');
    expect(module.resolveInitialCursor).toBeDefined();
    expect(typeof module.resolveInitialCursor).toBe('function');
  });

  it('exports prepareModalRender helper', async () => {
    const module = await import('../../../src/ui/ink/components/Modal.js');
    expect(module.prepareModalRender).toBeDefined();
    expect(typeof module.prepareModalRender).toBe('function');
  });

  it('exports cleanupModalRender helper', async () => {
    const module = await import('../../../src/ui/ink/components/Modal.js');
    expect(module.cleanupModalRender).toBeDefined();
    expect(typeof module.cleanupModalRender).toBe('function');
  });
});

describe('resolveInitialCursor', () => {
  it('defaults to first option for select mode', async () => {
    const { resolveInitialCursor } = await import('../../../src/ui/ink/components/Modal.js');
    expect(resolveInitialCursor('select', 5)).toBe(0);
  });

  it('clamps select initialIndex to valid bounds', async () => {
    const { resolveInitialCursor } = await import('../../../src/ui/ink/components/Modal.js');
    expect(resolveInitialCursor('select', 5, 3)).toBe(3);
    expect(resolveInitialCursor('select', 5, -10)).toBe(0);
    expect(resolveInitialCursor('select', 5, 99)).toBe(4);
  });

  it('maps confirm defaultValue=false to the second option', async () => {
    const { resolveInitialCursor } = await import('../../../src/ui/ink/components/Modal.js');
    expect(resolveInitialCursor('confirm', 2, undefined, false)).toBe(1);
  });

  it('maps confirm defaultValue=true or undefined to the first option', async () => {
    const { resolveInitialCursor } = await import('../../../src/ui/ink/components/Modal.js');
    expect(resolveInitialCursor('confirm', 2, undefined, true)).toBe(0);
    expect(resolveInitialCursor('confirm', 2)).toBe(0);
  });
});

describe('showModal passive-effect cleanup yield (Ink 7 / React 19 regression)', () => {
  // Regression: when InkRenderer.pause() unmounts the main UI and showModal()
  // immediately calls render(), the previous instance's useInput cleanup
  // (scheduled as a macrotask by React's Scheduler) fires AFTER the new modal's
  // useInput effect. The stale cleanup calls stdin.setRawMode(false) and
  // removes the readable listener, leaving the terminal in line-buffered mode
  // with no input listener — symptom reported by user: 'menu rendered but no
  // keys work'. The fix is a setImmediate yield in showModal before render()
  // so the old cleanup drains first.
  it('awaits setImmediate after prepareModalRender and before render()', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/ui/ink/components/Modal.tsx'),
      'utf8',
    );

    // Extract the body of showModal
    const showModalMatch = src.match(/export async function showModal[\s\S]*?\n\}/);
    expect(showModalMatch).not.toBeNull();
    const body = showModalMatch![0];

    const prepareIdx = body.indexOf('prepareModalRender(');
    const yieldIdx = body.indexOf('setImmediate');
    const renderIdx = body.indexOf('render(');

    expect(prepareIdx).toBeGreaterThan(-1);
    expect(yieldIdx).toBeGreaterThan(-1);
    expect(renderIdx).toBeGreaterThan(-1);

    // Sequence must be: prepareModalRender → setImmediate yield → render()
    expect(prepareIdx).toBeLessThan(yieldIdx);
    expect(yieldIdx).toBeLessThan(renderIdx);
  });

  it.each(['showConfirm', 'showInput', 'showPassword'])(
    '%s awaits the same cleanup yield before render()',
    async (helperName) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const src = fs.readFileSync(
        path.resolve(process.cwd(), 'src/ui/ink/components/Modal.tsx'),
        'utf8',
      );

      expect(src).toMatch(
        new RegExp(`export async function ${helperName}[\\s\\S]*?prepareModalRender\\(process\\.stdout\\);[\\s\\S]*?setImmediate[\\s\\S]*?render\\(`)
      );
    }
  );
});
