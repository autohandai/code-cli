/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { sanitizeModelId } from "../../src/providers/errors.js";

describe("sanitizeModelId", () => {
  it("returns clean model IDs unchanged", () => {
    expect(sanitizeModelId("your-modelcard-id-here")).toBe(
      "your-modelcard-id-here",
    );
  });

  it("strips bracketed paste start marker [200~", () => {
    expect(sanitizeModelId("[200~your-modelcard-id-here.6")).toBe(
      "your-modelcard-id-here.6",
    );
  });

  it("strips bracketed paste end marker [201~", () => {
    expect(sanitizeModelId("your-modelcard-id-here.6[201~")).toBe(
      "your-modelcard-id-here.6",
    );
  });

  it("strips both bracketed paste markers (GH #29)", () => {
    expect(sanitizeModelId("[200~your-modelcard-id-here.6[201~")).toBe(
      "your-modelcard-id-here.6",
    );
  });

  it("strips ESC prefix variants of bracketed paste markers", () => {
    expect(sanitizeModelId("\x1b[200~your-modelcard-id-here\x1b[201~")).toBe(
      "your-modelcard-id-here",
    );
  });

  it("trims whitespace", () => {
    expect(sanitizeModelId("  your-modelcard-id-here  ")).toBe(
      "your-modelcard-id-here",
    );
  });

  it("strips control characters", () => {
    expect(sanitizeModelId("your-modelcard-id-here\r\n")).toBe(
      "your-modelcard-id-here",
    );
  });

  it("handles empty string", () => {
    expect(sanitizeModelId("")).toBe("");
  });

  it("handles model ID that is only paste markers", () => {
    expect(sanitizeModelId("[200~[201~")).toBe("");
  });
});
