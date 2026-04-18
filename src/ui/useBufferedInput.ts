/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * useBufferedInput - Ink hook for buffered stdin input handling
 *
 * This hook wraps Ink's useInput with StdinBuffer to properly handle
 * partial escape sequences that arrive in chunks. This prevents issues
 * with Kitty keyboard protocol and other escape sequences being split
 * across multiple stdin reads.
 *
 * IMPORTANT: This hook is designed to work alongside Ink's useInput.
 * It provides additional sequence type information and Kitty protocol
 * event data that the standard useInput doesn't provide.
 */
import { useEffect, useCallback, useRef } from 'react';
import { useStdin } from 'ink';
import { StdinBuffer, type SequenceEvent } from './StdinBuffer.js';
import type { Key as InkKey } from 'ink';

export interface BufferedKeyInfo {
  /** The input character or escape sequence */
  input: string;
  /** Ink-compatible key info */
  key: InkKey;
  /** Raw sequence type (for advanced handling) */
  sequenceType?: 'printable' | 'csi' | 'osc' | 'paste';
  /** Kitty key event data (if available) */
  kittyEvent?: {
    key: number;
    modifiers: number;
    text?: string;
  };
}

export interface UseBufferedInputOptions {
  /** Handler for buffered input events */
  onInput: (input: string, key: InkKey, info?: BufferedKeyInfo) => void;
  /** Whether input handling is active */
  isActive?: boolean;
  /** Timeout for flushing incomplete sequences (ms) */
  flushTimeout?: number;
}

/**
 * Parse a CSI sequence to extract key information
 */
