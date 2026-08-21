/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Claude model capability matrix.
 *
 * Anthropic rejects unsupported request parameters with a 400 rather than
 * ignoring them, and that rejection surfaces identically whether Autohand talks
 * to Anthropic directly or routes through an aggregator such as OpenRouter.
 * Both paths therefore gate optional parameters on the same rules, which live
 * here so they cannot drift apart.
 */

import type { ReasoningEffort } from "../types.js";

/** Effort levels Anthropic accepts, superset of Autohand's `ReasoningEffort`. */
export type AnthropicEffort = Exclude<ReasoningEffort, "none">;

/**
 * Collapse vendor prefixes, Vertex `@version` suffixes, and dotted minor
 * versions so `anthropic/claude-opus-4.8`, `claude-opus-4-8`, and
 * `claude-opus-4-8@20260101` all resolve to the same capability row.
 */
export function normalizeAnthropicModelKey(model: string): string {
  const withoutVendor = model.slice(model.lastIndexOf("/") + 1);
  const withoutVersion = withoutVendor.split("@")[0] ?? withoutVendor;
  return withoutVersion.toLowerCase().replace(/\./gu, "-");
}

export function isAnthropicModel(model: string): boolean {
  return /^claude-/u.test(normalizeAnthropicModelKey(model));
}

/** Models where thinking is always on and any explicit `thinking` value is a 400. */
const ALWAYS_ON_THINKING = /^claude-(?:fable|mythos)-5(?:$|-)/u;

/** Models that accept `thinking: { type: "adaptive" }`. */
const ADAPTIVE_THINKING =
  /^claude-(?:fable|mythos|opus|sonnet)-5(?:$|-)|^claude-(?:opus|sonnet)-4-[678](?:$|-)/u;

/** Models that reject `temperature`, `top_p`, and `top_k`. */
const NO_SAMPLING =
  /^claude-(?:fable|mythos|opus|sonnet)-5(?:$|-)|^claude-opus-4-[78](?:$|-)/u;

/** Models whose effort setting accepts `xhigh`. */
const EFFORT_WITH_XHIGH =
  /^claude-(?:fable|mythos|opus|sonnet)-5(?:$|-)|^claude-opus-4-[78](?:$|-)/u;

/** Models whose effort setting tops out at `high`. */
const EFFORT_UP_TO_HIGH = /^claude-(?:opus|sonnet)-4-6(?:$|-)|^claude-opus-4-5(?:$|-)/u;

export function anthropicModelHasAlwaysOnThinking(modelKey: string): boolean {
  return ALWAYS_ON_THINKING.test(modelKey);
}

export function anthropicModelSupportsAdaptiveThinking(modelKey: string): boolean {
  return ADAPTIVE_THINKING.test(modelKey);
}

export function anthropicModelSupportsTemperature(modelKey: string): boolean {
  return !NO_SAMPLING.test(modelKey);
}

/**
 * Resolve the effort level a model accepts, clamping `xhigh` down for models
 * that stop at `high` and dropping it entirely for models that reject effort.
 */
export function resolveAnthropicEffort(
  modelKey: string,
  reasoningEffort: ReasoningEffort | undefined,
): AnthropicEffort | undefined {
  if (!reasoningEffort || reasoningEffort === "none") {
    return undefined;
  }
  if (EFFORT_WITH_XHIGH.test(modelKey)) {
    return reasoningEffort;
  }
  if (EFFORT_UP_TO_HIGH.test(modelKey)) {
    return reasoningEffort === "xhigh" ? "high" : reasoningEffort;
  }
  return undefined;
}

/**
 * Claude Opus 5 thinks by default and only accepts an explicit opt-out at
 * `high` effort or below; above that the parameter is rejected outright.
 */
export function anthropicModelAcceptsDisabledThinking(
  modelKey: string,
  effort: AnthropicEffort | undefined,
): boolean {
  if (ALWAYS_ON_THINKING.test(modelKey)) {
    return false;
  }
  if (/^claude-opus-5(?:$|-)/u.test(modelKey)) {
    return effort !== "xhigh";
  }
  return true;
}
