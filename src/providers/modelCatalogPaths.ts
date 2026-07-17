/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function getAutohandHomePath(): string {
  return resolve(process.env.AUTOHAND_HOME ?? join(homedir(), ".autohand"));
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
