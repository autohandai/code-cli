/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderName } from "../types.js";
import { isCustomProviderName } from "./customProviders.js";

/**
 * Provider selection is presented in three sections: the first-party Autohand AI
 * provider on its own, every other built-in or extension-contributed provider,
 * and finally the user's own OpenAI-compatible endpoints.
 */
export const PROVIDER_GROUP_IDS = ["autohand", "thirdParty", "custom"] as const;

export type ProviderGroupId = (typeof PROVIDER_GROUP_IDS)[number];

export const PROVIDER_GROUP_TITLE_KEYS: Readonly<Record<ProviderGroupId, string>> = {
  autohand: "providers.config.groupAutohand",
  thirdParty: "providers.config.groupThirdParty",
  custom: "providers.config.groupCustom",
};

export interface ProviderGroup {
  readonly id: ProviderGroupId;
  /** i18n key for the section heading rendered above the group. */
  readonly titleKey: string;
  readonly providers: readonly ProviderName[];
}

export interface GroupProvidersOptions {
  /** Orders the third-party and custom sections; input order is kept when omitted. */
  readonly sortKey?: (provider: ProviderName) => string;
  /** Sections emitted even when empty, so callers can attach affordance rows. */
  readonly alwaysInclude?: readonly ProviderGroupId[];
}

export function resolveProviderGroupId(provider: ProviderName): ProviderGroupId {
  if (provider === "autohandai") return "autohand";
  if (isCustomProviderName(provider)) return "custom";
  return "thirdParty";
}

/** The Autohand AI section holds a single provider, so sorting it is meaningless. */
const UNSORTED_GROUPS: ReadonlySet<ProviderGroupId> = new Set<ProviderGroupId>(["autohand"]);

export function groupProviders(
  providers: readonly ProviderName[],
  options: GroupProvidersOptions = {},
): ProviderGroup[] {
  const buckets = new Map<ProviderGroupId, ProviderName[]>(
    PROVIDER_GROUP_IDS.map((id) => [id, []]),
  );

  for (const provider of providers) {
    buckets.get(resolveProviderGroupId(provider))!.push(provider);
  }

  const alwaysInclude = new Set(options.alwaysInclude ?? []);
  const { sortKey } = options;

  return PROVIDER_GROUP_IDS.flatMap((id) => {
    const bucket = buckets.get(id)!;
    if (bucket.length === 0 && !alwaysInclude.has(id)) return [];

    const ordered =
      sortKey && !UNSORTED_GROUPS.has(id)
        ? [...bucket].sort((left, right) =>
            sortKey(left).localeCompare(sortKey(right), undefined, { sensitivity: "base" }),
          )
        : bucket;

    return [{ id, titleKey: PROVIDER_GROUP_TITLE_KEYS[id], providers: ordered }];
  });
}
