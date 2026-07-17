/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { z } from 'zod';
import {
  assertResearchPublicationDraftUnchanged,
  derivePublicationIdempotencyKey,
  type ResearchPublicationDraft,
  type ResearchPublicationVisibility,
} from './ResearchManifestBuilder.js';
import {
  apiErrorResponseSchema,
  assetUploadResponseSchema,
  attemptCreateResponseSchema,
  attemptStatusResponseSchema,
  publicationCommitResponseSchema,
  type AttemptCreateResponse,
  type AttemptStatusResponse,
  type PublicationCommitResponse,
} from './publicationContract.js';

export type { PublicationCommitResponse } from './publicationContract.js';

export type ResearchPublicationFailureKind =
  | 'authentication'
  | 'validation'
  | 'size'
  | 'rate_limit'
  | 'network'
  | 'server'
  | 'conflict'
  | 'cancelled';

export class ResearchPublicationError extends Error {
  constructor(
    message: string,
    readonly kind: ResearchPublicationFailureKind,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ResearchPublicationError';
  }
}

interface RecoveryAsset {
  assetId: string;
  uploadUrl: string;
  sha256: string;
}

interface RecoveryReceipt {
  schemaVersion: 1;
  contractVersion: 'v1';
  apiBaseUrl: string;
  idempotencyKey: string;
  workspaceRelativeMarkdownPath: string;
  markdownSha256: string;
  visibility: ResearchPublicationVisibility;
  requestedSlug: string | null;
  attemptId: string;
  statusUrl: string;
  commitUrl: string;
  assets: Record<string, RecoveryAsset>;
  reportId?: string;
  url?: string;
  accessCodeCaptured: boolean;
  lastUpdatedAt: string;
}

const recoveryReceiptSchema: z.ZodType<RecoveryReceipt> = z.object({
  schemaVersion: z.literal(1),
  contractVersion: z.literal('v1'),
  apiBaseUrl: z.string().url(),
  idempotencyKey: z.string(),
  workspaceRelativeMarkdownPath: z.string(),
  markdownSha256: z.string().regex(/^[a-f0-9]{64}$/),
  visibility: z.enum(['public', 'private']),
  requestedSlug: z.string().nullable(),
  attemptId: z.string(),
  statusUrl: z.string(),
  commitUrl: z.string(),
  assets: z.record(z.string(), z.object({
    assetId: z.string(),
    uploadUrl: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })),
  reportId: z.string().optional(),
  url: z.string().url().optional(),
  accessCodeCaptured: z.boolean(),
  lastUpdatedAt: z.string(),
});

export interface OpenResearchClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  verifyUnchanged?: (draft: ResearchPublicationDraft) => Promise<void>;
}

export interface ResearchPublicationRequestOptions {
  signal?: AbortSignal;
}

