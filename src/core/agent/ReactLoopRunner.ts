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
import type { AgentAction, LLMMessage } from '../../types.js';
import { calculateContextUsage } from '../context/tokenizer.js';
import { filterToolsByRelevance } from '../toolFilter.js';
import { EXIT_PLAN_MODE_TOOL_DEFINITION, PLAN_TOOL_DEFINITION } from '../toolManager.js';
import {
  formatElapsedTime,
  formatTokens,
  formatToolResultsBatch,
} from './AgentFormatter.js';
import {
  buildToolLoopCallSignature,
  buildToolLoopResultSignature,
  getToolCallLabel,
  truncateToolLoopSignature,
} from './ToolLoopSignature.js';

class LoopAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoopAbortedError';
  }
}

export interface AgentReactLoopHost {
  [key: string]: any;
}

export function formatComposerToolCallStatus(toolCount: number): string {
  return toolCount === 1 ? 'Calling tool...' : `Calling ${toolCount} tools...`;
}

export function isDeferredFinalResponse(response: string): boolean {
  const trimmed = response.trim();
  if (!trimmed) {
    return false;
  }

  const hasAnswerStructure =
    trimmed.includes('\n') ||
    /:\s+\S{12,}/.test(trimmed) ||
    /(^|\n)\s*[-*]\s+\S/.test(trimmed);
  if (hasAnswerStructure) {
    return false;
  }

  const patterns = [
    /\bi (now )?have (a )?(comprehensive|clear|good|enough|solid) (understanding|picture|context|information)\b.{0,120}\b(let me|i('ll| will)|i can now)\b.{0,50}\b(provide|give|summarize|explain|tell|answer)\b/i,
    /^\s*(let me|i('ll| will)|i can now|now i('ll| will))\b.{0,50}\b(provide|give|summarize|explain|tell|answer)\b/i,
  ];

  return patterns.some((pattern) => pattern.test(trimmed));
}

export async function runAgentReactLoop(host: AgentReactLoopHost, abortController: AbortController): Promise<void> {
    host.consecutiveCancellations = 0;

    const debugMode = host.runtime.config.agent?.debug === true || process.env.AUTOHAND_DEBUG === '1';
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

    // Get all function definitions for native tool calling
    let allTools = host.toolManager.toFunctionDefinitions();

    // Gate web tools: only offer web_search/fetch_url/web_repo when a
    // reliable search provider is configured (Brave/Parallel with API key,
    // or Google). DuckDuckGo (the default) is unreliable and causes the LLM
    // to get stuck in retry loops.
    if (!isSearchConfigured()) {
      const WEB_TOOLS = new Set(['web_search', 'fetch_url', 'web_repo']);
      allTools = allTools.filter((t: any) => !WEB_TOOLS.has(t.name));
    }

    if (debugMode) host.writeDebugLine(`[AGENT DEBUG] Loaded ${allTools.length} tools, maxIterations=${maxIterations}`);

    // Start status updates for the main loop
    host.startStatusUpdates();

    // Check if thinking should be shown
    const showThinking = host.runtime.config.ui?.showThinking !== false;
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
    let deferredFinalResponseCount = 0;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      // Check for abort at the start of each iteration
      if (abortController.signal.aborted) {
        if (debugMode) host.writeDebugLine('[AGENT DEBUG] Abort detected at loop start, breaking');
        break;
      }

      // Filter tools by relevance to reduce token overhead
      const messages = host.conversation.history();
      let tools = filterToolsByRelevance(allTools, messages);

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

        completion = await host.llm.complete({
          messages: messagesWithImages,
          temperature: host.runtime.options.temperature ?? 0.2,
          model: host.runtime.options.model,
          signal: abortController.signal,
          tools: tools.length > 0 ? tools : undefined,
          toolChoice: tools.length > 0 ? 'auto' : undefined,
          maxTokens: 16000,  // Allow large outputs for file generation
          thinkingLevel,
        });
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
        host.totalTokensUsed += completion.usage.totalTokens;
        // Immediately render updated token count
        host.forceRenderSpinner();
      }

      const payload = host.getReactionParser().parseAssistantResponse(completion);
      if (debugMode) host.writeDebugLine(`[AGENT DEBUG] Parsed payload: finalResponse=${!!payload.finalResponse}, thought=${!!payload.thought}, toolCalls=${payload.toolCalls?.length ?? 0}`);
      const assistantMessage: LLMMessage = { role: 'assistant', content: completion.content };
      if (completion.toolCalls?.length) {
        assistantMessage.tool_calls = completion.toolCalls;
      }
      host.conversation.addMessage(assistantMessage);
      await host.saveAssistantMessage(completion.content, payload.toolCalls);
      host.updateContextUsage(host.conversation.history(), tools);

      // Debug: show what the model returned (helps diagnose response issues)
      if (debugMode) {
        console.log(chalk.yellow(`\n[DEBUG] Iteration ${iteration}:`));
        console.log(chalk.yellow(`  - toolCalls: ${payload.toolCalls?.length ?? 0}`));
        console.log(chalk.yellow(`  - thought: ${payload.thought?.slice(0, 100) || '(none)'}`));
        console.log(chalk.yellow(`  - finalResponse: ${payload.finalResponse?.slice(0, 100) || '(none)'}`));
        console.log(chalk.yellow(`  - raw content: ${completion.content?.slice(0, 200) || '(empty)'}`));
        console.log(chalk.yellow(`  - finishReason: ${completion.finishReason ?? '(none)'}`));
      }

      // Detect truncated responses - some models silently cut off at max_tokens
      if (completion.finishReason === 'length' && !payload.finalResponse) {
        if (debugMode) host.writeDebugLine('[AGENT DEBUG] Response truncated (finishReason=length), asking model to continue');
        host.conversation.addSystemNote(
          '[System] Your previous response was truncated due to output length limits. ' +
          'Please continue from where you left off. If you were making a tool call, retry it.'
        );
        continue;
      }

      // Show what the LLM is doing for visibility
      const toolCount = payload.toolCalls?.length ?? 0;
      // Response could come from finalResponse, response, or thought (when no tool calls)
      const hasResponse = Boolean(payload.finalResponse || payload.response || (!toolCount && payload.thought));
      const thoughtPreview = payload.thought?.slice(0, 80) || '';

      if (!payload.toolCalls?.length) {
        forceNoToolsViolationCount = 0;
      }

      if (host.inkRenderer) {
        if (toolCount > 0) {
          host.inkRenderer.setStatus(formatComposerToolCallStatus(toolCount));
        } else if (hasResponse) {
          host.inkRenderer.setStatus('Responding...');
        } else if (thoughtPreview) {
          host.inkRenderer.setStatus('Thinking...');
        }
      } else {
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
      if (needsReflection && payload.toolCalls && payload.toolCalls.length > 0) {
        const hasReflection = Boolean(payload.reflection);
        const thoughtIsSubstantive = (payload.thought?.length ?? 0) > 50;
        if (!hasReflection && !thoughtIsSubstantive) {
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
      if (needsReflection && (payload.reflection || (payload.thought?.length ?? 0) > 50 || !payload.toolCalls?.length)) {
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

        const cropCalls = payload.toolCalls.filter((call: any) => call.tool === 'smart_context_cropper');
        const otherCalls = payload.toolCalls.filter((call: any) => call.tool !== 'smart_context_cropper');

        // Collect all output lines for a single batch write
        const outputLines: string[] = [];

        // Extract thought for display
        // Note: by this point, parseAssistantReactPayload has already extracted
        // the thought string from JSON, so payload.thought is clean text.
        const thought = showThinking && payload.thought
          ? payload.thought
          : undefined;

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
        let results: Array<{ tool: AgentAction['type']; success: boolean; output?: string; error?: string }> = [];
        if (otherCalls.length) {
          let completedCount = 0;
          const totalTools = otherCalls.length;
          const charLimit = host.runtime.config.ui?.readFileCharLimit ?? 300;

          // Execute all tools with progress callback
          results = await host.toolManager.execute(otherCalls, (_index: number, _result: any) => {
            completedCount++;
            // Update spinner with progress count for parallel execution
            if (totalTools > 1) {
              host.setSpinnerStatus(`Running tools (${completedCount}/${totalTools})...`);
            }
          });

          // Render tool outputs
          if (host.inkRenderer) {
            if (results.length > 1) {
              // Grouped batch rendering for parallel tool calls
              const batchItems = results.map((r, i) => {
                const call = otherCalls[i];
                return {
                  tool: r.tool,
                  label: getToolCallLabel(call),
                  detail: r.success
                    ? formatToolOutputForDisplay({ tool: r.tool, content: r.output ?? '', charLimit, filePath: call?.args?.path as string | undefined, command: call?.args?.command as string | undefined, commandArgs: call?.args?.args as string[] | undefined }).output
                    : r.error ?? r.output ?? 'Tool failed',
                  success: r.success
                };
              });
              host.inkRenderer.addToolOutputBatch(batchItems, thought);
            } else if (results.length === 1) {
              // Single tool — use standard rendering
              const r = results[0];
              const call = otherCalls[0];
              const filePath = call?.args?.path as string | undefined;
              const command = call?.args?.command as string | undefined;
              const commandArgs = call?.args?.args as string[] | undefined;
              host.inkRenderer.addToolOutput(
                r.tool,
                r.success,
                r.success
                  ? formatToolOutputForDisplay({ tool: r.tool, content: r.output ?? '', charLimit, filePath, command, commandArgs }).output
                  : r.error ?? r.output ?? 'Tool failed',
                thought
              );
            }
          } else {
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
                host.runtime.options.model ?? ''
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
        if (!host.inkRenderer) {
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
          const toolResultCount = recentMessages.filter((m: any) => m.role === 'tool').length;
          if (toolResultCount >= 2) {
            host.conversation.addSystemNote(
              '[Reminder] Tool execution complete. Please analyze the results and provide your response to the user\'s original question. Do not call more tools unless absolutely necessary.'
            );
          }
        }

        // Search-specific throttling to prevent excessive sequential searches
        const searchTools = ['find', 'search', 'search_with_context', 'semantic_search'];
        const searchCallsThisIteration = otherCalls.filter((call: any) => searchTools.includes(call.tool));

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

      // CRITICAL: Detect when model says it will act but didn't include tool calls
      // This catches the common failure mode: "Let me now update X..." with empty toolCalls
      const pendingResponse = payload.finalResponse || payload.response || '';
      if (host.expressesIntentToAct(pendingResponse) && !payload.toolCalls?.length) {
        // Model said it will do something but didn't call the tool - force it to actually act
        const intentRetryKey = '__intentRetryCount';
        const intentRetries = ((host as any)[intentRetryKey] ?? 0) + 1;
        (host as any)[intentRetryKey] = intentRetries;

        if (intentRetries < 3) {
          host.conversation.addSystemNote(
            `[System] ERROR: You said "${pendingResponse.slice(0, 100)}..." but did NOT include any tool calls. ` +
            `You MUST include the actual tool call in toolCalls array. ` +
            `Do NOT say "let me update X" - actually call write_file/search_replace/apply_patch with the changes. ` +
            `Try again with the actual tool call.`
          );
          continue; // Force another iteration
        }
        // After 3 retries, fall through and show the response (better than infinite loop)
        (host as any)[intentRetryKey] = 0;
      } else {
        // Reset counter on successful response
        (host as any).__intentRetryCount = 0;
      }

      // Extract the response - prioritize explicit response fields, but use thought as fallback
      // when there are no tool calls (model might provide analysis in thought without finalResponse)
      let rawResponse: string;
      const usedThoughtAsResponse = Boolean(payload.thought) &&
        !payload.finalResponse &&
        !payload.response &&
        !payload.toolCalls?.length;
      if (payload.finalResponse) {
        rawResponse = payload.finalResponse;
      } else if (payload.response) {
        rawResponse = payload.response;
      } else if (!payload.toolCalls?.length && payload.thought) {
        // No tool calls and no explicit response, but has thought - use thought as the response
        rawResponse = payload.thought;
      } else {
        // Last resort: try to extract something useful from raw content
        const cleanedContent = host.cleanupModelResponse(completion.content);
        // If cleaned content looks like JSON, it's not a real response
        rawResponse = cleanedContent.startsWith('{') ? '' : cleanedContent;
      }
      let response = host.cleanupModelResponse(rawResponse.trim());
      if (!response && usedThoughtAsResponse && payload.thought) {
        response = payload.thought.trim();
      }

      // If response is empty, try to get a proper response
      // This applies on any iteration (including 0) to prevent silent exit on parse failure
      if (!response) {
        // Track consecutive empty responses to prevent infinite loops
        const consecutiveEmptyKey = '__consecutiveEmpty';
        const consecutiveEmpty = ((host as any)[consecutiveEmptyKey] ?? 0) + 1;
        (host as any)[consecutiveEmptyKey] = consecutiveEmpty;

        if (consecutiveEmpty >= 3) {
          // After 3 retries, force a fallback and break out
          if (debugMode) host.writeDebugLine('[AGENT DEBUG] Exiting after 3 consecutive empty responses');
          host.stopStatusUpdates();
          console.log(chalk.yellow('\n⚠ Model not providing response after multiple attempts. Showing available context.'));
          const fallback = payload.thought || 'The model did not provide a clear response. Please try rephrasing your question.';
          host.lastAssistantResponseForNotification = fallback;
          host.setComposerIdle();
          host.setComposerFinalResponse(fallback);
          (host as any)[consecutiveEmptyKey] = 0;
          // Emit fallback for RPC mode
          host.emitOutput({ type: 'message', content: fallback });
          throw new LoopAbortedError('Model produced empty responses after multiple attempts');
        }

        host.conversation.addSystemNote(
          `[System] IMPORTANT: You must now provide your finalResponse. The user is waiting for your analysis. Do not call any more tools - just provide your answer in the finalResponse field.`
        );
        continue;
      }

      if (isDeferredFinalResponse(response)) {
        deferredFinalResponseCount += 1;
        if (deferredFinalResponseCount < 3) {
          host.conversation.addSystemNote(
            `[System] IMPORTANT: Your previous finalResponse was not an answer: "${response.slice(0, 160)}". ` +
            'Do not announce that you will summarize or answer. Provide the actual finalResponse now with concrete findings for the user.'
          );
          continue;
        }
        response = 'The model stopped before providing a usable answer. Please retry the request.';
      } else {
        deferredFinalResponseCount = 0;
      }

      host.stopStatusUpdates();

      // Reset consecutive empty counter on success
      (host as any).__consecutiveEmpty = 0;
      host.lastAssistantResponseForNotification = response;

      // Emit output event for RPC mode
      const suppressThinking = usedThoughtAsResponse && response.length > 0;
      if (payload.thought && !suppressThinking) {
        host.emitOutput({ type: 'thinking', thought: payload.thought });
      }
      host.emitOutput({ type: 'message', content: response });

      if (host.inkRenderer) {
        // InkRenderer: set final response
        if (showThinking && payload.thought && !suppressThinking) {
          host.inkRenderer.setThinking(payload.thought);
        }
        // Update final stats before stopping (session totals for completionStats)
        host.inkRenderer.setElapsed(formatElapsedTime(host.sessionStartedAt));
        host.inkRenderer.setTokens(formatTokens(host.sessionTokensUsed + host.totalTokensUsed));
        host.inkRenderer.setWorking(false);
        host.inkRenderer.setFinalResponse(response);
      } else {
        // Ora mode: stop spinner and output
        host.runtime.spinner?.stop();
        if (showThinking && payload.thought && !suppressThinking) {
          // parseAssistantReactPayload already extracted thought from JSON
          console.log(chalk.gray(`Thinking: ${payload.thought}`));
          console.log();
        }
        if (usedThoughtAsResponse) {
          // When thought was used as the response, prefix with "Thinking:" header
          // so the user understands the model's internal reasoning became the reply
          console.log(chalk.gray('Thinking: ') + response);
        } else {
          console.log(response);
        }
      }
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
