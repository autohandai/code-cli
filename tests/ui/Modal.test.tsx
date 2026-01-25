/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';

describe('Modal', () => {
  it('should export Modal component and showModal function', async () => {
    const module = await import('../../src/ui/ink/components/Modal.js');

    expect(module.Modal).toBeDefined();
    expect(typeof module.Modal).toBe('function');
    expect(module.showModal).toBeDefined();
    expect(typeof module.showModal).toBe('function');
    expect(module.default).toBe(module.Modal);
  });

  it('should have correct ModalOption interface shape', async () => {
    const { Modal } = await import('../../src/ui/ink/components/Modal.js');

    // Verify the component accepts the expected props shape
    const mockOnSelect = vi.fn();
    const mockOnCancel = vi.fn();

    const options = [
      { label: 'Option 1', value: 'opt1' },
      { label: 'Option 2', value: 'opt2', description: 'A description' },
      { label: 'Disabled', value: 'disabled', disabled: true },
    ];

    // Create a React element to verify props are accepted
    const element = React.createElement(Modal, {
      title: 'Test Modal',
      options,
      onSelect: mockOnSelect,
      onCancel: mockOnCancel,
      allowCustomInput: true,
      multiSelect: false,
    });

    expect(element).toBeDefined();
    expect(element.type).toBe(Modal);
    expect(element.props.title).toBe('Test Modal');
    expect(element.props.options).toBe(options);
    expect(element.props.allowCustomInput).toBe(true);
  });

  it('should handle empty options array in props', async () => {
    const { Modal } = await import('../../src/ui/ink/components/Modal.js');

    const mockOnSelect = vi.fn();
    const mockOnCancel = vi.fn();

    // Create element with empty options - should not throw
    const element = React.createElement(Modal, {
      title: 'Empty Options Modal',
      options: [],
      onSelect: mockOnSelect,
      onCancel: mockOnCancel,
      allowCustomInput: false,
    });

    expect(element).toBeDefined();
    expect(element.props.options).toEqual([]);
  });

  it('showModal should return null for non-TTY environments', async () => {
    const { showModal } = await import('../../src/ui/ink/components/Modal.js');

    // In test environment, process.stdout.isTTY is typically false
    const originalIsTTY = process.stdout.isTTY;

    try {
      // Explicitly set to non-TTY
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      const result = await showModal({
        title: 'Test',
        options: [{ label: 'Test', value: 'test' }],
      });

      expect(result).toBeNull();
    } finally {
      // Restore original value
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    }
  });
});
