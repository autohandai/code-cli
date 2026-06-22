/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AutohandConfig,
  CustomProviderId,
  CustomProviderSettings,
  ProviderName,
} from "../types.js";

const CUSTOM_PROVIDER_PREFIX = "custom:";

export function normalizeCustomProviderId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^custom:/i, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function toCustomProviderName(id: string): CustomProviderId {
  return `${CUSTOM_PROVIDER_PREFIX}${normalizeCustomProviderId(id)}`;
}

export function parseCustomProviderName(provider: unknown): string | null {
  if (typeof provider !== "string" || !provider.toLowerCase().startsWith(CUSTOM_PROVIDER_PREFIX)) {
    return null;
  }

  const id = normalizeCustomProviderId(provider.slice(CUSTOM_PROVIDER_PREFIX.length));
  return id.length > 0 ? id : null;
}

export function isCustomProviderName(provider: unknown): provider is CustomProviderId {
  return parseCustomProviderName(provider) !== null;
}

export function getCustomProviderConfig(
  config: Pick<AutohandConfig, "customProviders"> | null | undefined,
  provider: ProviderName | string,
): CustomProviderSettings | undefined {
  const id = parseCustomProviderName(provider);
  if (!id) return undefined;

  const entry = config?.customProviders?.[id];
  if (!entry || entry.disabled === true) return undefined;

  return {
    ...entry,
    id,
  };
}
