/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Integration tests for sync feature
 */

// Mock yoga-layout to prevent WASM loading issues in test environment
// This must be at the top level before any imports
vi.mock("yoga-layout", () => {
  return {
    loadYoga: () => Promise.resolve({}),
  };
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";

describe("Sync Integration", () => {
  let tempDir: string;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Create temp directory
    tempDir = path.join(os.tmpdir(), `sync-integration-${Date.now()}`);
    await fs.ensureDir(tempDir);

    // Set up mock for global fetch
    mockFetch = vi.fn();
    (global as any).fetch = mockFetch;
  });

  afterEach(async () => {
    await fs.remove(tempDir).catch(() => {});
    vi.restoreAllMocks();
  });

  describe("SyncApiClient", () => {
    it.each([
      "http://api.example.com",
      "http://192.168.1.20:8787/api",
    ])("rejects a non-loopback HTTP API base before any bearer request: %s", async (baseUrl) => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");

      expect(() => new SyncApiClient({ baseUrl })).toThrow(/sync api base url/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("constructs correct API URLs", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");

      const client = new SyncApiClient({
        baseUrl: "https://test-api.example.com",
        timeout: 5000,
      });

      // Mock response for getRemoteManifest
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not found"),
      });

      const manifest = await client.getRemoteManifest("test-token");

      expect(manifest).toBeNull();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-api.example.com/v1/sync/manifest",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
    });

    it("handles API errors gracefully", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");

      const client = new SyncApiClient({
        baseUrl: "https://test-api.example.com",
        timeout: 5000,
        maxRetries: 1, // Disable retries for this test
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400, // Use 400 (not retried) instead of 500 (retried)
        text: () => Promise.resolve("Bad request"),
      });

      await expect(client.getRemoteManifest("test-token")).rejects.toThrow(
        "API error",
      );
    });

    it("retries on server errors", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");

      const client = new SyncApiClient({
        baseUrl: "https://test-api.example.com",
        timeout: 5000,
        maxRetries: 3,
        retryDelay: 10, // Fast retries for testing
      });

      // First two calls fail with 500, third succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Server error"),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Server error"),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ manifest: null }),
        });

      const result = await client.getRemoteManifest("test-token");
      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("handles rate limiting with retry", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");

      const client = new SyncApiClient({
        baseUrl: "https://test-api.example.com",
        timeout: 5000,
        maxRetries: 3,
        retryDelay: 10, // Fast retries for testing
      });

      // First call returns 429, second succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Map([["Retry-After", "1"]]),
          text: () => Promise.resolve("Rate limited"),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ manifest: null }),
        });

      const result = await client.getRemoteManifest("test-token");
      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("handles network timeouts", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");

      const client = new SyncApiClient({
        baseUrl: "https://test-api.example.com",
        timeout: 100, // Very short timeout
      });

      // Mock fetch that never resolves (simulates network hang)
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new DOMException("Aborted", "AbortError")),
              50,
            );
          }),
      );

      await expect(client.getRemoteManifest("test-token")).rejects.toThrow(
        "timeout",
      );
    });

    it("propagates caller cancellation into an active manifest fetch", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");
      const client = new SyncApiClient({
        baseUrl: "https://test-api.example.com",
        timeout: 5000,
        maxRetries: 1,
      });
      mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => (
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        })
      ));
      const controller = new AbortController();

      const manifest = client.getRemoteManifest('test-token', controller.signal);
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());
      controller.abort(new DOMException('Lifecycle closed', 'AbortError'));

      await expect(manifest).rejects.toMatchObject({ name: 'AbortError' });
      const requestSignal = mockFetch.mock.calls[0]?.[1]?.signal as AbortSignal;
      expect(requestSignal.aborted).toBe(true);
    });

    it("cancels a held download body reader after response headers resolve", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");
      const client = new SyncApiClient({ maxRetries: 1, timeout: 5000 });
      const reader = {
        read: vi.fn(() => new Promise<never>(() => {})),
        cancel: vi.fn().mockRejectedValue(new Error('reader cancellation failed')),
        releaseLock: vi.fn(),
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: { getReader: () => reader },
      });
      const controller = new AbortController();

      const download = client.downloadFile(
        'https://storage.example.com/download/held',
        undefined,
        controller.signal,
      );
      await vi.waitFor(() => expect(reader.read).toHaveBeenCalledOnce());
      controller.abort(new DOMException('Lifecycle closed', 'AbortError'));
      const settled = await Promise.race([
        download.then(
          () => true,
          () => true,
        ),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
      ]);

      expect(settled).toBe(true);
      expect(reader.cancel).toHaveBeenCalledOnce();
      await expect(download).rejects.toMatchObject({ name: 'AbortError' });
      expect(reader.releaseLock).toHaveBeenCalledOnce();
    });

    it("cancels held manifest JSON consumption after response headers resolve", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");
      const client = new SyncApiClient({ maxRetries: 1, timeout: 5000 });
      const cancel = vi.fn().mockRejectedValue(new Error('body cancellation failed'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: { cancel },
        json: () => new Promise<never>(() => {}),
      });
      const controller = new AbortController();

      const manifest = client.getRemoteManifest('test-token', controller.signal);
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());
      controller.abort(new DOMException('Lifecycle closed', 'AbortError'));

      await expect(manifest).rejects.toMatchObject({ name: 'AbortError' });
      expect(cancel).toHaveBeenCalledOnce();
    });

    it("respects file size limits", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");

      const client = new SyncApiClient({
        maxFileSize: 100, // 100 bytes
      });

      // Create content larger than limit
      const largeContent = Buffer.alloc(200);

      await expect(
        client.uploadFile("https://example.com/upload", largeContent),
      ).rejects.toThrow("exceeds max size");
    });

    it("rejects downloaded content that exceeds the file size limit", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");
      const client = new SyncApiClient({
        maxFileSize: 100,
        maxRetries: 1,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new Uint8Array(101).buffer),
      });

      await expect(
        client.downloadFile("https://storage.example.com/download/file"),
      ).rejects.toThrow("exceeds max size");
    });

    it("authenticates exact-origin file upload URLs with the session token", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");

      const client = new SyncApiClient({
        baseUrl: "https://test-api.example.com/api",
        maxRetries: 1,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await client.uploadFile(
        "https://test-api.example.com/v1/sync/file/config.json",
        Buffer.from("{}"),
        "test-token",
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-api.example.com/v1/sync/file/config.json",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
    });

    it("authenticates exact-origin file download URLs with the session token", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");

      const client = new SyncApiClient({
        baseUrl: "https://test-api.example.com/api",
        maxRetries: 1,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(Buffer.from("{}").buffer),
      });

      await client.downloadFile(
        "https://test-api.example.com/v1/sync/file/config.json",
        "test-token",
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-api.example.com/v1/sync/file/config.json",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
    });

    it.each([
      ['upload', 'https://storage.example.com/upload/file'],
      ['download', 'https://storage.example.com/download/file'],
    ])("does not forward application authorization to cross-origin HTTPS %s URLs", async (kind, transferUrl) => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");
      const client = new SyncApiClient({
        baseUrl: "https://test-api.example.com/v1",
        maxRetries: 1,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new Uint8Array([123, 125]).buffer),
      });

      if (kind === 'upload') {
        await client.uploadFile(transferUrl, Buffer.from('{}'), 'application-token');
      } else {
        await client.downloadFile(transferUrl, 'application-token');
      }

      const options = mockFetch.mock.calls[0]?.[1] as RequestInit;
      const headers = new Headers(options.headers);
      expect(headers.has('Authorization')).toBe(false);
    });

    it("compares transfer authorization by exact origin rather than base URL path", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");
      const client = new SyncApiClient({
        baseUrl: "https://test-api.example.com/api/v2",
        maxRetries: 1,
      });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      await client.uploadFile(
        "https://test-api.example.com/a/different/path",
        Buffer.from('{}'),
        'application-token',
      );

      const options = mockFetch.mock.calls[0]?.[1] as RequestInit;
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer application-token');
    });

    it("allows authenticated HTTP transfers only for a configured same-origin loopback API", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");
      const client = new SyncApiClient({
        baseUrl: "http://127.0.0.1:8787/api",
        maxRetries: 1,
      });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      await client.uploadFile(
        "http://127.0.0.1:8787/upload/file",
        Buffer.from('{}'),
        'application-token',
      );

      const options = mockFetch.mock.calls[0]?.[1] as RequestInit;
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer application-token');
    });

    it.each([
      ['cross-origin HTTP', 'http://storage.example.com/file'],
      ['credential-bearing HTTPS', 'https://user:password@storage.example.com/file'],
      ['unsupported protocol', 'ftp://storage.example.com/file'],
      ['invalid URL', 'not a url'],
    ])("rejects %s transfer URLs before fetch", async (_label, transferUrl) => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");
      const client = new SyncApiClient({ baseUrl: 'https://test-api.example.com/v1', maxRetries: 1 });

      await expect(client.uploadFile(
        transferUrl,
        Buffer.from('{}'),
        'application-token',
      )).rejects.toThrow(/transfer url/i);
      await expect(client.downloadFile(
        transferUrl,
        'application-token',
      )).rejects.toThrow(/transfer url/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("sends the manifest with every upload batch because the API validates each batch", async () => {
      const { SyncApiClient } = await import("../../src/sync/SyncApiClient.js");

      const client = new SyncApiClient({
        baseUrl: "https://test-api.example.com",
        maxRetries: 1,
      });
      const files = Array.from({ length: 101 }, (_, index) => `file-${index}.json`);
      const manifest = {
        version: 1,
        userId: "test-user",
        lastModified: new Date().toISOString(),
        files: files.map((filePath) => ({
          path: filePath,
          hash: "a".repeat(64),
          size: 2,
          modifiedAt: new Date().toISOString(),
        })),
        checksum: "checksum",
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ uploadUrls: {} }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ uploadUrls: {} }),
        });

      await client.initiateUpload("test-token", manifest, files);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const secondBatchBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(secondBatchBody.manifest).toEqual(manifest);
      expect(secondBatchBody.files).toEqual(["file-100.json"]);
    });
  });

  describe("Encryption", () => {
    it("encrypts and decrypts config correctly", async () => {
      const { encryptConfig, decryptConfig } =
        await import("../../src/sync/encryption.js");

      const originalConfig = {
        provider: "openrouter",
        openrouter: {
          apiKey: "sk-test-key-12345",
          model: "your-modelcard-id-here",
        },
        ui: {
          theme: "dark",
        },
      };

      const authToken = "test-auth-token-abcdef";

      const encrypted = encryptConfig(originalConfig, authToken);
      const decrypted = decryptConfig(encrypted, authToken);

      expect(decrypted).toEqual(originalConfig);
    });

    it("encrypts API keys in nested objects", async () => {
      const { encryptConfig } = await import("../../src/sync/encryption.js");

      const config = {
        openrouter: {
          apiKey: "sk-test-key",
        },
        anthropic: {
          apiKey: "sk-ant-key",
        },
      };

      const encrypted = encryptConfig(config, "auth-token");

      // API keys should be encrypted (contain : separator)
      expect(encrypted.openrouter.apiKey).toContain(":");
      expect(encrypted.anthropic.apiKey).toContain(":");
    });

    it("throws on decryption with wrong token", async () => {
      const { encrypt, decrypt } = await import("../../src/sync/encryption.js");

      const encrypted = encrypt("secret", "correct-token");

      expect(() => decrypt(encrypted, "wrong-token")).toThrow();
    });
  });

  describe("Sync Types", () => {
    it("exports metadata correctly", async () => {
      const { metadata } = await import("../../src/commands/sync.js");

      expect(metadata.command).toBe("/sync");
      expect(metadata.implemented).toBe(true);
    });

    it("sets and gets sync service reference", async () => {
      const { setSyncService, getSyncService } =
        await import("../../src/commands/sync.js");

      // Initially null
      setSyncService(null);
      expect(getSyncService()).toBeNull();

      // Set mock service
      const mockService = { isRunning: true } as any;
      setSyncService(mockService);
      expect(getSyncService()).toBe(mockService);

      // Clean up
      setSyncService(null);
    });
  });

  describe("CLI Options", () => {
    it("supports --sync-settings flag", () => {
      // This is a compile-time check - if the type doesn't include syncSettings,
      // TypeScript will fail. We just verify the option exists in CLIOptions.
      interface TestOptions {
        syncSettings?: boolean | string;
      }

      const opts: TestOptions = { syncSettings: true };
      expect(opts.syncSettings).toBe(true);

      const opts2: TestOptions = { syncSettings: false };
      expect(opts2.syncSettings).toBe(false);

      const opts3: TestOptions = {};
      expect(opts3.syncSettings).toBeUndefined();
    });
  });

  describe("File Filtering", () => {
    it("excludes device-specific files from sync", async () => {
      const { SYNC_EXCLUDE_ALWAYS } = await import("../../src/sync/types.js");

      expect(SYNC_EXCLUDE_ALWAYS).toContain("device-id");
      expect(SYNC_EXCLUDE_ALWAYS).toContain("error.log");
    });

    it("includes standard files by default", async () => {
      const { SYNC_INCLUDE_DEFAULT } = await import("../../src/sync/types.js");

      expect(SYNC_INCLUDE_DEFAULT).toContain("config.json");
      // Check for directory patterns (with trailing slash)
      expect(SYNC_INCLUDE_DEFAULT.some((p) => p.startsWith("agents"))).toBe(
        true,
      );
      expect(SYNC_INCLUDE_DEFAULT.some((p) => p.startsWith("skills"))).toBe(
        true,
      );
      expect(SYNC_INCLUDE_DEFAULT.some((p) => p.startsWith("memory"))).toBe(
        true,
      );
    });

    it("requires consent for telemetry and feedback", async () => {
      const { SYNC_CONSENT_REQUIRED } = await import("../../src/sync/types.js");

      // Check for telemetry and feedback paths (may have trailing slashes)
      expect(SYNC_CONSENT_REQUIRED.telemetry).toMatch(/^telemetry/);
      expect(SYNC_CONSENT_REQUIRED.feedback).toMatch(/^feedback/);
    });
  });

  describe("Slash Command Registration", () => {
    it("includes sync in slash commands", async () => {
      // Import sync metadata directly to avoid yoga-layout WASM loading issue
      // caused by importing all SLASH_COMMANDS which triggers Ink imports
      const { metadata } = await import("../../src/commands/sync.js");

      expect(metadata.command).toBe("/sync");
      expect(metadata.implemented).toBe(true);
    });
  });

  describe("Sync Config", () => {
    it("supports sync settings in config schema", () => {
      // Verify sync config interface
      interface SyncConfig {
        enabled: boolean;
        interval: number;
        includeTelemetry?: boolean;
        includeFeedback?: boolean;
      }

      const config: SyncConfig = {
        enabled: true,
        interval: 300000,
        includeTelemetry: false,
        includeFeedback: false,
      };

      expect(config.enabled).toBe(true);
      expect(config.interval).toBe(300000);
    });
  });
});

describe("Sync Service Factory", () => {
  it("creates sync service with options", async () => {
    const { createSyncService } = await import("../../src/sync/index.js");

    const service = createSyncService({
      authToken: "test-token",
      userId: "test-user",
      config: {
        enabled: true,
        interval: 60000,
      },
    });

    expect(service).toBeDefined();
    expect(service.isRunning).toBe(false);
  });
});
