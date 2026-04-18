/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StdinBuffer } from '../../src/ui/StdinBuffer.js';

describe('StdinBuffer', () => {
  let buffer: StdinBuffer;

  beforeEach(() => {
    buffer = new StdinBuffer({ timeout: 10 });
  });

  afterEach(() => {
    buffer.destroy();
  });

  describe('printable characters', () => {
    it('should emit printable characters immediately', () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      buffer.process('hello');

      expect(onData).toHaveBeenCalledTimes(1);
      expect(onData).toHaveBeenCalledWith('hello');
    });

    it('should emit multiple printable character chunks', () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      buffer.process('hello');
      buffer.process(' ');
      buffer.process('world');

      expect(onData).toHaveBeenCalledTimes(3);
      expect(onData).toHaveBeenCalledWith('hello');
      expect(onData).toHaveBeenCalledWith(' ');
      expect(onData).toHaveBeenCalledWith('world');
    });
  });

  describe('CSI sequences', () => {
    it('should emit complete CSI sequences', () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      // CSI A = cursor up
      buffer.process('\x1b[A');

      expect(onData).toHaveBeenCalledTimes(1);
      expect(onData).toHaveBeenCalledWith('\x1b[A');
    });

    it('should buffer incomplete CSI sequences', () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      // Send partial sequence
      buffer.process('\x1b[');

      expect(onData).not.toHaveBeenCalled();
      expect(buffer.isEmpty()).toBe(false);
    });

    it('should emit CSI sequence when completed', () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      // Send partial sequence
      buffer.process('\x1b[');
      expect(onData).not.toHaveBeenCalled();

      // Complete the sequence
      buffer.process('A');

      expect(onData).toHaveBeenCalledTimes(1);
      expect(onData).toHaveBeenCalledWith('\x1b[A');
    });

    it('should handle CSI sequences with parameters', () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      // CSI 5 ; 3 H = move cursor to row 5, col 3
      buffer.process('\x1b[5;3H');

      expect(onData).toHaveBeenCalledTimes(1);
      expect(onData).toHaveBeenCalledWith('\x1b[5;3H');
    });

    it('should handle Kitty key events', () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      // Kitty key event: CSI 97 ; 1 : 1 u = 'a' with Shift, press event
      buffer.process('\x1b[97;1:1u');

      expect(onData).toHaveBeenCalledTimes(1);
      expect(onData).toHaveBeenCalledWith('\x1b[97;1:1u');
    });
  });

  describe('OSC sequences', () => {
    it('should emit complete OSC sequences with BEL terminator', () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      // OSC 0 ; title BEL = set window title
      buffer.process('\x1b]0;My Title\x07');

      expect(onData).toHaveBeenCalledTimes(1);
      expect(onData).toHaveBeenCalledWith('\x1b]0;My Title\x07');
    });

    it('should emit complete OSC sequences with ST terminator', () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      // OSC 0 ; title ST = set window title
      buffer.process('\x1b]0;My Title\x1b\\');

      expect(onData).toHaveBeenCalledTimes(1);
      expect(onData).toHaveBeenCalledWith('\x1b]0;My Title\x1b\\');
    });

    it('should buffer incomplete OSC sequences', () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      buffer.process('\x1b]0;My Title');

      expect(onData).not.toHaveBeenCalled();
      expect(buffer.isEmpty()).toBe(false);
    });
  });

  describe('bracketed paste', () => {
    it('should emit paste event for bracketed paste content', () => {
      const onPaste = vi.fn();
      buffer.on('paste', onPaste);

      // Bracketed paste: ESC [ 200 ~ content ESC [ 201 ~
      buffer.process('\x1b[200~pasted content\x1b[201~');

      expect(onPaste).toHaveBeenCalledTimes(1);
      expect(onPaste).toHaveBeenCalledWith('pasted content');
    });

    it('should buffer incomplete bracketed paste', () => {
      const onPaste = vi.fn();
      buffer.on('paste', onPaste);

      buffer.process('\x1b[200~pasted content');

      expect(onPaste).not.toHaveBeenCalled();
      expect(buffer.isEmpty()).toBe(false);
    });

    it('should emit paste event when completed', () => {
      const onPaste = vi.fn();
      buffer.on('paste', onPaste);

      buffer.process('\x1b[200~pasted');
      expect(onPaste).not.toHaveBeenCalled();

      buffer.process(' content\x1b[201~');

      expect(onPaste).toHaveBeenCalledTimes(1);
      expect(onPaste).toHaveBeenCalledWith('pasted content');
    });
  });

  describe('mixed content', () => {
    it('should handle printable chars followed by escape sequence', () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      buffer.process('hello\x1b[A');

      expect(onData).toHaveBeenCalledTimes(2);
      expect(onData).toHaveBeenCalledWith('hello');
      expect(onData).toHaveBeenCalledWith('\x1b[A');
    });

    it('should handle escape sequence followed by printable chars', () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      buffer.process('\x1b[Aworld');

      expect(onData).toHaveBeenCalledTimes(2);
      expect(onData).toHaveBeenCalledWith('\x1b[A');
      expect(onData).toHaveBeenCalledWith('world');
    });
  });

  describe('timeout', () => {
    it('should flush incomplete sequence on timeout', async () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      // Send incomplete sequence
      buffer.process('\x1b[');

      expect(onData).not.toHaveBeenCalled();

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(onData).toHaveBeenCalledTimes(1);
      expect(onData).toHaveBeenCalledWith('\x1b[');
    });
  });

  describe('destroy', () => {
    it('should stop processing after destroy', () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      buffer.destroy();
      buffer.process('hello');

      expect(onData).not.toHaveBeenCalled();
    });

    it('should clear timer on destroy', async () => {
      const onData = vi.fn();
      buffer.on('data', onData);

      // Start incomplete sequence (schedules timeout)
      buffer.process('\x1b[');

      // Destroy before timeout
      buffer.destroy();

      // Wait for what would have been timeout
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should not have been called
      expect(onData).not.toHaveBeenCalled();
    });
  });

  describe('getBuffer', () => {
    it('should return current buffer content', () => {
      buffer.process('\x1b[');
      expect(buffer.getBuffer()).toBe('\x1b[');
    });

    it('should return empty string when buffer is empty', () => {
      expect(buffer.getBuffer()).toBe('');
    });
  });

  describe('isEmpty', () => {
    it('should return true when buffer is empty', () => {
      expect(buffer.isEmpty()).toBe(true);
    });

    it('should return false when buffer has content', () => {
      buffer.process('\x1b[');
      expect(buffer.isEmpty()).toBe(false);
    });
  });
});