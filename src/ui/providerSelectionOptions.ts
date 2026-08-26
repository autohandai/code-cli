/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { t } from "../i18n/index.js";
import { groupProviders } from "../providers/providerGroups.js";
import type { ProviderName } from "../types.js";
import type { ModalOption } from "./ink/components/Modal.js";

export interface BuildProviderSelectionOptionsInput {
  readonly providers: readonly ProviderName[];
  /** Renders one provider row; callers own the label, indicators, and description. */
  readonly toOption: (provider: ProviderName) => ModalOption;
  /** Orders the third-party and custom sections; input order is kept when omitted. */
  readonly sortKey?: (provider: ProviderName) => string;
  /** Rows appended to the custom section, e.g. "+ New provider". */
  readonly customGroupExtras?: readonly ModalOption[];
}

/**
 * Flattens the provider sections into the single option list the Ink modal
 * consumes, tagging the first row of each section with its localized heading.
 */
export function buildProviderSelectionOptions({
  providers,
  toOption,
  sortKey,
  customGroupExtras = [],
}: BuildProviderSelectionOptionsInput): ModalOption[] {
  const groups = groupProviders(providers, {
    sortKey,
    alwaysInclude: customGroupExtras.length > 0 ? ["custom"] : undefined,
  });

  return groups.flatMap((group) => {
    const rows = group.providers.map(toOption);
    if (group.id === "custom") {
      rows.push(...customGroupExtras.map((extra) => ({ ...extra })));
    }

    const [first, ...rest] = rows;
    return first ? [{ ...first, header: t(group.titleKey) }, ...rest] : [];
  });
}
