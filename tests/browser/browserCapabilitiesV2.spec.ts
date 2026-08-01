/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";

import {
	BROWSER_V2_TOOL_NAMES,
	negotiateBrowserCapabilities,
} from "../../src/browser/browserCapabilities.js";
import { BROWSER_V2_TOOL_DEFINITIONS } from "../../src/core/toolManager.js";
import { FEATURE_REGISTRY } from "../../src/features/featureRegistry.js";

describe("browser capabilities v2", () => {
	it("stays on legacy tools when the feature flag is disabled", () => {
		expect(
			negotiateBrowserCapabilities(
				{
					protocolVersion: 2,
					extensionVersion: "1.2.3",
					tools: [...BROWSER_V2_TOOL_NAMES],
				},
				false,
			),
		).toEqual({ enabled: false, protocolVersion: 1, tools: [] });
	});

	it("fails closed for an old or malformed extension capability payload", () => {
		expect(
			negotiateBrowserCapabilities(
				{
					protocolVersion: 1,
					extensionVersion: "0.1.0",
					tools: ["browser_snapshot"],
				},
				true,
			),
		).toEqual({ enabled: false, protocolVersion: 1, tools: [] });
		expect(negotiateBrowserCapabilities({}, true)).toEqual({
			enabled: false,
			protocolVersion: 1,
			tools: [],
		});
	});

	it("exposes only the supported intersection after a v2 handshake", () => {
		expect(
			negotiateBrowserCapabilities(
				{
					protocolVersion: 2,
					extensionVersion: "1.2.3",
					tools: [
						"browser_snapshot",
						"browser_fill_form",
						"browser_execute_js",
						"browser_unknown",
					],
				},
				true,
			),
		).toEqual({
			enabled: true,
			protocolVersion: 2,
			tools: ["browser_snapshot", "browser_fill_form"],
		});
	});

	it("negotiates the upgraded ref-aware click and type definitions", () => {
		expect(
			negotiateBrowserCapabilities(
				{
					protocolVersion: 2,
					extensionVersion: "1.2.3",
					tools: ["browser_click", "browser_type"],
				},
				true,
			),
		).toEqual({
			enabled: true,
			protocolVersion: 2,
			tools: ["browser_click", "browser_type"],
		});
		const definitions = new Map(
			BROWSER_V2_TOOL_DEFINITIONS.map((definition) => [
				definition.name,
				definition,
			]),
		);
		expect(definitions.get("browser_click")?.parameters.properties).toHaveProperty(
			"target",
		);
		expect(definitions.get("browser_type")?.parameters.properties).toHaveProperty(
			"target",
		);
	});

	it("classifies submit, reset, upload, and dialog handling for approval", () => {
		const definitions = new Map(
			BROWSER_V2_TOOL_DEFINITIONS.map((definition) => [
				definition.name,
				definition,
			]),
		);
		for (const tool of [
			"browser_submit_form",
			"browser_reset_form",
			"browser_upload_file",
			"browser_handle_dialog",
		] as const) {
			expect(definitions.get(tool)?.requiresApproval).toBe(true);
		}
		expect(definitions.get("browser_fill_form")?.requiresApproval).not.toBe(true);
		expect(definitions.has("browser_execute_js")).toBe(false);
	});

	it("registers a disabled, restart-required CLI experiment", () => {
		expect(
			FEATURE_REGISTRY.find(
				(feature) => feature.id === "experimental_browser_tools_v2",
			),
		).toMatchObject({
			configPath: "features.experimentalBrowserToolsV2",
			defaultEnabled: false,
			requiresRestart: true,
		});
	});
});
