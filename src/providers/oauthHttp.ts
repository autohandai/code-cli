/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * HTTP helpers shared by the OAuth device/browser flows (OpenAI ChatGPT, xAI).
 */

export const OAUTH_REQUEST_TIMEOUT_MS = 15_000;

export interface ParsedResponse {
  payload: unknown;
  detail?: string;
}

export function buildTokenBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  context: string,
  timeoutMs = OAUTH_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${context} timed out. Check your connection and try again.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function extractErrorDetail(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;

  const candidate = payload as Record<string, unknown>;
  const direct = candidate.error_description ?? candidate.error ?? candidate.message ?? candidate.detail;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  const nestedError = candidate.error;
  if (nestedError && typeof nestedError === 'object') {
    const nested = nestedError as Record<string, unknown>;
    for (const key of ['message', 'error_description', 'detail', 'code']) {
      const value = nested[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }

  return undefined;
}

export async function parseResponseBody(response: Response): Promise<ParsedResponse> {
  const rawText = await response.text();
  let payload: unknown;

  if (rawText.trim()) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      payload = rawText;
    }
  }

  const detail = extractErrorDetail(payload) ?? (typeof payload === 'string' && payload.trim() ? payload.trim() : undefined);
  return { payload, detail };
}

export async function parseJsonResponse<T>(response: Response, context: string): Promise<T> {
  const { payload, detail } = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(
      detail
        ? `${context} failed with status ${response.status}: ${detail}`
        : `${context} failed with status ${response.status}.`,
    );
  }

  if (payload === undefined) {
    throw new Error(`${context} returned an empty response.`);
  }

  return payload as T;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function openBrowser(url: string): Promise<boolean> {
  try {
    const open = await import('open').then((mod) => mod.default);
    await open(url);
    return true;
  } catch {
    return false;
  }
}
