/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { join, resolve } from "node:path";
import { resolveAutohandHome } from "../constants.js";

export function getAutohandHomePath(): string {
  return resolve(resolveAutohandHome());
}

export function getUserModelCatalogPath(): string {
  if (process.env.AUTOHAND_MODELS_CATALOG) {
    return resolve(process.env.AUTOHAND_MODELS_CATALOG);
  }

  return join(getAutohandHomePath(), "models.json");
}

export function getRemoteModelCatalogPath(): string {
  return join(getAutohandHomePath(), "model-catalog", "models.json");
}

export function getModelCatalogMetadataPath(): string {
  return join(getAutohandHomePath(), "model-catalog", "metadata.json");
}
