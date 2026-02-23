/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPermissionBridge } from '../../../src/modes/acp/permissions.js';
import type { AgentSideConnection, RequestPermissionResponse } from '@agentclientprotocol/sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnection(overrides: Partial<AgentSideConnection> = {}): AgentSideConnection {
  return {
    requestPermission: vi.fn(),
    sessionUpdate: vi.fn(),
    ...overrides,
  } as unknown as AgentSideConnection;
}

function makeAllowResponse(): RequestPermissionResponse {
  return {
    outcome: {
      outcome: 'selected',
      optionId: 'allow',
    },
  } as RequestPermissionResponse;
}

function makeAlwaysAllowResponse(): RequestPermissionResponse {
  return {
    outcome: {
      outcome: 'selected',
      optionId: 'allow_always',
    },
  } as RequestPermissionResponse;
}

function makeDenyResponse(): RequestPermissionResponse {
  return {
    outcome: {
      outcome: 'selected',
      optionId: 'deny',
    },
  } as RequestPermissionResponse;
}

function makeCancelledResponse(): RequestPermissionResponse {
  return {
    outcome: {
      outcome: 'cancelled',
    },
  } as RequestPermissionResponse;
}

// ===========================================================================
// createPermissionBridge
// ===========================================================================

describe('createPermissionBridge', () => {
  let connection: AgentSideConnection;

  beforeEach(() => {
    connection = makeConnection();
    vi.clearAllMocks();
  });

  it('returns an object with confirmAction and setMode functions', () => {
    const bridge = createPermissionBridge({
      connection,
      sessionId: 'sess-1',
      modeId: 'interactive',
    });

    expect(typeof bridge.confirmAction).toBe('function');
    expect(typeof bridge.setMode).toBe('function');
  });

  // -------------------------------------------------------------------------
  // Auto-approve modes
  // -------------------------------------------------------------------------

  describe('auto-approve modes', () => {
    it('mode "unrestricted" auto-approves (returns true)', async () => {
      const bridge = createPermissionBridge({
        connection,
        sessionId: 'sess-1',
        modeId: 'unrestricted',
      });

      const result = await bridge.confirmAction('Delete all files?', { tool: 'delete_path' });

      expect(result).toBe(true);
      expect(connection.requestPermission).not.toHaveBeenCalled();
    });

    it('mode "full-access" auto-approves (returns true)', async () => {
      const bridge = createPermissionBridge({
        connection,
        sessionId: 'sess-1',
        modeId: 'full-access',
      });

      const result = await bridge.confirmAction('Run dangerous command', { tool: 'run_command' });

      expect(result).toBe(true);
      expect(connection.requestPermission).not.toHaveBeenCalled();
    });

    it('mode "auto-mode" auto-approves (returns true)', async () => {
      const bridge = createPermissionBridge({
        connection,
        sessionId: 'sess-1',
        modeId: 'auto-mode',
      });

      const result = await bridge.confirmAction('Write file', { tool: 'write_file' });

      expect(result).toBe(true);
      expect(connection.requestPermission).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Auto-deny modes
  // -------------------------------------------------------------------------

  describe('auto-deny modes', () => {
    it('mode "restricted" auto-denies (returns false)', async () => {
      const bridge = createPermissionBridge({
        connection,
        sessionId: 'sess-1',
        modeId: 'restricted',
      });

      const result = await bridge.confirmAction('Delete path?', { tool: 'delete_path' });

      expect(result).toBe(false);
      expect(connection.requestPermission).not.toHaveBeenCalled();
    });

    it('mode "dry-run" auto-denies (returns false)', async () => {
      const bridge = createPermissionBridge({
        connection,
        sessionId: 'sess-1',
        modeId: 'dry-run',
      });

      const result = await bridge.confirmAction('Apply patch', { tool: 'apply_patch' });

      expect(result).toBe(false);
      expect(connection.requestPermission).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Interactive mode
  // -------------------------------------------------------------------------

  describe('interactive mode', () => {
    it('calls connection.requestPermission and returns true for "allow" outcome', async () => {
      (connection.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAllowResponse()
      );

      const bridge = createPermissionBridge({
        connection,
        sessionId: 'sess-1',
        modeId: 'interactive',
      });

      const result = await bridge.confirmAction('Run npm install?', {
        tool: 'run_command',
        command: 'npm install',
      });

      expect(result).toBe(true);
      expect(connection.requestPermission).toHaveBeenCalledTimes(1);

      const callArg = (connection.requestPermission as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArg.sessionId).toBe('sess-1');
      expect(callArg.toolCall.kind).toBe('execute');
      expect(callArg.options).toHaveLength(3);
    });

    it('returns true for "allow_always" outcome', async () => {
      (connection.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAlwaysAllowResponse()
      );

      const bridge = createPermissionBridge({
        connection,
        sessionId: 'sess-1',
        modeId: 'interactive',
      });

      const result = await bridge.confirmAction('Write file?', { tool: 'write_file' });

      expect(result).toBe(true);
    });

    it('returns false for "deny" outcome', async () => {
      (connection.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeDenyResponse()
      );

      const bridge = createPermissionBridge({
        connection,
        sessionId: 'sess-1',
        modeId: 'interactive',
      });

      const result = await bridge.confirmAction('Delete file?', { tool: 'delete_path' });

      expect(result).toBe(false);
    });

    it('returns false for cancelled outcome', async () => {
      (connection.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeCancelledResponse()
      );

      const bridge = createPermissionBridge({
        connection,
        sessionId: 'sess-1',
        modeId: 'interactive',
      });

      const result = await bridge.confirmAction('Rename path?', { tool: 'rename_path' });

      expect(result).toBe(false);
    });

    it('passes path context to locations when provided', async () => {
      (connection.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAllowResponse()
      );

      const bridge = createPermissionBridge({
        connection,
        sessionId: 'sess-1',
        modeId: 'interactive',
      });

      await bridge.confirmAction('Delete?', {
        tool: 'delete_path',
        path: '/workspace/src/old.ts',
      });

      const callArg = (connection.requestPermission as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArg.toolCall.locations).toEqual([{ path: '/workspace/src/old.ts' }]);
    });
  });

  // -------------------------------------------------------------------------
  // Permission request failure
  // -------------------------------------------------------------------------

  describe('permission request failure', () => {
    it('returns false when requestPermission throws (safety default)', async () => {
      (connection.requestPermission as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection lost')
      );

      // Suppress stderr output from the error handler
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const bridge = createPermissionBridge({
        connection,
        sessionId: 'sess-1',
        modeId: 'interactive',
      });

      const result = await bridge.confirmAction('Run command?', { tool: 'run_command' });

      expect(result).toBe(false);

      stderrSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // setMode()
  // -------------------------------------------------------------------------

  describe('setMode()', () => {
    it('changes behavior of subsequent confirmAction calls', async () => {
      const bridge = createPermissionBridge({
        connection,
        sessionId: 'sess-1',
        modeId: 'interactive',
      });

      // Start in interactive mode - would need to call requestPermission
      (connection.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAllowResponse()
      );
      const result1 = await bridge.confirmAction('Action 1', { tool: 'run_command' });
      expect(result1).toBe(true);
      expect(connection.requestPermission).toHaveBeenCalledTimes(1);

      // Switch to unrestricted - should auto-approve without calling requestPermission
      bridge.setMode('unrestricted');
      const result2 = await bridge.confirmAction('Action 2', { tool: 'run_command' });
      expect(result2).toBe(true);
      expect(connection.requestPermission).toHaveBeenCalledTimes(1); // still 1, no new call

      // Switch to restricted - should auto-deny without calling requestPermission
      bridge.setMode('restricted');
      const result3 = await bridge.confirmAction('Action 3', { tool: 'delete_path' });
      expect(result3).toBe(false);
      expect(connection.requestPermission).toHaveBeenCalledTimes(1); // still 1
    });

    it('switches from auto-approve to interactive mode', async () => {
      (connection.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeDenyResponse()
      );

      const bridge = createPermissionBridge({
        connection,
        sessionId: 'sess-1',
        modeId: 'unrestricted',
      });

      // Auto-approve
      const result1 = await bridge.confirmAction('Action 1', { tool: 'run_command' });
      expect(result1).toBe(true);
      expect(connection.requestPermission).not.toHaveBeenCalled();

      // Switch to interactive
      bridge.setMode('interactive');
      const result2 = await bridge.confirmAction('Action 2', { tool: 'run_command' });
      expect(result2).toBe(false); // deny response from mock
      expect(connection.requestPermission).toHaveBeenCalledTimes(1);
    });
  });
});
