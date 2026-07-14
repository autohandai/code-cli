/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sync API Client for communicating with Cloudflare R2 via API
 */
import type { SyncManifest, SyncApiConfig, SyncApiResponse, SyncResult } from './types.js';

const DEFAULT_BASE_URL = 'https://api.autohand.ai';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100MB
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000; // 1 second base delay
const MAX_FILES_PER_REQUEST = 100; // API limit for files array

export class SyncApiClient {
  private readonly baseUrl: string;
  private readonly baseOrigin: string;
  private readonly timeout: number;
  private readonly maxFileSize: number;
  private readonly maxTotalSize: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor(config?: SyncApiConfig) {
    const configuredBaseUrl = config?.baseUrl || DEFAULT_BASE_URL;
    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(configuredBaseUrl);
    } catch {
      throw new Error('Invalid sync API base URL');
    }
    if (
      (parsedBaseUrl.protocol !== 'https:' && parsedBaseUrl.protocol !== 'http:') ||
      parsedBaseUrl.username !== '' ||
      parsedBaseUrl.password !== '' ||
      (parsedBaseUrl.protocol === 'http:' && !this.isLoopbackHostname(parsedBaseUrl.hostname))
    ) {
      throw new Error('Invalid sync API base URL');
    }

    this.baseUrl = configuredBaseUrl.replace(/\/+$/, '');
    this.baseOrigin = parsedBaseUrl.origin;
    this.timeout = config?.timeout || DEFAULT_TIMEOUT;
    this.maxFileSize = config?.maxFileSize || DEFAULT_MAX_FILE_SIZE;
    this.maxTotalSize = config?.maxTotalSize || DEFAULT_MAX_TOTAL_SIZE;
    this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelay = config?.retryDelay ?? DEFAULT_RETRY_DELAY;
  }

  private getTransferAuthorization(transferUrl: string, token?: string): string | undefined {
    if (
      transferUrl.trim() !== transferUrl ||
      /[\u0000-\u001F\u007F\\]/.test(transferUrl)
    ) {
      throw new Error('Invalid transfer URL');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(transferUrl);
    } catch {
      throw new Error('Invalid transfer URL');
    }

    if (parsedUrl.username !== '' || parsedUrl.password !== '') {
      throw new Error('Invalid transfer URL: embedded credentials are not allowed');
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new Error('Invalid transfer URL: unsupported protocol');
    }

    const sameOrigin = parsedUrl.origin === this.baseOrigin;
    if (parsedUrl.protocol === 'http:') {
      if (!sameOrigin || !this.isLoopbackHostname(parsedUrl.hostname)) {
        throw new Error('Invalid transfer URL: insecure HTTP endpoint');
      }
    }

    return sameOrigin && token ? `Bearer ${token}` : undefined;
  }

  private isLoopbackHostname(hostname: string): boolean {
    const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return normalizedHostname === 'localhost' ||
      normalizedHostname.endsWith('.localhost') ||
      normalizedHostname === '::1' ||
      /^127(?:\.\d{1,3}){3}$/.test(normalizedHostname);
  }

  /**
   * Execute a fetch request with retry logic and rate limit handling
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    timeoutMs: number = this.timeout,
    signal?: AbortSignal,
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      this.throwIfAborted(signal);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      timeoutId.unref?.();
      const abortRequest = (): void => controller.abort(signal?.reason);
      signal?.addEventListener('abort', abortRequest, { once: true });

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle rate limiting (429)
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : this.retryDelay * Math.pow(2, attempt);

          if (attempt < this.maxRetries - 1) {
            await this.cancelResponseBody(response);
            await this.sleep(waitTime, signal);
            continue;
          }
          await this.cancelResponseBody(response);
          throw new Error('Rate limited: too many requests');
        }

        // Handle server errors with retry (500, 502, 503, 504)
        if (response.status >= 500 && attempt < this.maxRetries - 1) {
          await this.cancelResponseBody(response);
          await this.sleep(this.retryDelay * Math.pow(2, attempt), signal);
          continue;
        }

        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error as Error;

        if (signal?.aborted) {
          throw signal.reason instanceof Error
            ? signal.reason
            : new DOMException('Sync request aborted', 'AbortError');
        }

        // Don't retry on abort (timeout)
        if ((error as Error).name === 'AbortError') {
          throw new Error('Request timeout');
        }

        // Retry on network errors
        if (attempt < this.maxRetries - 1) {
          await this.sleep(this.retryDelay * Math.pow(2, attempt), signal);
          continue;
        }
      } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', abortRequest);
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    this.throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', abortSleep);
        resolve();
      }, ms);
      const abortSleep = (): void => {
        clearTimeout(timeout);
        reject(signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('Sync request aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abortSleep, { once: true });
    });
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Sync request aborted', 'AbortError');
  }

  private waitForSignal<T>(
    work: Promise<T>,
    signal?: AbortSignal,
    onAbort?: () => void | Promise<void>,
  ): Promise<T> {
    if (!signal) return work;
    if (signal.aborted) {
      this.runAbortCleanup(onAbort);
      return Promise.reject(signal.reason instanceof Error
        ? signal.reason
        : new DOMException('Sync request aborted', 'AbortError'));
    }

    return new Promise<T>((resolve, reject) => {
      const handleAbort = (): void => {
        this.runAbortCleanup(onAbort);
        reject(signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Sync request aborted', 'AbortError'));
      };
      signal.addEventListener('abort', handleAbort, { once: true });
      void work.then(
        (value) => {
          signal.removeEventListener('abort', handleAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', handleAbort);
          reject(error);
        },
      );
    });
  }

  private runAbortCleanup(onAbort?: () => void | Promise<void>): void {
    if (!onAbort) return;
    try {
      void Promise.resolve(onAbort()).catch(() => undefined);
    } catch {
      // Request cancellation is best-effort; lifecycle abort still wins the race.
    }
  }

  private async cancelResponseBody(response: Response, reason?: unknown): Promise<void> {
    const body = response.body;
    if (!body || typeof body.cancel !== 'function') return;
    await body.cancel(reason).catch(() => {});
  }

  private readResponseText(response: Response, signal?: AbortSignal): Promise<string> {
    return this.waitForSignal(
      response.text(),
      signal,
      () => this.cancelResponseBody(response, signal?.reason),
    );
  }

  private readResponseJson<T>(response: Response, signal?: AbortSignal): Promise<T> {
    return this.waitForSignal(
      response.json() as Promise<T>,
      signal,
      () => this.cancelResponseBody(response, signal?.reason),
    );
  }

  /**
   * Get the remote sync manifest for a user
   * Returns null if no sync data exists
   */
  async getRemoteManifest(token: string, signal?: AbortSignal): Promise<SyncManifest | null> {
    const response = await this.fetchWithRetry(
      `${this.baseUrl}/v1/sync/manifest`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
      this.timeout,
      signal,
    );

    if (response.status === 404) {
      await this.cancelResponseBody(response);
      return null; // No sync data yet
    }

    if (!response.ok) {
      const error = await this.readResponseText(response, signal).catch(() => 'Unknown error');
      this.throwIfAborted(signal);
      throw new Error(`API error: ${response.status} ${error}`);
    }

    const data = await this.readResponseJson<SyncApiResponse>(response, signal);
    return data.manifest || null;
  }

  /**
   * Upload sync manifest and request pre-signed URLs for file uploads
   * Batches requests to stay within API limits (max 100 files per request)
   */
  async initiateUpload(
    token: string,
    manifest: SyncManifest,
    filePaths: string[],
    signal?: AbortSignal,
  ): Promise<{ uploadUrls: Record<string, string> }> {
    // Batch files into chunks of MAX_FILES_PER_REQUEST
    const batches: string[][] = [];
    for (let i = 0; i < filePaths.length; i += MAX_FILES_PER_REQUEST) {
      batches.push(filePaths.slice(i, i + MAX_FILES_PER_REQUEST));
    }

    // Make requests for each batch and merge results
    const allUploadUrls: Record<string, string> = {};

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/v1/sync/upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            manifest,
            files: batch,
          }),
        },
        this.timeout,
        signal,
      );

      if (!response.ok) {
        const error = await this.readResponseText(response, signal).catch(() => 'Unknown error');
        this.throwIfAborted(signal);
        throw new Error(`API error: ${response.status} ${error}`);
      }

      const data = await this.readResponseJson<SyncApiResponse>(response, signal);
      const batchUrls = data.uploadUrls || {};

      // Merge batch URLs into result
      Object.assign(allUploadUrls, batchUrls);
    }

    return {
      uploadUrls: allUploadUrls,
    };
  }

  /**
   * Upload a file to a pre-signed URL
   */
  async uploadFile(
    uploadUrl: string,
    content: Buffer,
    token?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const authorization = this.getTransferAuthorization(uploadUrl, token);

    if (content.length > this.maxFileSize) {
      throw new Error(`File exceeds max size of ${this.maxFileSize} bytes`);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': content.length.toString(),
    };
    if (authorization) {
      headers.Authorization = authorization;
    }

    const response = await this.fetchWithRetry(
      uploadUrl,
      {
        method: 'PUT',
        headers,
        body: new Uint8Array(content),
      },
      this.timeout,
      signal,
    );

    if (!response.ok) {
      await this.cancelResponseBody(response);
      throw new Error(`Upload failed: ${response.status}`);
    }
    await this.cancelResponseBody(response);
  }

  /**
   * Complete the upload and finalize the manifest
   */
  async completeUpload(
    token: string,
    manifest: SyncManifest,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/v1/sync/complete`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ manifest }),
        },
        this.timeout,
        signal,
      );

      if (!response.ok) {
        const error = await this.readResponseText(response, signal).catch(() => 'Unknown error');
        this.throwIfAborted(signal);
        return {
          success: false,
          uploaded: 0,
          downloaded: 0,
          conflicts: 0,
          error: `API error: ${response.status} ${error}`,
        };
      }

      await this.cancelResponseBody(response);
      return {
        success: true,
        uploaded: manifest.files.length,
        downloaded: 0,
        conflicts: 0,
      };
    } catch (error) {
      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Request pre-signed URLs for file downloads
   * Batches requests to stay within API limits (max 100 files per request)
   */
  async initiateDownload(
    token: string,
    filePaths: string[],
    signal?: AbortSignal,
  ): Promise<{ downloadUrls: Record<string, string> }> {
    // Batch files into chunks of MAX_FILES_PER_REQUEST
    const batches: string[][] = [];
    for (let i = 0; i < filePaths.length; i += MAX_FILES_PER_REQUEST) {
      batches.push(filePaths.slice(i, i + MAX_FILES_PER_REQUEST));
    }

    // Make requests for each batch and merge results
    const allDownloadUrls: Record<string, string> = {};

    for (const batch of batches) {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/v1/sync/download`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ files: batch }),
        },
        this.timeout,
        signal,
      );

      if (!response.ok) {
        const error = await this.readResponseText(response, signal).catch(() => 'Unknown error');
        this.throwIfAborted(signal);
        throw new Error(`API error: ${response.status} ${error}`);
      }

      const data = await this.readResponseJson<SyncApiResponse>(response, signal);
      const batchUrls = data.downloadUrls || {};

      // Merge batch URLs into result
      Object.assign(allDownloadUrls, batchUrls);
    }

    return {
      downloadUrls: allDownloadUrls,
    };
  }

  /**
   * Download a file from a pre-signed URL
   */
  async downloadFile(
    downloadUrl: string,
    token?: string,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const authorization = this.getTransferAuthorization(downloadUrl, token);
    const headers = authorization ? { Authorization: authorization } : undefined;
    const response = await this.fetchWithRetry(
      downloadUrl,
      { method: 'GET', ...(headers ? { headers } : {}) },
      this.timeout,
      signal,
    );

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    this.throwIfAborted(signal);
    const content = await this.readDownloadContent(response, signal);
    this.throwIfAborted(signal);
    return content;
  }

  private async readDownloadContent(response: Response, signal?: AbortSignal): Promise<Buffer> {
    const declaredSize = Number(response.headers?.get('Content-Length'));
    if (Number.isFinite(declaredSize) && declaredSize > this.maxFileSize) {
      throw new Error(`File exceeds max size of ${this.maxFileSize} bytes`);
    }

    if (!response.body) {
      const content = Buffer.from(await this.waitForSignal(
        response.arrayBuffer(),
        signal,
      ));
      if (content.length > this.maxFileSize) {
        throw new Error(`File exceeds max size of ${this.maxFileSize} bytes`);
      }
      return content;
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalSize = 0;
    try {
      while (true) {
        this.throwIfAborted(signal);
        const { done, value } = await this.waitForSignal(
          reader.read(),
          signal,
          () => reader.cancel(signal?.reason),
        );
        if (done) break;
        if (!value) continue;
        totalSize += value.byteLength;
        if (totalSize > this.maxFileSize) {
          await reader.cancel();
          throw new Error(`File exceeds max size of ${this.maxFileSize} bytes`);
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, totalSize);
  }

  /**
   * Delete sync data for a user
   */
  async deleteSyncData(token: string): Promise<boolean> {
    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/v1/sync`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Health check for the sync API
   */
  async healthCheck(): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      clearTimeout(timeoutId);
      return false;
    }
  }

  /**
   * Get size limits
   */
  get limits() {
    return {
      maxFileSize: this.maxFileSize,
      maxTotalSize: this.maxTotalSize,
    };
  }
}

// Singleton instance
let instance: SyncApiClient | null = null;

export function getSyncApiClient(config?: SyncApiConfig): SyncApiClient {
  if (!instance) {
    instance = new SyncApiClient(config);
  }
  return instance;
}

export function resetSyncApiClient(): void {
  instance = null;
}
