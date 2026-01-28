/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * InkRenderer - Manages the Ink render instance and state updates
 * This provides an imperative API for the agent to control the UI
 *
 * Key optimization: Uses React state internally via ref/useImperativeHandle
 * instead of calling instance.rerender() on every state change. This eliminates
 * flickering by letting React handle efficient DOM updates.
 */
import React, { useState, useImperativeHandle, forwardRef, useCallback, useRef } from 'react';
import { render, type Instance } from 'ink';
import { AgentUI, createInitialUIState, type AgentUIState } from './AgentUI.js';
import type { ToolOutputEntry } from './ToolOutput.js';
import { ThemeProvider } from '../theme/ThemeContext.js';
import { I18nProvider } from '../i18n/index.js';

export interface InkRendererOptions {
  onInstruction: (text: string) => void;
  onEscape: () => void;
  onCtrlC: () => void;
  enableQueueInput?: boolean;
}

/**
 * Ref handle exposed by AgentUIWrapper for imperative state updates
 */
export interface AgentUIWrapperHandle {
  updateState: (partial: Partial<AgentUIState>) => void;
  getState: () => AgentUIState;
}

interface AgentUIWrapperProps {
  initialState: AgentUIState;
  onInstruction: (text: string) => void;
  onEscape: () => void;
  onCtrlC: () => void;
  onInputChange: (input: string) => void;
  enableQueueInput?: boolean;
}

/**
 * Wrapper component that holds state internally and exposes update methods via ref.
 * This eliminates the need to call instance.rerender() - React handles updates.
 */
const AgentUIWrapper = forwardRef<AgentUIWrapperHandle, AgentUIWrapperProps>(
  function AgentUIWrapper(props, ref) {
    const {
      initialState,
      onInstruction,
      onEscape,
      onCtrlC,
      onInputChange,
      enableQueueInput
    } = props;

    const [state, setState] = useState<AgentUIState>(initialState);

    // Use ref to always get latest state without recreating the handle
    const stateRef = useRef<AgentUIState>(state);
    stateRef.current = state;

    // Expose imperative methods via ref - stable functions that don't change
    useImperativeHandle(ref, () => ({
      updateState: (partial: Partial<AgentUIState>) => {
        setState(prev => ({ ...prev, ...partial }));
      },
      getState: () => stateRef.current
    }), []); // Empty deps - functions are stable

    // Handle input changes - sync to parent for pause/resume preservation
    const handleInputChange = useCallback((input: string) => {
      setState(prev => ({ ...prev, currentInput: input }));
      onInputChange(input);
    }, [onInputChange]);

    return (
      <AgentUI
        state={state}
        onInstruction={onInstruction}
        onEscape={onEscape}
        onCtrlC={onCtrlC}
        onInputChange={handleInputChange}
        enableQueueInput={enableQueueInput}
      />
    );
  }
);

/**
 * InkRenderer wraps the Ink render instance and provides
 * imperative methods to update the UI state from the agent.
 *
 * Optimized to use React state internally - only calls render() once on start,
 * then uses ref-based state updates for all subsequent changes.
 */
export class InkRenderer {
  private instance: Instance | null = null;
  private state: AgentUIState;
  private options: InkRendererOptions;
  private toolIdCounter = 0;
  private wrapperRef: React.RefObject<AgentUIWrapperHandle>;

  constructor(options: InkRendererOptions) {
    this.options = options;
    this.state = createInitialUIState();
    this.wrapperRef = React.createRef<AgentUIWrapperHandle>();
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
        <I18nProvider>
          <AgentUIWrapper
            ref={this.wrapperRef}
            initialState={this.state}
            onInstruction={this.options.onInstruction}
            onEscape={this.options.onEscape}
            onCtrlC={this.options.onCtrlC}
            onInputChange={this.handleInputChange}
            enableQueueInput={this.options.enableQueueInput}
          />
        </I18nProvider>
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
   * Update the UI state via React's internal state management
   * This is much more efficient than calling instance.rerender()
   */
  private updateState(partial: Partial<AgentUIState>): void {
    this.state = { ...this.state, ...partial };

    // Use React state update if wrapper is mounted
    if (this.wrapperRef.current) {
      this.wrapperRef.current.updateState(partial);
    }
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
   * Set context percentage (0-100)
   */
  setContextPercent(percent: number): void {
    this.updateState({ contextPercent: percent });
  }

  /**
   * Pause input handling by stopping the renderer (preserves state)
   * Use this before external prompts that need stdin access
   */
  pause(): void {
    if (this.instance) {
      // Sync state from wrapper before unmounting
      if (this.wrapperRef.current) {
        this.state = this.wrapperRef.current.getState();
      }
      this.instance.unmount();
      this.instance = null;
    }
  }

  /**
   * Resume input handling by restarting the renderer with preserved state
   */
  resume(): void {
    if (!this.instance) {
      // Ensure stdin is restored to proper state after Modal prompts
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      // Clear line and move to new line for clean restart
      process.stdout.write('\n');

      // Create fresh ref for new instance
      this.wrapperRef = React.createRef<AgentUIWrapperHandle>();

      this.instance = render(
        <ThemeProvider>
          <I18nProvider>
            <AgentUIWrapper
              ref={this.wrapperRef}
              initialState={this.state}
              onInstruction={this.options.onInstruction}
              onEscape={this.options.onEscape}
              onCtrlC={this.options.onCtrlC}
              onInputChange={this.handleInputChange}
              enableQueueInput={this.options.enableQueueInput}
            />
          </I18nProvider>
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
    const newState = createInitialUIState();
    this.state = newState;

    // Use React state update if wrapper is mounted
    if (this.wrapperRef.current) {
      this.wrapperRef.current.updateState(newState);
    }
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
