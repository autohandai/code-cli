/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { getProviderConfig } from '../../config.js';
import { isSearchConfigured } from '../../actions/web.js';
import { formatToolOutputForDisplay } from '../../ui/toolOutput.js';
import { getPlanModeManager } from '../../commands/plan.js';
import type {
  AgentAction,
  AgentOutputEvent,
  AgentRuntime,
  AssistantReactPayload,
  FunctionDefinition,
  LLMMessage,
  LLMResponse,
  LLMUsage,
  ProviderName,
  TurnUsage,
  ToolCallRequest,
  ToolExecutionResult,
} from '../../types.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import type { MemoryManager } from '../../memory/MemoryManager.js';
import type { AutoReportManager } from '../../reporting/AutoReportManager.js';
import type { ProjectManager } from '../../session/ProjectManager.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { ConversationManager } from '../conversationManager.js';
import type { ContextOrchestrator } from '../context/orchestrator.js';
import type { ToolManager } from '../toolManager.js';
import type { ToolsRegistry } from '../toolsRegistry.js';
import { calculateContextUsage } from '../context/tokenizer.js';
import { filterToolsByRelevance } from '../toolFilter.js';
import { EXIT_PLAN_MODE_TOOL_DEFINITION, PLAN_TOOL_DEFINITION } from '../toolManager.js';
import {
  buildHostTokenUsageStatus,
  formatElapsedTime,
  formatTurnUsage,
  formatToolResultsBatch,
} from './AgentFormatter.js';
import {
  buildToolLoopCallSignature,
  buildToolLoopResultSignature,
  truncateToolLoopSignature,
} from './ToolLoopSignature.js';
import { isAutohandDebugEnabled } from '../../utils/debugLog.js';
import { syncDynamicRuntimeExtensions } from './dynamicRuntimeExtensions.js';
import {
  classifyResponseCompletion,
  isDeferredFinalResponse,
} from './ResponseCompletionClassifier.js';
import type { ResponseCompletionHook } from './ResponseCompletionClassifier.js';
import { evaluateAssistantTurn } from './TurnOutcomeEvaluator.js';

class LoopAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoopAbortedError';
  }
}

export interface ReactLoopInkRenderer {
  setStatus(status: string): void;
  addToolCall(tool: AgentAction['type'], detail: string): void;
  addToolOutputBatch(
    items: Array<{ tool: AgentAction['type']; label: string; detail: string; success: boolean }>,
    thought?: string,
  ): void;
  addToolOutput(
    tool: AgentAction['type'],
    success: boolean,
    output: string,
    thought?: string,
  ): void;
  setThinking(thought: string | null): void;
  setElapsed(elapsed: string): void;
  setTokens(tokens: string): void;
  setContextTokens?(contextTokens: { used: number; total: number } | undefined): void;
  setWorking(isWorking: boolean): void;
  setFinalResponse(response: string): void;
}

export interface AgentReactLoopHost {
  activeProvider?: ProviderName;
  autoReportManager: Pick<AutoReportManager, 'reportError'>;
  consecutiveCancellations: number;
  contextOrchestrator: Pick<
    ContextOrchestrator,
    'checkMidTurnCompaction' | 'handleOverflow' | 'prepareRequest' | 'setModel'
  > & Partial<Pick<ContextOrchestrator, 'setContextWindow'>>;
  contextPercentLeft: number;
  conversation: Pick<ConversationManager, 'addMessage' | 'addSystemNote' | 'history'>;
  inkRenderer: ReactLoopInkRenderer | null;
  lastAssistantResponseForNotification: string;
  llm: LLMProvider;
  memoryManager?: MemoryManager;
  projectManager: Pick<ProjectManager, 'recordFailure' | 'recordSuccess'>;
  responseCompletionHooks?: readonly ResponseCompletionHook[];
  runtime: AgentRuntime;
  searchQueries: string[];
  sessionManager: Pick<SessionManager, 'getCurrentSession'>;
  sessionStartedAt: number;
  sessionTokensUsed: number;
  taskStartedAt: number | null;
  toolManager: Pick<
    ToolManager,
    'execute' | 'listToolNames' | 'register' | 'registerMetaTools' | 'toFunctionDefinitions' | 'unregister'
  >;
  toolsRegistry?: ToolsRegistry;
  contextWindow: number;
  totalTokensUsed: number;
  currentTurnActualUsage: TurnUsage;
  currentTurnHadUnavailableUsage: boolean;
  sessionActualTokensUsed: number;
  sessionTokenUsageUnavailable: boolean;
  /** Cumulative input tokens this session (tokens going up). */
  sessionPromptTokens: number;
  /** Cumulative output tokens this session (tokens going down). */
  sessionCompletionTokens: number;
  /** Most recent request's prompt tokens (current context-window occupancy). */
  lastContextTokens: number;

