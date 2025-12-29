/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * InkRenderer - Manages the Ink render instance and state updates
 * This provides an imperative API for the agent to control the UI
 */
import React from 'react';
import { render, type Instance } from 'ink';
import { AgentUI, createInitialUIState, type AgentUIState } from './AgentUI.js';
import type { ToolOutputEntry } from './ToolOutput.js';
import { ThemeProvider } from '../theme/ThemeContext.js';

export interface InkRendererOptions {
  onInstruction: (text: string) => void;
  onEscape: () => void;
  onCtrlC: () => void;
  enableQueueInput?: boolean;
}

/**
 * InkRenderer wraps the Ink render instance and provides
 * imperative methods to update the UI state from the agent.
 */
export class InkRenderer {
  private instance: Instance | null = null;
  private state: AgentUIState;
  private options: InkRendererOptions;
  private toolIdCounter = 0;

  constructor(options: InkRendererOptions) {
    this.options = options;
    this.state = createInitialUIState();
  }

  /**
   * Handle input changes from AgentUI to preserve across pause/resume
   */
  private handleInputChange = (input: string): void => {
    this.state = { ...this.state, currentInput: input };
  };

  /**
   * Start the Ink renderer
   */
  start(): void {
    if (this.instance) {
      return;
    }

    this.instance = render(
      <ThemeProvider>
        <AgentUI
          state={this.state}
          onInstruction={this.options.onInstruction}
          onEscape={this.options.onEscape}
          onCtrlC={this.options.onCtrlC}
          onInputChange={this.handleInputChange}
          enableQueueInput={this.options.enableQueueInput}
        />
      </ThemeProvider>,
      {
        // Ensure Ink handles stdin for input capture
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr
      }
    );
  }

  /**
   * Stop the Ink renderer and cleanup
   */
  stop(): void {
    if (this.instance) {
      this.instance.unmount();
      this.instance = null;
    }
  }

  /**
   * Update the UI state and re-render
   */
  private updateState(partial: Partial<AgentUIState>): void {
    this.state = { ...this.state, ...partial };
    this.rerender();
  }

  /**
   * Re-render with current state
   */
  private rerender(): void {
    if (!this.instance) {
      return;
    }

    this.instance.rerender(
      <ThemeProvider>
        <AgentUI
          state={this.state}
          onInstruction={this.options.onInstruction}
          onEscape={this.options.onEscape}
          onCtrlC={this.options.onCtrlC}
          onInputChange={this.handleInputChange}
          enableQueueInput={this.options.enableQueueInput}
        />
      </ThemeProvider>
    );
  }

  /**
   * Set working state (starts/stops the spinner)
   * When stopping work, captures elapsed/tokens as completion stats
   */
  setWorking(isWorking: boolean, status = ''): void {
    const updates: Partial<AgentUIState> = {
      isWorking,
      status,
      // Clear final response when starting new work
      finalResponse: isWorking ? null : this.state.finalResponse
    };

    // When stopping work, save completion stats from current elapsed/tokens
    if (!isWorking && (this.state.elapsed || this.state.tokens)) {
      updates.completionStats = {
        elapsed: this.state.elapsed || '0s',
        tokens: this.state.tokens || '0 tokens'
      };
    }

    // When starting new work, clear completion stats
    if (isWorking) {
      updates.completionStats = null;
    }

    this.updateState(updates);
  }

  /**
   * Update the status text
   */
  setStatus(status: string): void {
    this.updateState({ status });
  }

  /**
   * Update elapsed time display
   */
  setElapsed(elapsed: string): void {
    this.updateState({ elapsed });
  }

  /**
   * Update token count display
   */
  setTokens(tokens: string): void {
    this.updateState({ tokens });
  }

  /**
   * Add a tool output entry
   */
  addToolOutput(tool: string, success: boolean, output: string, thought?: string): void {
    const entry: ToolOutputEntry = {
      id: `tool-${++this.toolIdCounter}`,
      tool,
      success,
      output,
      timestamp: Date.now(),
      thought
    };
    this.updateState({
      toolOutputs: [...this.state.toolOutputs, entry]
    });
  }

  /**
   * Add multiple tool outputs at once (batched)
   */
  addToolOutputs(outputs: Array<{ tool: string; success: boolean; output: string; thought?: string }>): void {
    const entries: ToolOutputEntry[] = outputs.map((o, i) => ({
      id: `tool-${++this.toolIdCounter}`,
      tool: o.tool,
      success: o.success,
      output: o.output,
      timestamp: Date.now(),
      // Only show thought on first tool (to avoid repetition)
      thought: i === 0 ? o.thought : undefined
    }));
    this.updateState({
      toolOutputs: [...this.state.toolOutputs, ...entries]
    });
  }

  /**
   * Clear tool outputs
   */
  clearToolOutputs(): void {
    this.updateState({ toolOutputs: [] });
  }

  /**
   * Set thinking output
   */
  setThinking(thought: string | null): void {
    this.updateState({ thinking: thought });
  }

  /**
   * Pause input handling by stopping the renderer (preserves state)
   * Use this before external prompts that need stdin access
   */
  pause(): void {
    if (this.instance) {
      this.instance.unmount();
      this.instance = null;
    }
  }

  /**
   * Resume input handling by restarting the renderer with preserved state
   */
  resume(): void {
    if (!this.instance) {
      // Ensure stdin is restored to proper state after enquirer
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      // Clear line and move to new line for clean restart
      process.stdout.write('\n');

      this.instance = render(
        <ThemeProvider>
          <AgentUI
            state={this.state}
            onInstruction={this.options.onInstruction}
            onEscape={this.options.onEscape}
            onCtrlC={this.options.onCtrlC}
            onInputChange={this.handleInputChange}
            enableQueueInput={this.options.enableQueueInput}
          />
        </ThemeProvider>,
        {
          stdin: process.stdin,
          stdout: process.stdout,
          stderr: process.stderr
        }
      );
    }
  }

  /**
   * Add a queued instruction
   */
  addQueuedInstruction(instruction: string): void {
    this.updateState({
      queuedInstructions: [...this.state.queuedInstructions, instruction]
    });
  }

  /**
   * Remove and return the next queued instruction
   */
  dequeueInstruction(): string | undefined {
    const [next, ...rest] = this.state.queuedInstructions;
    if (next) {
      this.updateState({ queuedInstructions: rest });
    }
    return next;
  }

  /**
   * Check if there are queued instructions
   */
  hasQueuedInstructions(): boolean {
    return this.state.queuedInstructions.length > 0;
  }

  /**
   * Get the queue count
   */
  getQueueCount(): number {
    return this.state.queuedInstructions.length;
  }

  /**
   * Set the final response (displayed when not working)
   */
  setFinalResponse(response: string): void {
    this.updateState({ finalResponse: response });
  }

  /**
   * Clear all state for a new task
   */
  reset(): void {
    this.state = createInitialUIState();
    this.rerender();
  }

  /**
   * Get current state (for external access)
   */
  getState(): Readonly<AgentUIState> {
    return this.state;
  }
}

/**
 * Create an InkRenderer instance
 */
export function createInkRenderer(options: InkRendererOptions): InkRenderer {
  return new InkRenderer(options);
}
