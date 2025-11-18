/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMRequest, LLMResponse, OpenRouterSettings } from './types.js';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private defaultModel: string;

  constructor(settings: OpenRouterSettings) {
    this.apiKey = settings.apiKey;
    this.baseUrl = settings.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultModel = settings.model;
  }

  setDefaultModel(model: string): void {
    this.defaultModel = model;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const payload = {
      model: request.model ?? this.defaultModel,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 1000,
      stream: request.stream ?? false
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://github.com/autohand/cli',
          'X-Title': 'autohand-cli'
        },
        body: JSON.stringify(payload),
        signal: request.signal
      });
    } catch (error) {
      throw new Error(
        `Failed to reach OpenRouter (${(error as Error).message}). Check your network connection or base URL.`
      );
    }

    if (!response.ok) {
      const friendly = await this.buildErrorMessage(response);
      throw new Error(friendly);
    }

    const json = (await response.json()) as any;
    const text = json?.choices?.[0]?.message?.content ?? '';
    return {
      id: json.id ?? 'autohand-local',
      created: json.created ?? Date.now(),
      content: text,
      raw: json
    };
  }

  private async buildErrorMessage(response: Response): Promise<string> {
    const status = response.status;
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      const error = data?.error ?? {};
      const code: string | undefined = error.code;
      const message: string = error.metadata?.raw ?? error.message ?? text;
      if (status === 429) {
        return 'You hit the rate limit for this OpenRouter model. Please try again later or choose another model in ~/.autohand-cli/config.json.';
      }
      return `OpenRouter request failed (${status}${code ? ` / ${code}` : ''}): ${message}`;
    } catch {
      return `OpenRouter request failed (${status}): ${text}`;
    }
  }
}