export class OpenResearchClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly verifyUnchanged: (draft: ResearchPublicationDraft) => Promise<void>;

  constructor(options: OpenResearchClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.verifyUnchanged = options.verifyUnchanged ?? assertResearchPublicationDraftUnchanged;
  }

  async publish(
    draft: ResearchPublicationDraft,
    token: string,
    options: ResearchPublicationRequestOptions = {},
  ): Promise<PublicationCommitResponse> {
    const { signal } = options;
    throwIfPublicationCancelled(signal);
    const idempotencyKey = derivePublicationIdempotencyKey(draft);
    let receipt = await readMatchingReceipt(draft, idempotencyKey);
    throwIfPublicationCancelled(signal);
    let missingReferences = new Set<string>();

    if (receipt) {
      const status = await this.getStatus(draft.apiOrigin, receipt.statusUrl, token, signal);
      throwIfPublicationCancelled(signal);
      if (status.state === 'committed') {
        return recoveredCommit(status);
      }
      if (status.state === 'revoked') {
        throw new ResearchPublicationError(
          `The saved publication attempt is ${status.state}.`,
          'conflict',
          status.failureCode ?? status.state,
        );
      }
      if (status.state === 'failed' || status.state === 'expired') {
        await fs.remove(draft.receiptPath);
        receipt = null;
      } else {
        missingReferences = new Set(status.missingAssets);
      }
    }

    if (!receipt) {
      const attempt = await this.createAttempt(draft, token, idempotencyKey, signal);
      receipt = receiptFromAttempt(draft, attempt, idempotencyKey);
      await writeReceipt(draft.receiptPath, receipt);
      missingReferences = new Set(
        attempt.assets
          .filter((asset) => asset.state !== 'uploaded' && asset.state !== 'promoted')
          .map((asset) => asset.logicalReference),
      );
    }

    for (const asset of draft.assets) {
      throwIfPublicationCancelled(signal);
      if (!missingReferences.has(asset.logicalReference)) {
        continue;
      }
      const assignment = receipt.assets[asset.logicalReference];
      if (!assignment || assignment.sha256 !== asset.sha256) {
        throw new ResearchPublicationError(
          `The server did not assign image "${asset.logicalReference}".`,
          'validation',
          'asset_assignment_missing',
        );
      }
      await this.uploadAsset(draft.apiOrigin, assignment.uploadUrl, asset, token, signal);
    }

    throwIfPublicationCancelled(signal);
    await this.verifyUnchanged(draft);
    throwIfPublicationCancelled(signal);
    const committed = await this.commit(draft.apiOrigin, receipt.commitUrl, token, signal);
    const updatedReceipt: RecoveryReceipt = {
      ...receipt,
      reportId: committed.reportId,
      url: committed.url,
      accessCodeCaptured: committed.accessCodeAvailable,
      lastUpdatedAt: new Date().toISOString(),
    };
    await writeReceipt(draft.receiptPath, updatedReceipt);
    return committed;
  }

  private createAttempt(
    draft: ResearchPublicationDraft,
    token: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<AttemptCreateResponse> {
    const body = {
      title: draft.title,
      summary: draft.summary,
      ...(draft.requestedSlug ? { slug: draft.requestedSlug } : {}),
      visibility: draft.visibility,
      markdown: draft.markdown,
      markdownSha256: draft.markdownSha256,
      assets: draft.assets.map((asset) => ({
        logicalReference: asset.logicalReference,
        filename: asset.filename,
        mediaType: asset.mediaType,
        byteCount: asset.byteCount,
        sha256: asset.sha256,
        alternativeText: asset.alternativeText,
      })),
      topics: draft.topics,
    };
    return this.requestJson(
      draft.apiOrigin,
      '/api/v1/publication-attempts',
      attemptCreateResponseSchema,
      token,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(body),
      },
      signal,
    );
  }

  private getStatus(
    origin: string,
    statusUrl: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<AttemptStatusResponse> {
    return this.requestJson(origin, statusUrl, attemptStatusResponseSchema, token, {
      method: 'GET',
    }, signal);
  }

  private async uploadAsset(
    origin: string,
    uploadUrl: string,
    asset: ResearchPublicationDraft['assets'][number],
    token: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const uploaded = await this.requestJson(
      origin,
      uploadUrl,
      assetUploadResponseSchema,
      token,
      {
        method: 'PUT',
        headers: {
          'Content-Type': asset.mediaType,
          'Content-Length': String(asset.byteCount),
        },
        body: asset.bytes,
      },
      signal,
    );
    if (uploaded.sha256 !== asset.sha256 || uploaded.byteCount !== asset.byteCount) {
      throw new ResearchPublicationError(
        `The server rejected image "${asset.logicalReference}".`,
        'validation',
        'asset_upload_mismatch',
      );
    }
  }

  private commit(
    origin: string,
    commitUrl: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<PublicationCommitResponse> {
    return this.requestJson(origin, commitUrl, publicationCommitResponseSchema, token, {
      method: 'POST',
    }, signal);
  }

  private async requestJson<T>(
    origin: string,
    route: string,
    schema: z.ZodType<T>,
    token: string,
    init: RequestInit,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    throwIfPublicationCancelled(externalSignal);
    const url = safeApiUrl(origin, route);
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, timeoutController.signal])
      : timeoutController.signal;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          ...headersRecord(init.headers),
          Authorization: `Bearer ${token}`,
        },
        signal,
      });
    } catch (error) {
      if (isAbortError(error) && externalSignal?.aborted) {
        throw publicationCancelledError();
      }
      const timedOut = isAbortError(error) && timeoutController.signal.aborted;
      throw new ResearchPublicationError(
        timedOut
          ? 'The Open Research request timed out.'
          : 'A network error interrupted Open Research publication.',
        'network',
        timedOut ? 'request_timeout' : 'network_error',
      );
    } finally {
      clearTimeout(timeout);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      if (isAbortError(error) && externalSignal?.aborted) {
        throw publicationCancelledError();
      }
      throw new ResearchPublicationError(
        'Open Research returned an invalid response.',
        response.status >= 500 ? 'server' : 'validation',
        'invalid_response',
      );
    }
    if (!response.ok) {
      const parsedError = apiErrorResponseSchema.safeParse(data);
      const code = parsedError.success ? parsedError.data.error.code : `http_${response.status}`;
      const message = parsedError.success
        ? parsedError.data.error.message
        : 'Open Research rejected the request.';
      throw new ResearchPublicationError(message, classifyFailure(response.status, code), code);
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new ResearchPublicationError(
        'Open Research returned a response that does not match publication contract v1.',
        'server',
        'contract_mismatch',
      );
    }
    return parsed.data;
  }
}