function parseCSISequence(sequence: string): Partial<InkKey> {
  // CSI sequences: ESC [ ... <final byte>
  // Kitty key events: ESC [ <key> ; <modifiers> [u~]
  
  // Check for Kitty keyboard protocol event
  const kittyMatch = sequence.match(/^\x1b\[(\d+)(?::(\d+))?([u~])$/);
  if (kittyMatch) {
    const keyCode = parseInt(kittyMatch[1], 10);
    const modifiers = kittyMatch[2] ? parseInt(kittyMatch[2], 10) : 0;
    
    // Map Kitty key codes to Ink key properties
    const key: Partial<InkKey> = {
      ctrl: (modifiers & 0x04) !== 0,
      meta: (modifiers & 0x08) !== 0,
      shift: (modifiers & 0x01) !== 0,
    };
    
    // Map key codes to key names
    // See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
    switch (keyCode) {
      case 1: key.return = true; break;      // Enter
      case 2: key.tab = true; break;         // Tab
      case 3: key.escape = true; break;      // Escape
      case 8: key.backspace = true; break;   // Backspace
      case 9: key.tab = true; break;         // Tab
      case 13: key.return = true; break;     // Enter
      case 27: key.escape = true; break;     // Escape
      case 127: key.backspace = true; break; // Backspace
      case 57358: key.upArrow = true; break; // Up
      case 57359: key.downArrow = true; break; // Down
      case 57360: key.leftArrow = true; break; // Left
      case 57361: key.rightArrow = true; break; // Right
      case 57368: key.delete = true; break;  // Delete
      case 57369: key.delete = true; break;  // Delete
    }
    
    return key;
  }
  
  // Standard CSI sequences
  if (sequence === '\x1b[A' || sequence === '\x1bOA') {
    return { upArrow: true };
  }
  if (sequence === '\x1b[B' || sequence === '\x1bOB') {
    return { downArrow: true };
  }
  if (sequence === '\x1b[D' || sequence === '\x1bOD') {
    return { leftArrow: true };
  }
  if (sequence === '\x1b[C' || sequence === '\x1bOC') {
    return { rightArrow: true };
  }
  if (sequence === '\x1b[3~') {
    return { delete: true };
  }
  if (sequence === '\x1b[Z') {
    return { tab: true, shift: true };
  }
  
  return {};
}

/**
 * Convert a SequenceEvent to Ink-compatible input/key pair
 */
function sequenceToInkInput(event: SequenceEvent): BufferedKeyInfo {
  const key: InkKey = {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    ctrl: false,
    meta: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
  };
  
  let input = '';
  let sequenceType: BufferedKeyInfo['sequenceType'] = 'printable';
  let kittyEvent: BufferedKeyInfo['kittyEvent'] | undefined;
  
  switch (event.type) {
    case 'printable':
      input = event.data;
      sequenceType = 'printable';
      break;
      
    case 'csi':
      input = event.data;
      sequenceType = 'csi';
      Object.assign(key, parseCSISequence(event.data));
      
      // Extract Kitty event if present
      const kittyMatch = event.data.match(/^\x1b\[(\d+)(?::(\d+))?([u~])$/);
      if (kittyMatch) {
        kittyEvent = {
          key: parseInt(kittyMatch[1], 10),
          modifiers: kittyMatch[2] ? parseInt(kittyMatch[2], 10) : 0,
        };
      }
      break;
      
    case 'osc':
      input = event.data;
      sequenceType = 'osc';
      break;
      
    case 'paste':
      input = event.data;
      sequenceType = 'paste';
      break;
  }
  
  return { input, key, sequenceType, kittyEvent };
}

/**
 * Hook for buffered stdin input handling with escape sequence support.
 *
 * This hook provides enhanced input handling that properly handles partial
 * escape sequences by buffering stdin data until complete sequences are received.
 *
 * Note: This hook is designed to supplement Ink's useInput, not replace it.
 * For most use cases, use Ink's useInput directly. Use this hook when you need:
 * - Detection of partial escape sequences
 * - Kitty keyboard protocol event details
 * - Paste event detection
 *
 * @example
 * ```tsx
 * // Use alongside useInput for enhanced detection
 * useBufferedInput({
 *   onInput: (input, key, info) => {
 *     if (info?.kittyEvent) {
 *       // Handle Kitty keyboard protocol event with full details
 *       console.log('Kitty key:', info.kittyEvent.key, 'modifiers:', info.kittyEvent.modifiers);
 *     }
 *   },
 *   isActive: true
 * });
 * ```
 */
export function useBufferedInput(options: UseBufferedInputOptions): void {
  const { onInput, isActive = true, flushTimeout = 50 } = options;
  const { stdin } = useStdin();
  const bufferRef = useRef<StdinBuffer | null>(null);
  const onInputRef = useRef(onInput);
  
  // Keep onInput ref updated
  useEffect(() => {
    onInputRef.current = onInput;
  }, [onInput]);
  
  // Create and manage the StdinBuffer
  useEffect(() => {
    if (!stdin || !isActive) {
      return;
    }
    
    const buffer = new StdinBuffer(stdin, flushTimeout);
    bufferRef.current = buffer;
    
    // Handle sequence events from the buffer
    const handleSequence = (event: SequenceEvent) => {
      const info = sequenceToInkInput(event);
      onInputRef.current(info.input, info.key, info);
    };
    
    buffer.on('sequence', handleSequence);
    
    return () => {
      buffer.destroy();
      bufferRef.current = null;
    };
  }, [stdin, isActive, flushTimeout]);
}

/**
 * Create a stable input handler that doesn't change on every render.
 * This is useful for preventing unnecessary re-renders in Ink components.
 */
export function useStableInputHandler(
  handler: (input: string, key: InkKey, info?: BufferedKeyInfo) => void
): (input: string, key: InkKey, info?: BufferedKeyInfo) => void {
  const handlerRef = useRef(handler);
  
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  
  return useCallback((input: string, key: InkKey, info?: BufferedKeyInfo) => {
    handlerRef.current(input, key, info);
  }, []);
}

/**
 * Check if stdin supports buffered input (has proper TTY).
 * Returns false if stdin is not a TTY or is already in raw mode.
 */
export function canUseBufferedInput(): boolean {
  return process.stdin.isTTY === true;
}

/**
 * Get the current buffer content (for debugging).
 */
export function getBufferContent(buffer: StdinBuffer | null): string {
  return buffer?.getBuffer() ?? '';
}