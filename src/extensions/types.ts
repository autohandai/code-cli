/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MetaToolDefinition } from '../core/metaTools/schema.js';
import type { ExtensionManifest } from './schema.js';

export type ExtensionScope = 'user' | 'project';

export interface ExtensionProvenance {
  extensionId: string;
  extensionVersion: string;
  scope: ExtensionScope;
  packageRoot: string;
  file: string;
}

export interface ExtensionPackage {
  root: string;
  manifestPath: string;
  manifest: ExtensionManifest;
  contributionFiles: {
    tools: string[];
    agents: string[];
  };
}

export interface LoadedExtension extends ExtensionPackage {
  scope: ExtensionScope;
  disabled: boolean;
  linked: boolean;
}

export interface ExtensionToolContribution {
  definition: MetaToolDefinition;
  provenance: ExtensionProvenance;
}

export interface ExtensionAgentContribution {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  model?: string;
  provenance: ExtensionProvenance;
}

export type ExtensionDiagnosticCode =
  | 'invalid_manifest'
  | 'invalid_state'
  | 'invalid_tool'
  | 'invalid_agent'
  | 'invalid_package_directory'
  | 'contribution_conflict'
  | 'unreadable_root';

export interface ExtensionDiagnostic {
  code: ExtensionDiagnosticCode;
  message: string;
  file: string;
  extensionId?: string;
  scope: ExtensionScope;
}

export interface ExtensionSnapshot {
  extensions: LoadedExtension[];
  tools: ExtensionToolContribution[];
  agents: ExtensionAgentContribution[];
  diagnostics: ExtensionDiagnostic[];
}