  cleanupModelResponse(content: string): string;
  emitOutput(event: AgentOutputEvent): void;
  ensureSpinnerRunning(): void;
  forceRenderSpinner(): void;
  getMessagesWithImages(): Promise<LLMMessage[]>;
  getReactionParser(): { parseAssistantResponse(completion: LLMResponse): AssistantReactPayload };
  handleSmartContextCrop(call: ToolCallRequest): Promise<string>;
  isContextOverflowError(errorOrMessage: Error | string): boolean;
  saveAssistantMessage(content: string, toolCalls?: ToolCallRequest[]): Promise<void>;
  saveToolMessage(name: AgentAction['type'], content: string, toolCallId?: string): Promise<void>;
  setComposerFinalResponse(response: string): void;
  setComposerIdle(): void;
  setSpinnerStatus(status: string): void;
  startStatusUpdates(): void;
  stopStatusUpdates(): void;
  updateContextUsage(messages: LLMMessage[], tools?: FunctionDefinition[]): void;
  writeDebugLine(message: string): void;
}

function addUsageToTurn(existing: TurnUsage, provider: ProviderName | undefined, usage: LLMUsage): TurnUsage {
  if (existing.kind === 'actual') {
    return {
      kind: 'actual',
      provider,
      promptTokens: existing.promptTokens + usage.promptTokens,
      completionTokens: existing.completionTokens + usage.completionTokens,
      totalTokens: existing.totalTokens + usage.totalTokens,
    };
  }

  return {
    kind: 'actual',
    provider,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  };
}

export function formatComposerToolCallStatus(toolCount: number): string {
  return toolCount === 1 ? 'Calling tool...' : `Calling ${toolCount} tools...`;
}

export function shouldDisplayToolOutput(config: { ui?: { silentToolOutput?: boolean } }): boolean {
  return config.ui?.silentToolOutput !== true;
}

