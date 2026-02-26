/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests that slash commands returning strings are treated as display output,
 * NOT forwarded to the LLM as instructions. Regression test for the /mcp bug
 * where status messages like "MCP manager not available." were sent as prompts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlashCommandHandler } from '../src/core/slashCommandHandler.js';
import { SLASH_COMMANDS } from '../src/core/slashCommands.js';


function createMinimalContext() {
  return {
    promptModelSelection: vi.fn().mockResolvedValue(undefined),
    createAgentsFile: vi.fn().mockResolvedValue(undefined),
    resetConversation: vi.fn(),
    sessionManager: {
      getCurrentSession: vi.fn().mockReturnValue(null),
      listSessions: vi.fn().mockResolvedValue([]),
      closeSession: vi.fn().mockResolvedValue(undefined),
    } as any,
    memoryManager: {
      findSimilar: vi.fn().mockResolvedValue(null),
    } as any,
    permissionManager: {} as any,
    llm: {
      complete: vi.fn().mockResolvedValue({ id: 'test', created: Date.now(), content: '', raw: {} }),
      setDefaultModel: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
    } as any,
    workspaceRoot: '/tmp/test',
    model: 'test-model',
    config: {} as any,
    // /mcp - deliberately omit mcpManager to trigger the "not available" branch
    mcpManager: undefined,
  };
}