function receiptFromAttempt(
  draft: ResearchPublicationDraft,
  attempt: AttemptCreateResponse,
  idempotencyKey: string,
): RecoveryReceipt {
  const assignments = Object.fromEntries(
    attempt.assets.map((asset) => {
      const declaration = draft.assets.find(
        (candidate) => candidate.logicalReference === asset.logicalReference,
      );
      if (!declaration) {
        throw new ResearchPublicationError(
          'Open Research returned an unknown asset assignment.',
          'server',
          'contract_mismatch',
        );
      }
      return [asset.logicalReference, {
        assetId: asset.assetId,
        uploadUrl: asset.uploadUrl,
        sha256: declaration.sha256,
      }];
    }),
  );
  return {
    schemaVersion: 1,
    contractVersion: 'v1',
    apiBaseUrl: draft.apiOrigin,
    idempotencyKey,
    workspaceRelativeMarkdownPath: draft.workspaceRelativeMarkdownPath,
    markdownSha256: draft.markdownSha256,
    visibility: draft.visibility,
    requestedSlug: draft.requestedSlug ?? null,
    attemptId: attempt.attemptId,
    statusUrl: attempt.statusUrl,
    commitUrl: attempt.commitUrl,
    assets: assignments,
    accessCodeCaptured: false,
    lastUpdatedAt: new Date().toISOString(),
  };
}

async function readMatchingReceipt(
  draft: ResearchPublicationDraft,
  idempotencyKey: string,
): Promise<RecoveryReceipt | null> {
  if (!(await fs.pathExists(draft.receiptPath))) {
    return null;
  }
  try {
    const parsed = recoveryReceiptSchema.safeParse(await fs.readJson(draft.receiptPath));
    if (!parsed.success) {
      return null;
    }
    const receipt = parsed.data;
    if (
      receipt.apiBaseUrl !== draft.apiOrigin
      || receipt.idempotencyKey !== idempotencyKey
      || receipt.workspaceRelativeMarkdownPath !== draft.workspaceRelativeMarkdownPath
      || receipt.markdownSha256 !== draft.markdownSha256
      || receipt.visibility !== draft.visibility
      || receipt.requestedSlug !== (draft.requestedSlug ?? null)
    ) {
      return null;
    }
    const receiptReferences = Object.keys(receipt.assets).sort();
    const draftReferences = draft.assets.map((asset) => asset.logicalReference).sort();
    if (JSON.stringify(receiptReferences) !== JSON.stringify(draftReferences)) {
      return null;
    }
    if (draft.assets.some((asset) => receipt.assets[asset.logicalReference]?.sha256 !== asset.sha256)) {
      return null;
    }
    return receipt;
  } catch {
    return null;
  }
}

async function writeReceipt(receiptPath: string, receipt: RecoveryReceipt): Promise<void> {
  await fs.ensureDir(path.dirname(receiptPath));
  const tempPath = path.join(
    path.dirname(receiptPath),
    `.open-research-receipt-${randomUUID()}.tmp`,
  );
  await fs.writeFile(tempPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.move(tempPath, receiptPath, { overwrite: true });
  await fs.chmod(receiptPath, 0o600);
}

function recoveredCommit(status: AttemptStatusResponse): PublicationCommitResponse {
  if (!status.reportId || !status.reportUrl) {
    throw new ResearchPublicationError(
      'The committed publication is missing its canonical address.',
      'server',
      'contract_mismatch',
    );
  }
  return {
    reportId: status.reportId,
    visibility: status.visibility,
    revision: status.revision ?? 1,
    url: status.reportUrl,
    accessCode: null,
    accessCodeAvailable: false,
    idempotentReplay: true,
  };
}

function safeApiUrl(origin: string, route: string): string {
  const base = new URL(origin);
  const resolved = new URL(route, `${base.origin}/`);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith('/api/v1/')) {
    throw new ResearchPublicationError(
      'Open Research returned an unsafe API route.',
      'server',
      'contract_mismatch',
    );
  }
  return resolved.toString();
}

function headersRecord(headers: RequestInit['headers']): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}

function classifyFailure(status: number, code: string): ResearchPublicationFailureKind {
  if (status === 401 || status === 403) return 'authentication';
  if (status === 413 || code.includes('too_large')) return 'size';
  if (status === 429) return 'rate_limit';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  if (status >= 500) return 'server';
  return 'server';
}

function throwIfPublicationCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw publicationCancelledError();
  }
}

function publicationCancelledError(): ResearchPublicationError {
  return new ResearchPublicationError(
    'Open Research publication was cancelled.',
    'cancelled',
    'publication_cancelled',
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