function getStringArg(args: ToolCallRequest['args'] | undefined, key: string): string | undefined {
  const value = args?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getStringArrayArg(args: ToolCallRequest['args'] | undefined, key: string): string[] {
  const value = args?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function truncateToolCallDetail(value: string, maxLength = 160): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

export function formatToolCallLogDetail(call: ToolCallRequest): string {
  const args = call.args;
  const path = getStringArg(args, 'path') ?? getStringArg(args, 'file') ?? getStringArg(args, 'cwd');
  if (path) {
    return truncateToolCallDetail(path);
  }

  const command = getStringArg(args, 'command') ?? getStringArg(args, 'cmd');
  if (command) {
    const commandArgs = getStringArrayArg(args, 'args');
    return truncateToolCallDetail([command, ...commandArgs].join(' '));
  }

  const query = getStringArg(args, 'query') ?? getStringArg(args, 'pattern') ?? getStringArg(args, 'search_query');
  if (query) {
    return truncateToolCallDetail(query);
  }

  const url = getStringArg(args, 'url') ?? getStringArg(args, 'uri');
  if (url) {
    return truncateToolCallDetail(url);
  }

  if (!args || Object.keys(args).length === 0) {
    return '';
  }

  return truncateToolCallDetail(JSON.stringify(args));
}

export { isDeferredFinalResponse, classifyResponseCompletion };

export async function runAgentReactLoop(host: AgentReactLoopHost, abortController: AbortController): Promise<void> {
    host.consecutiveCancellations = 0;

    const debugMode = host.runtime.config.agent?.debug === true || isAutohandDebugEnabled();
    if (debugMode) host.writeDebugLine('[AGENT DEBUG] runReactLoop started');

    // Check if we're executing an accepted plan - bypass iteration limit
    const planModeManager = getPlanModeManager();
    const isExecutingPlan = planModeManager.isEnabled() && planModeManager.getPhase() === 'executing';

    // For plan execution, use effectively unlimited iterations (user accepted the plan)
    // Otherwise use configurable limit (default 100)
    const maxIterations = isExecutingPlan
      ? 1000
      : (host.runtime.config.agent?.maxIterations ?? 100);

    // Gate plan and exit_plan_mode tools: only register when plan mode is
    // enabled and we are in the planning phase. This ensures the LLM literally
    // cannot call these tools unless the user entered plan mode, preventing
    // unsolicited plan generation.
    if (planModeManager.isEnabled() && planModeManager.getPhase() === 'planning') {
      if (!host.toolManager.listToolNames().includes('plan')) {
        host.toolManager.register(PLAN_TOOL_DEFINITION);
      }
      if (!host.toolManager.listToolNames().includes('exit_plan_mode')) {
        host.toolManager.register(EXIT_PLAN_MODE_TOOL_DEFINITION);
      }
    } else {
      host.toolManager.unregister('plan');
      host.toolManager.unregister('exit_plan_mode');
    }

    const refreshRuntimeTools = async () => {
      await syncDynamicRuntimeExtensions(host, host.runtime);
      let definitions = host.toolManager.toFunctionDefinitions();

      // Gate web tools: only offer web_search/fetch_url/web_repo when a
      // reliable search provider is configured (Brave/Parallel with API key,
      // or Google). DuckDuckGo (the default) is unreliable and causes the LLM
      // to get stuck in retry loops.
      if (!isSearchConfigured()) {
        const WEB_TOOLS = new Set(['web_search', 'fetch_url', 'web_repo']);
        definitions = definitions.filter((tool) => !WEB_TOOLS.has(tool.name));
      }

      return definitions;
    };

    const supportsNativeToolCalling = host.llm.getCapabilities?.().nativeToolCalling === true;

    // Get all function definitions for tool awareness and native tool calling.
    // Providers without native support keep using Autohand's text protocol and
    // must not receive OpenAI-style tool schemas in the API request.
    let allTools = await refreshRuntimeTools();

    if (debugMode) host.writeDebugLine(`[AGENT DEBUG] Loaded ${allTools.length} tools, maxIterations=${maxIterations}`);

    // Start status updates for the main loop
    host.startStatusUpdates();

    // Check if thinking should be shown
    const showThinking = host.runtime.config.ui?.showThinking !== false;
    const displayToolOutput = shouldDisplayToolOutput(host.runtime.config);
    const identicalCallHardLimit = 6;
    const identicalCallAndResultLimit = 3;
    const forceNoToolsViolationLimit = 2;
    const perToolFailureLimit = 2; // Max consecutive failures for same tool (regardless of args)
    let lastToolCallSignature = '';
    let identicalToolCallCount = 0;
    let lastToolResultSignature = '';
    let identicalToolResultCount = 0;
    let forceNoToolsUntilResponse = false;
    let forceNoToolsViolationCount = 0;
    const toolConsecutiveFailures = new Map<string, number>();
    let needsReflection = false; // Set after tool execution; cleared when model reflects
    const reflectionViolationLimit = 2;
    let reflectionViolationCount = 0;
    let invalidDeferredActionCount = 0;
    let consecutiveEmptyResponseCount = 0;

    const renderFinalResponse = (
      response: string,
      options: { thought?: string; usedThoughtAsResponse: boolean },
    ): void => {
      host.stopStatusUpdates();
      consecutiveEmptyResponseCount = 0;
      host.lastAssistantResponseForNotification = response;

      const suppressThinking = options.usedThoughtAsResponse && response.length > 0;
      if (options.thought && !suppressThinking) {
        host.emitOutput({ type: 'thinking', thought: options.thought });
      }
      host.emitOutput({ type: 'message', content: response });

      if (host.inkRenderer) {
        if (showThinking && options.thought && !suppressThinking) {
          host.inkRenderer.setThinking(options.thought);
        }
        host.inkRenderer.setElapsed(formatElapsedTime(host.taskStartedAt ?? host.sessionStartedAt));
        host.inkRenderer.setTokens(
          buildHostTokenUsageStatus(host, host.currentTurnActualUsage?.kind !== 'actual')
            ?? formatTurnUsage(host.currentTurnActualUsage)
        );
        host.inkRenderer.setWorking(false);
        host.inkRenderer.setFinalResponse(response);
      } else {
        host.runtime.spinner?.stop();
        if (showThinking && options.thought && !suppressThinking) {
          console.log(chalk.gray(`Thinking: ${options.thought}`));
          console.log();
        }
        if (options.usedThoughtAsResponse) {
          console.log(chalk.gray('Thinking: ') + response);
        } else {
          console.log(response);
        }
      }
    };

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      // Check for abort at the start of each iteration
      if (abortController.signal.aborted) {
        if (debugMode) host.writeDebugLine('[AGENT DEBUG] Abort detected at loop start, breaking');
        break;
      }

      // Filter tools by relevance to reduce token overhead
      const messages = host.conversation.history();
      let tools = filterToolsByRelevance(allTools, messages, {
        cache: host.runtime.config.agent?.toolSelectionCache !== false,
      });

      // Filter tools for plan mode (read-only tools only during planning phase)
      const planModeManager = getPlanModeManager();
      if (planModeManager.isEnabled() && planModeManager.getPhase() === 'planning') {
        const readOnlyTools = new Set(planModeManager.getReadOnlyTools());
        tools = tools.filter(t => readOnlyTools.has(t.name));
        if (debugMode) {
          host.writeDebugLine(`[AGENT DEBUG] Plan mode active: filtered to ${tools.length} read-only tools`);
        }
      }

      if (forceNoToolsUntilResponse) {
        tools = [];
      }

      // Use ContextOrchestrator for smart auto-compaction
      const model = host.runtime.options.model ?? getProviderConfig(host.runtime.config, host.activeProvider)?.model ?? 'unconfigured';
      host.contextOrchestrator.setModel(model);
      host.contextOrchestrator.setContextWindow?.(host.contextWindow);

      const prepared = await host.contextOrchestrator.prepareRequest(
        tools,
        iteration,
        host.runtime.spinner,
      );

      if (prepared.wasCropped) {
        console.log(chalk.cyan(`ℹ Auto-compacted ${prepared.croppedCount} messages`));
        if (prepared.summary) {
          console.log(chalk.gray(`   Summary preserved in context`));
        }
      }

      host.updateContextUsage(prepared.messages, tools);

      // Keep spinner active without switching to a non-boxed status renderer.
      host.ensureSpinnerRunning();
      if (!host.inkRenderer) {
        host.forceRenderSpinner();
      }
      // Get messages with images included for multimodal support
      const messagesWithImages = await host.getMessagesWithImages();

      if (debugMode) host.writeDebugLine(`[AGENT DEBUG] Calling LLM with ${messagesWithImages.length} messages, ${tools.length} tools`);

      let completion;
      try {
        // ACP and CLI can override thinking level at runtime; fall back to env and then normal.
        const runtimeThinking = host.runtime.options.thinking;
        const thinkingLevel = (
          typeof runtimeThinking === 'string' && ['none', 'normal', 'extended'].includes(runtimeThinking)
            ? runtimeThinking
            : process.env.AUTOHAND_THINKING_LEVEL
        ) as 'none' | 'normal' | 'extended' | undefined ?? 'normal';

        const requestTools = supportsNativeToolCalling && tools.length > 0 ? tools : undefined;

        completion = await host.llm.complete({
          messages: messagesWithImages,
          temperature: host.runtime.options.temperature ?? 0.2,
          model: host.runtime.options.model,
          signal: abortController.signal,
          tools: requestTools,
          toolChoice: requestTools ? 'auto' : undefined,
          maxTokens: 16000,  // Allow large outputs for file generation
          thinkingLevel,
        });
        if (abortController.signal.aborted) {
          host.stopStatusUpdates();
          host.runtime.spinner?.stop();
          return;
        }
        if (debugMode) host.writeDebugLine(`[AGENT DEBUG] LLM returned: content length=${completion.content?.length ?? 0}, toolCalls=${completion.toolCalls?.length ?? 0}`);
      } catch (llmError) {
        const errMsg = llmError instanceof Error ? llmError.message : String(llmError);
        const errStack = llmError instanceof Error ? llmError.stack : '';
        if (debugMode) host.writeDebugLine(`[AGENT DEBUG] LLM ERROR: ${errMsg}`);
        if (debugMode) host.writeDebugLine(`[AGENT DEBUG] LLM STACK: ${errStack}`);

        // Detect context overflow (400 from API) and auto-compact before retrying
        if (host.isContextOverflowError(llmError instanceof Error ? llmError : errMsg)) {
          // Auto-report context overflow (fire-and-forget)
          host.autoReportManager.reportError(
            llmError instanceof Error ? llmError : new Error(errMsg),
            {
              errorType: 'context_overflow',
              model: host.runtime.options.model,
              provider: host.activeProvider,
              conversationLength: host.conversation.history().length,
              contextUsagePercent: Math.round((1 - host.contextPercentLeft / 100) * 100),
            }
          ).catch(() => {});

          host.runtime.spinner?.stop();
          console.log(chalk.yellow('\n⚠ Context too long for model, auto-compacting...'));

          // Delegate to ContextOrchestrator for aggressive overflow recovery
          const overflowResult = await host.contextOrchestrator.handleOverflow(tools);
          if (overflowResult.croppedCount > 0) {
            console.log(chalk.gray(`   Compacted ${overflowResult.croppedCount} messages, retrying...`));
            continue; // Retry the current iteration with compacted context
          }
        }

        throw llmError;
      }

      // Track token usage from response and immediately update UI
      if (completion.usage) {
        host.currentTurnActualUsage = addUsageToTurn(
          host.currentTurnActualUsage,
          host.activeProvider,
          completion.usage,
        );
        host.totalTokensUsed += completion.usage.totalTokens;
        // Track input/output split and current context occupancy for the
        // real-time token_usage_status display.
        host.sessionPromptTokens += completion.usage.promptTokens;
        host.sessionCompletionTokens += completion.usage.completionTokens;
        host.lastContextTokens = completion.usage.promptTokens;
        host.inkRenderer?.setContextTokens?.(
          host.contextWindow > 0
            ? { used: completion.usage.promptTokens, total: host.contextWindow }
            : undefined
        );
        // Immediately render updated token count
        host.forceRenderSpinner();
      } else {
        host.currentTurnHadUnavailableUsage = true;
        host.currentTurnActualUsage = {
          kind: 'unavailable',
          provider: host.activeProvider,
          reason: 'not_reported',
        };
      }

      const payload = host.getReactionParser().parseAssistantResponse(completion);
      if (debugMode) host.writeDebugLine(`[AGENT DEBUG] Parsed payload: finalResponse=${!!payload.finalResponse}, thought=${!!payload.thought}, toolCalls=${payload.toolCalls?.length ?? 0}`);
      const turnOutcome = evaluateAssistantTurn({
        completion,
        payload,
        cleanupModelResponse: host.cleanupModelResponse,
        responseCompletionHooks: host.responseCompletionHooks,
      });

      if (turnOutcome.type === 'repair') {
        if (turnOutcome.reason === 'invalid_deferred_action') {
          invalidDeferredActionCount += 1;
          if (invalidDeferredActionCount < 2) {
            host.conversation.addSystemNote(turnOutcome.instruction);
            continue;
          }

          host.autoReportManager.reportError(
            new Error(`Invalid deferred finalResponse without tool calls: ${turnOutcome.telemetry?.reason ?? 'unknown'}`),
            {
              errorType: 'invalid_deferred_action',
              model: host.runtime.options.model,
              provider: host.activeProvider,
              conversationLength: host.conversation.history().length,
              context: {
                responseCompletionKind: 'invalid_deferred_action',
                reason: turnOutcome.telemetry?.reason ?? 'unknown',
                excerpt: turnOutcome.telemetry?.excerpt ?? '',
              },
            }
          ).catch(() => {});

          renderFinalResponse(turnOutcome.rejectedResponse || 'The model stopped before providing a usable answer. Please retry the request.', {
            thought: payload.thought,
            usedThoughtAsResponse: false,
          });
          return;
        }

        if (turnOutcome.reason === 'empty_no_tool_response') {
          consecutiveEmptyResponseCount += 1;

          if (consecutiveEmptyResponseCount >= 3) {
            if (debugMode) host.writeDebugLine('[AGENT DEBUG] Exiting after 3 consecutive empty responses');
            console.log(chalk.yellow('\n⚠ Model not providing response after multiple attempts. Showing available context.'));
            const fallback = payload.thought || 'The model did not provide a clear response. Please try rephrasing your question.';
            host.setComposerIdle();
            renderFinalResponse(fallback, {
              thought: payload.thought,
              usedThoughtAsResponse: false,
            });
            throw new LoopAbortedError('Model produced empty responses after multiple attempts');
          }
        }

        host.conversation.addSystemNote(turnOutcome.instruction);
        continue;
      }

      consecutiveEmptyResponseCount = 0;
      invalidDeferredActionCount = 0;
      const assistantMessage: LLMMessage = { role: 'assistant', content: completion.content };
      if (completion.toolCalls?.length) {
        assistantMessage.tool_calls = completion.toolCalls;
      }
      host.conversation.addMessage(assistantMessage);
      await host.saveAssistantMessage(completion.content, payload.toolCalls);
      host.updateContextUsage(host.conversation.history(), tools);

      // Debug: show what the model returned (helps diagnose response issues)
      if (debugMode) {
        host.writeDebugLine(`[DEBUG] Iteration ${iteration}:`);
        host.writeDebugLine(`[DEBUG]   - toolCalls: ${payload.toolCalls?.length ?? 0}`);
        host.writeDebugLine(`[DEBUG]   - thought: ${payload.thought?.slice(0, 100) || '(none)'}`);
        host.writeDebugLine(`[DEBUG]   - finalResponse: ${payload.finalResponse?.slice(0, 100) || '(none)'}`);
        host.writeDebugLine(`[DEBUG]   - raw content: ${completion.content?.slice(0, 200) || '(empty)'}`);
        host.writeDebugLine(`[DEBUG]   - finishReason: ${completion.finishReason ?? '(none)'}`);
      }

      // Show what the LLM is doing for visibility
      const toolCount = payload.toolCalls?.length ?? 0;
      // Response could come from finalResponse, response, or thought (when no tool calls)
      const hasResponse = Boolean(payload.finalResponse || payload.response || (!toolCount && payload.thought));

      if (!payload.toolCalls?.length) {
        forceNoToolsViolationCount = 0;
      }

      if (!host.inkRenderer) {
        // Console mode: show iteration status
        if (iteration > 0) {
          const status = toolCount > 0
            ? `→ Step ${iteration + 1}: calling ${toolCount} tool(s)`
            : hasResponse
              ? `→ Step ${iteration + 1}: preparing response`
              : `→ Step ${iteration + 1}: thinking...`;
          console.log(chalk.gray(status));
        }
      }

      // Reflection loop guard: after tool results, the model MUST reflect before
      // calling more tools. If it jumps straight to tool calls without a reflection
      // (or a substantive thought that implicitly reflects), inject a system note.
      const hasMeaningfulReflection = typeof payload.reflection === 'string' && payload.reflection.trim().length > 0;

      if (needsReflection && payload.toolCalls && payload.toolCalls.length > 0) {
        const thoughtIsSubstantive = (payload.thought?.length ?? 0) > 50;
        if (!hasMeaningfulReflection && !thoughtIsSubstantive) {
          reflectionViolationCount++;
          if (reflectionViolationCount < reflectionViolationLimit) {
            host.conversation.addSystemNote(
              '[Reflection Required] You received tool results but did not reflect on them. ' +
              'Before calling more tools, include a "reflection" field summarizing what you learned ' +
              'from the previous tool outputs and how they inform your next action. ' +
              'Alternatively, provide a substantive "thought" (50+ chars) that analyzes the results.'
            );
            if (debugMode) host.writeDebugLine('[AGENT DEBUG] Reflection guard triggered: model called tools without reflecting');
            continue;
          }
          // After limit exceeded, allow the tool calls through (avoid infinite loop)
          // and reset state so the counter doesn't grow unboundedly within this turn.
          if (debugMode) host.writeDebugLine('[AGENT DEBUG] Reflection guard: violation limit exceeded, allowing tool calls');
          needsReflection = false;
          reflectionViolationCount = 0;
        }
      }
      // Reflection satisfied (or not required)
      if (needsReflection && (hasMeaningfulReflection || (payload.thought?.length ?? 0) > 50 || !payload.toolCalls?.length)) {
        needsReflection = false;
        reflectionViolationCount = 0;
      }

      if (payload.toolCalls && payload.toolCalls.length > 0) {
        const toolCallSignature = buildToolLoopCallSignature(payload.toolCalls);
        if (toolCallSignature === lastToolCallSignature) {
          identicalToolCallCount += 1;
        } else {
          lastToolCallSignature = toolCallSignature;
          identicalToolCallCount = 1;
          lastToolResultSignature = '';
          identicalToolResultCount = 0;
          forceNoToolsViolationCount = 0;
        }

        if (forceNoToolsUntilResponse) {
          forceNoToolsViolationCount += 1;
          host.conversation.addSystemNote(
            '[Critical Loop Guard] You are still calling tools after being told to stop. ' +
            'Do not call tools again. Provide your finalResponse now.'
          );

          if (forceNoToolsViolationCount >= forceNoToolsViolationLimit) {
            host.stopStatusUpdates();
            const loopFallback =
              'I stopped repeated tool calls to prevent a loop and token waste. ' +
              'Please confirm if you want a direct answer now or a narrower retry instruction.';
            host.lastAssistantResponseForNotification = loopFallback;
            host.setComposerIdle();
            host.setComposerFinalResponse(loopFallback);
            host.emitOutput({ type: 'message', content: loopFallback });
            throw new LoopAbortedError('Repeated tool-call limit exceeded');
          }

          continue;
        }

        if (identicalToolCallCount >= identicalCallHardLimit) {
          forceNoToolsUntilResponse = true;
          host.conversation.addSystemNote(
            `[Critical Loop Guard] Repeated tool call sequence detected (${identicalToolCallCount}x). ` +
            `Last sequence: ${truncateToolLoopSignature(toolCallSignature)}. ` +
            'Stop calling tools and provide your finalResponse using the current results.'
          );
          continue;
        }

        const cropCalls = payload.toolCalls.filter((call) => call.tool === 'smart_context_cropper');
        const otherCalls = payload.toolCalls.filter((call) => call.tool !== 'smart_context_cropper');

        // Collect all output lines for a single batch write
        const outputLines: string[] = [];

        // Extract thought for display
        // Note: by this point, parseAssistantReactPayload has already extracted
        // the thought string from JSON, so payload.thought is clean text.
        const thought = showThinking && payload.thought
          ? payload.thought
          : undefined;

        if (host.inkRenderer && displayToolOutput) {
          for (const call of payload.toolCalls) {
            host.inkRenderer.addToolCall(call.tool, formatToolCallLogDetail(call));
          }
        }

        // Handle smart_context_cropper calls (add to conversation + collect output)
        if (cropCalls.length) {
          for (const call of cropCalls) {
            const content = await host.handleSmartContextCrop(call);
            host.conversation.addMessage({
              role: 'tool',
              name: 'smart_context_cropper',
              content,
              tool_call_id: call.id
            });
            await host.saveToolMessage('smart_context_cropper', content, call.id);
            host.updateContextUsage(host.conversation.history(), tools);
            outputLines.push(`${chalk.cyan('✂ smart_context_cropper')}`);
            outputLines.push(chalk.gray(content));
            outputLines.push('');
          }
        }

        // Execute other tools
        let results: ToolExecutionResult[] = [];
        if (otherCalls.length) {
          let completedCount = 0;
          const totalTools = otherCalls.length;
          const charLimit = host.runtime.config.ui?.readFileCharLimit ?? 300;

          // Execute all tools with progress callback
          const renderToolResult = (
            result: ToolExecutionResult,
            call: ToolCallRequest | undefined,
            resultThought?: string,
          ): void => {
            if (!host.inkRenderer || !displayToolOutput) {
              return;
            }
            const filePath = call?.args?.path as string | undefined;
            const command = call?.args?.command as string | undefined;
            const commandArgs = call?.args?.args as string[] | undefined;
            host.inkRenderer.addToolOutput(
              result.tool,
              result.success,
              result.success
                ? formatToolOutputForDisplay({ tool: result.tool, content: result.output ?? '', charLimit, filePath, command, commandArgs }).output
                : result.error ?? result.output ?? 'Tool failed',
              resultThought,
            );
          };

          results = await host.toolManager.execute(otherCalls, (index: number, result: ToolExecutionResult) => {
            completedCount++;
            // Update spinner with progress count for parallel execution
            if (totalTools > 1 && !host.inkRenderer) {
              host.setSpinnerStatus(`Running tools (${completedCount}/${totalTools})...`);
            }
            renderToolResult(result, otherCalls[index], completedCount === 1 ? thought : undefined);
          }, { signal: abortController.signal });

          if (abortController.signal.aborted) {
            host.stopStatusUpdates();
            host.runtime.spinner?.stop();
            return;
          }

          if (!host.inkRenderer && displayToolOutput) {
            // Ora mode: batch output
            host.runtime.spinner?.stop();
            outputLines.push(formatToolResultsBatch(results, charLimit, otherCalls, thought));
          }

          // Add tool messages to conversation after ALL tools complete (needs full ordered results)
          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const content = result.success
              ? result.output ?? '(no output)'
              : result.error ?? result.output ?? 'Tool failed without error message';
            host.conversation.addMessage({
              role: 'tool',
              name: result.tool,
              content,
              tool_call_id: otherCalls[i]?.id
            });
            await host.saveToolMessage(result.tool, content, otherCalls[i]?.id);
          }
          if (results.some((result) => result.success && result.tool === 'create_meta_tool')) {
            allTools = await refreshRuntimeTools();
          }
          host.updateContextUsage(host.conversation.history(), tools);

          // Mid-turn compaction: if tool outputs pushed us into critical territory,
          // compact immediately instead of waiting for the next iteration's
          // prepareRequest(). This prevents a single massive tool result from
          // causing a context-overflow 400 on the next LLM call.
          const midTurnCompacted = await host.contextOrchestrator.checkMidTurnCompaction(tools, iteration);
          if (midTurnCompacted) {
            if (debugMode) {
              const midTurnUsage = calculateContextUsage(
                host.conversation.history(),
                tools,
                host.runtime.options.model ?? '',
                undefined,
                host.contextWindow
              );
              host.writeDebugLine(`[AGENT DEBUG] Mid-turn compaction triggered at ${Math.round(midTurnUsage.usagePercent * 100)}%`);
            }
            console.log(chalk.cyan(`ℹ Mid-turn compaction applied`));
          }

          // Detect when ALL tool calls were denied by the user
          const allDenied = results.length > 0 && results.every(r =>
            !r.success && (r.output === 'Tool execution skipped by user.' || r.error === 'Tool execution skipped by user.')
          );
          if (allDenied) {
            const deniedTools = results.map(r => r.tool).join(', ');
            host.conversation.addSystemNote(
              `[IMPORTANT] The user has explicitly declined the following tool call(s): ${deniedTools}. ` +
              `Do NOT retry the same tool(s) with the same arguments. The user said "No". ` +
              `Instead, ask the user how they would like to proceed, or suggest an alternative approach. ` +
              `If there is nothing else to do, provide your final response.`
            );
          }

          // Track per-tool consecutive failures (catches loops where LLM varies args but same tool keeps failing)
          for (const result of results) {
            if (!result.success) {
              const count = (toolConsecutiveFailures.get(result.tool) ?? 0) + 1;
              toolConsecutiveFailures.set(result.tool, count);
              if (count >= perToolFailureLimit) {
                const errorSnippet = (result.error ?? result.output ?? '').slice(0, 200);
                host.conversation.addSystemNote(
                  `[Tool Failure Guard] The "${result.tool}" tool has failed ${count} times consecutively. ` +
                  `Latest error: ${errorSnippet}\n` +
                  `STOP using "${result.tool}". Do NOT retry it with different arguments. Instead:\n` +
                  `- If you can answer from your own knowledge, provide a finalResponse directly.\n` +
                  `- If the tool requires configuration (e.g., API key, provider), tell the user what to configure.\n` +
                  `- If the task cannot be completed without this tool, explain the limitation to the user.`
                );
              }
            } else {
              toolConsecutiveFailures.delete(result.tool);
            }
          }

          // Detect repeated ask_followup_question cancellations — force the LLM to stop asking
          if (host.consecutiveCancellations >= 2) {
            host.conversation.addSystemNote(
              `[CRITICAL] The user has cancelled ask_followup_question ${host.consecutiveCancellations} times in a row. ` +
              `STOP calling ask_followup_question immediately. Do NOT ask the user any more questions. ` +
              `Provide your best final response now using the information you already have.`
            );
          }

          const toolResultSignature = buildToolLoopResultSignature(results);
          if (toolResultSignature === lastToolResultSignature) {
            identicalToolResultCount += 1;
          } else {
            lastToolResultSignature = toolResultSignature;
            identicalToolResultCount = 1;
          }

          if (
            identicalToolCallCount >= identicalCallAndResultLimit &&
            identicalToolResultCount >= identicalCallAndResultLimit
          ) {
            forceNoToolsUntilResponse = true;
            host.conversation.addSystemNote(
              '[Critical Loop Guard] Tool calls and outputs are repeating without progress. ' +
              'Stop calling tools and provide your finalResponse now.'
            );
          }
        }

        // Output remaining items for Ora mode
        if (!host.inkRenderer && displayToolOutput) {
          if (outputLines.length > 0) {
            console.log('\n' + outputLines.join('\n'));
          }
        }

        // Record success/failure for each tool (async, non-blocking display)
        if (results.length > 0) {
          const sessionId = host.sessionManager.getCurrentSession()?.metadata.sessionId || 'unknown';
          for (const result of results) {
            if (result.success) {
              await host.projectManager.recordSuccess(host.runtime.workspaceRoot, {
                timestamp: new Date().toISOString(),
                sessionId,
                tool: result.tool,
                context: 'Tool execution',
                tags: [result.tool]
              });
            } else {
              await host.projectManager.recordFailure(host.runtime.workspaceRoot, {
                timestamp: new Date().toISOString(),
                sessionId,
                tool: result.tool,
                error: result.error || 'Unknown error',
                context: 'Tool execution',
                tags: [result.tool]
              });
            }
          }
        }

        // After tool execution, add a hint to encourage the model to respond
        // This helps models that might get stuck in tool-calling loops
        if (iteration > 0 && results.length > 0 && results.every(r => r.success)) {
          // Only add hint if we've been calling tools for a while without a response
          const recentMessages = host.conversation.history().slice(-6);
          const toolResultCount = recentMessages.filter((message) => message.role === 'tool').length;
          if (toolResultCount >= 2) {
            host.conversation.addSystemNote(
              '[Reminder] Tool execution complete. Please analyze the results and provide your response to the user\'s original question. Do not call more tools unless absolutely necessary.'
            );
          }
        }

        // Search-specific throttling to prevent excessive sequential searches
        const searchTools = ['find', 'search', 'search_with_context', 'semantic_search'];
        const searchCallsThisIteration = otherCalls.filter((call) => searchTools.includes(call.tool));

        // Track search queries for this iteration
        for (const call of searchCallsThisIteration) {
          const query = String(call.args?.query || call.args?.pattern || 'unknown');
          host.searchQueries.push(query);
        }

        // Add search limit warning if too many searches in one iteration
        if (searchCallsThisIteration.length >= 3) {
          host.conversation.addSystemNote(
            '[Search Limit] You have made 3+ searches this iteration. Please analyze the search results before searching again. Consider combining patterns (e.g., `pattern1|pattern2`) if you need more information.'
          );
        }

        // Add search history summary if accumulated too many searches
        if (host.searchQueries.length > 5) {
          const recentSearches = host.searchQueries.slice(-5).map((q: string) => `"${q}"`).join(', ');
          host.conversation.addSystemNote(
            `[Search Summary] Recent searches: ${recentSearches}. Avoid repeating similar searches - analyze existing results first.`
          );
        }

        // Mark that the next iteration must include reflection on these tool results
        needsReflection = true;

        // Check for abort after tool execution before continuing
        if (abortController.signal.aborted) {
          if (debugMode) host.writeDebugLine('[AGENT DEBUG] Abort detected after tools, breaking');
          break;
        }

        continue;
      }

      if (turnOutcome.type !== 'finish') {
        throw new Error(`Unexpected non-final turn outcome after tool handling: ${turnOutcome.type}`);
      }
      renderFinalResponse(turnOutcome.response, {
        thought: payload.thought,
        usedThoughtAsResponse: turnOutcome.usedThoughtAsResponse,
      });
      return;
    }
    if (abortController.signal.aborted) {
      host.stopStatusUpdates();
      host.runtime.spinner?.stop();
      return;
    }
    host.stopStatusUpdates();
    host.runtime.spinner?.stop();
    console.log(chalk.yellow(`\n⚠ Task exceeded ${maxIterations} tool iterations without completing.`));

    // Try to get a final summary from the LLM instead of hard-throwing
    try {
      host.conversation.addSystemNote(
        '[System] You have used all available iterations. Provide a final summary of what was accomplished and what remains to be done. Do not call any more tools.'
      );

      const summaryCompletion = await host.llm.complete({
        messages: host.conversation.history(),
        temperature: 0.2,
        model: host.runtime.options.model,
        maxTokens: 2000,
      });

      const summaryResponse = summaryCompletion.content?.trim();
      if (summaryResponse) {
        host.lastAssistantResponseForNotification = summaryResponse;
        host.setComposerIdle();
        host.setComposerFinalResponse(summaryResponse);
        host.emitOutput({ type: 'message', content: summaryResponse });
        return;
      }
    } catch {
      // Summary call failed - fall through to static summary
    }

    // Last resort: show a static summary of what was accomplished
    const { summarizeWithLLM } = await import('../context/summarizer.js');
    const staticSummary = await summarizeWithLLM(
      host.conversation.history().slice(1), // skip system prompt
      host.llm,
      host.memoryManager,
    );
    const fallbackMsg = `Task did not complete within ${maxIterations} iterations.\n\nProgress summary:\n${staticSummary}`;
    host.lastAssistantResponseForNotification = fallbackMsg;
    host.setComposerIdle();
    host.setComposerFinalResponse(fallbackMsg);
    host.emitOutput({ type: 'message', content: fallbackMsg });
  }