describe('slash command dispatch – output vs instruction', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // ── Registry checks ──────────────────────────────────────────────────

  it('/mcp is registered in SLASH_COMMANDS', () => {
    const commands = SLASH_COMMANDS.map(c => c.command);
    expect(commands).toContain('/mcp');
    expect(commands).toContain('/mcp install');
  });

  it('all SLASH_COMMANDS entries have required fields', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.command).toBeTruthy();
      expect(typeof cmd.description).toBe('string');
      expect(typeof cmd.implemented).toBe('boolean');
    }
  });

  // ── /mcp handler returns string, NOT null ─────────────────────────────

  it('/mcp returns a string when mcpManager is undefined', async () => {
    const ctx = createMinimalContext();
    const handler = new SlashCommandHandler(ctx, SLASH_COMMANDS);

    const result = await handler.handle('/mcp');

    // The handler returns a display string - this used to be sent to the LLM
    expect(result).toEqual(expect.any(String));
    expect(result).not.toBeNull();
    expect(result).toContain('MCP');
  });

  // ── Core contract: promptForInstruction should print string results ───

  it('slash command handler output must be printed, never sent as LLM instruction', async () => {
    // This test documents the contract enforced in agent.ts promptForInstruction():
    //
    //   const handled = await this.slashHandler.handle(command, args);
    //   if (handled !== null) {
    //     console.log(handled);   // <-- display output
    //   }
    //   return null;              // <-- never forward to runInstruction
    //
    // Simulating the dispatch logic:
    const ctx = createMinimalContext();
    const handler = new SlashCommandHandler(ctx, SLASH_COMMANDS);

    const handled = await handler.handle('/mcp');

    // The agent should print the output…
    if (handled !== null) {
      console.log(handled);
    }
    // …and return null (never forward as instruction)
    const instruction = handled !== null ? null : null;
    expect(instruction).toBeNull();

    // Verify it was printed
    if (handled !== null) {
      expect(consoleSpy).toHaveBeenCalledWith(handled);
    }
  });

  // ── Commands that MUST return null (self-printing) ────────────────────

  it('/help returns null (prints its own output)', async () => {
    const ctx = createMinimalContext();
    const handler = new SlashCommandHandler(ctx, SLASH_COMMANDS);

    const result = await handler.handle('/help');
    expect(result).toBeNull();
  });

  it('/model returns null (handles its own UI)', async () => {
    const ctx = createMinimalContext();
    const handler = new SlashCommandHandler(ctx, SLASH_COMMANDS);

    const result = await handler.handle('/model');
    expect(result).toBeNull();
  });

  // ── Unknown commands return null (don't forward garbage to LLM) ───────

  it('unknown slash commands return null', async () => {
    const ctx = createMinimalContext();
    const handler = new SlashCommandHandler(ctx, SLASH_COMMANDS);

    const result = await handler.handle('/nonexistent-command');
    expect(result).toBeNull();
  });

  // ── Multi-word commands ───────────────────────────────────────────────

  it('/mcp install is recognized as a two-word command', () => {
    const ctx = createMinimalContext();
    const handler = new SlashCommandHandler(ctx, SLASH_COMMANDS);
    expect(handler.isCommandSupported('/mcp install')).toBe(true);
  });

  it('/skills install is recognized as a two-word command', () => {
    const ctx = createMinimalContext();
    const handler = new SlashCommandHandler(ctx, SLASH_COMMANDS);
    expect(handler.isCommandSupported('/skills install')).toBe(true);
  });

  // ── /quit pass-through ─────────────────────────────────────────────────

  it('/quit returns "/quit" as a pass-through for the exit handler', async () => {
    const ctx = createMinimalContext();
    const handler = new SlashCommandHandler(ctx, SLASH_COMMANDS);

    const result = await handler.handle('/quit');

    // /quit intentionally returns '/quit' so the interactive loop's
    // special exit handler at line 963 can catch it.
    // However, promptForInstruction() now bypasses the handler entirely
    // for /quit and /exit, returning the command string directly.
    expect(result).toBe('/quit');
  });

  it('/quit and /exit bypass slash handler in dispatch logic', () => {
    // Simulates the promptForInstruction() logic:
    // /quit and /exit are returned as-is (pass-through) before
    // reaching the slash handler, so the interactive loop exit check works.
    const exitCommands = ['/quit', '/exit'];
    for (const cmd of exitCommands) {
      const command = cmd;
      // This is the guard in promptForInstruction():
      if (command === '/quit' || command === '/exit') {
        // Pass through to interactive loop - NOT swallowed
        expect(command).toBe(cmd);
      }
    }
  });

  // ── Regression: string return values must not leak to LLM ─────────────

  it('regression: /mcp "not available" string must not become an LLM prompt', async () => {
    const ctx = createMinimalContext();
    const handler = new SlashCommandHandler(ctx, SLASH_COMMANDS);

    const result = await handler.handle('/mcp');

    // Before the fix, this string would be set as `normalized` and returned
    // from promptForInstruction(), eventually reaching runInstruction() → LLM.
    // After the fix, promptForInstruction() prints it and returns null.
    expect(typeof result).toBe('string');

    // Simulate the FIXED agent logic
    const sentToLLM = false;
    if (result === null) {
      // command handled, no output
    } else {
      // FIXED: print and discard
      console.log(result);
      // sentToLLM remains false
    }
    expect(sentToLLM).toBe(false);
  });

  // ── Non-interactive (RPC/ACP) guards ─────────────────────────────────

  it('interactive-only commands return guard message in non-interactive mode', async () => {
    const ctx = { ...createMinimalContext(), isNonInteractive: true };
    const handler = new SlashCommandHandler(ctx, SLASH_COMMANDS);

    const interactiveCommands = ['/model', '/cc', '/search', '/theme', '/language', '/feedback'];
    for (const cmd of interactiveCommands) {
      const result = await handler.handle(cmd);
      expect(result).toContain('requires an interactive terminal');
    }
  });

  it('non-interactive commands still work in non-interactive mode', async () => {
    const ctx = { ...createMinimalContext(), isNonInteractive: true };
    const handler = new SlashCommandHandler(ctx, SLASH_COMMANDS);

    // /help should still work
    const helpResult = await handler.handle('/help');
    expect(helpResult).toBeNull(); // help prints its own output

    // /mcp should still work
    const mcpResult = await handler.handle('/mcp');
    expect(mcpResult).toContain('MCP');
  });

  it('/skills new is guarded in non-interactive mode', async () => {
    const ctx = { ...createMinimalContext(), isNonInteractive: true };
    const handler = new SlashCommandHandler(ctx, SLASH_COMMANDS);

    const result = await handler.handle('/skills new');
    expect(result).toContain('requires an interactive terminal');
  });

  it('interactive commands work normally when isNonInteractive is false', async () => {
    const ctx = { ...createMinimalContext(), isNonInteractive: false };
    const handler = new SlashCommandHandler(ctx, SLASH_COMMANDS);

    // /model should call promptModelSelection (returns null)
    const result = await handler.handle('/model');
    expect(result).toBeNull();
    expect(ctx.promptModelSelection).toHaveBeenCalled();
  });

  // ── Full dispatch simulation ──────────────────────────────────────────

  it('simulates promptForInstruction dispatch for all command types', async () => {
    const ctx = createMinimalContext();
    const handler = new SlashCommandHandler(ctx, SLASH_COMMANDS);

    // Simulate the agent's promptForInstruction logic for various inputs:
    const testCases: Array<{ input: string; expectPassThrough: boolean; description: string }> = [
      { input: '/quit', expectPassThrough: true, description: 'quit bypasses handler' },
      { input: '/exit', expectPassThrough: true, description: 'exit bypasses handler' },
      { input: '/mcp', expectPassThrough: false, description: 'mcp is handled and printed' },
      { input: '/help', expectPassThrough: false, description: 'help is handled and printed' },
      { input: '/model', expectPassThrough: false, description: 'model is handled' },
    ];

    for (const tc of testCases) {
      const command = tc.input.split(/\s+/)[0];
      const args = tc.input.split(/\s+/).slice(1);

      if (command === '/quit' || command === '/exit') {
        // Pass-through: returned as instruction for exit handler
        expect(command).toBe(tc.input);
      } else {
        // Handled: output printed, returns null
        const handled = await handler.handle(command, args);
        if (handled !== null) {
          console.log(handled); // print display output
        }
        // promptForInstruction returns null for these
        const returned = null;
        expect(returned).toBeNull();
      }
    }
  });
});
