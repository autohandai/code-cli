/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cc, metadata } from '../../src/commands/cc.js';

describe('/cc command', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('metadata', () => {
    it('has correct command name', () => {
      expect(metadata.command).toBe('/cc');
    });

    it('has description', () => {
      expect(metadata.description).toContain('context compaction');
    });

    it('is marked as implemented', () => {
      expect(metadata.implemented).toBe(true);
    });
  });

  describe('cc function', () => {
    it('returns null when context methods are not available', async () => {
      const ctx = {};
      const result = await cc(ctx);

      expect(result).toBeNull();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('not available')
      );
    });

    it('returns null when toggleContextCompaction is undefined', async () => {
      const ctx = {
        isContextCompactionEnabled: () => true,
      };
      const result = await cc(ctx);

      expect(result).toBeNull();
    });

    it('returns null when isContextCompactionEnabled is undefined', async () => {
      const ctx = {
        toggleContextCompaction: () => {},
      };
      const result = await cc(ctx);

      expect(result).toBeNull();
    });

    it('calls toggleContextCompaction', async () => {
      const toggleFn = vi.fn();
      const ctx = {
        toggleContextCompaction: toggleFn,
        isContextCompactionEnabled: () => true,
      };

      await cc(ctx);

      expect(toggleFn).toHaveBeenCalledTimes(1);
    });

    it('shows enabled status after toggling on', async () => {
      const ctx = {
        toggleContextCompaction: vi.fn(),
        isContextCompactionEnabled: () => true,
      };

      await cc(ctx);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('enabled')
      );
    });

    it('shows disabled status after toggling off', async () => {
      const ctx = {
        toggleContextCompaction: vi.fn(),
        isContextCompactionEnabled: () => false,
      };

      await cc(ctx);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('disabled')
      );
    });

    it('shows warning note when disabled', async () => {
      const ctx = {
        toggleContextCompaction: vi.fn(),
        isContextCompactionEnabled: () => false,
      };

      await cc(ctx);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('context too long')
      );
    });

    it('shows threshold info when enabled', async () => {
      const ctx = {
        toggleContextCompaction: vi.fn(),
        isContextCompactionEnabled: () => true,
      };

      await cc(ctx);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('70%/80%/90%')
      );
    });

    it('returns null after successful toggle', async () => {
      const ctx = {
        toggleContextCompaction: vi.fn(),
        isContextCompactionEnabled: () => true,
      };

      const result = await cc(ctx);

      expect(result).toBeNull();
    });
  });
});
