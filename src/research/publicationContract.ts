/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

const opaqueId = (prefix: 'pa' | 'ra' | 'or') =>
  z.string().regex(new RegExp(`^${prefix}_[0-9a-hjkmnp-tv-z]{26}$`));
const visibility = z.enum(['public', 'private']);
const attemptState = z.enum([
  'staging',
  'ready',
  'committing',
  'committed',
  'failed',
  'expired',
  'revoked',
]);
const assetState = z.enum([
  'declared',
  'uploading',
  'uploaded',
  'rejected',
  'promoted',
  'expired',
]);
const logicalReference = z.string().min(1).max(260);

export const attemptCreateResponseSchema = z.object({
  attemptId: opaqueId('pa'),
  state: attemptState,
  visibility,
  slug: z.string().nullable(),
  expiresAt: z.string(),
  idempotentReplay: z.boolean(),
  assets: z.array(z.object({
    assetId: opaqueId('ra'),
    logicalReference,
    state: assetState,
    uploadUrl: z.string().startsWith('/api/v1/publication-attempts/'),
  })),
  statusUrl: z.string().startsWith('/api/v1/publication-attempts/'),
  commitUrl: z.string().startsWith('/api/v1/publication-attempts/'),
});

export const attemptStatusResponseSchema = z.object({
  attemptId: opaqueId('pa'),
  state: attemptState,
  visibility,
  slug: z.string().nullable(),
  expiresAt: z.string(),
  failureCode: z.string().nullable(),
  missingAssets: z.array(logicalReference),
  reportId: opaqueId('or').nullable(),
  reportUrl: z.string().url().nullable(),
  revision: z.number().int().positive().optional(),
});

export const assetUploadResponseSchema = z.object({
  attemptId: opaqueId('pa'),
  assetId: opaqueId('ra'),
  state: z.literal('uploaded'),
  byteCount: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const commitBase = z.object({
  reportId: opaqueId('or'),
  revision: z.number().int().positive(),
  url: z.string().url(),
});
export const publicationCommitResponseSchema = z.union([
  commitBase.extend({
    visibility: z.literal('public'),
    accessCode: z.null(),
    accessCodeAvailable: z.literal(false),
    idempotentReplay: z.boolean(),
  }),
  commitBase.extend({
    visibility: z.literal('private'),
    accessCode: z.string().min(24).max(80),
    accessCodeAvailable: z.literal(true),
    idempotentReplay: z.literal(false),
  }),
  commitBase.extend({
    visibility: z.literal('private'),
    accessCode: z.null(),
    accessCodeAvailable: z.literal(false),
    idempotentReplay: z.literal(true),
  }),
]);

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(500),
  }),
  requestId: z.string().optional(),
});

export type AttemptCreateResponse = z.infer<typeof attemptCreateResponseSchema>;
export type AttemptStatusResponse = z.infer<typeof attemptStatusResponseSchema>;
export type PublicationCommitResponse = z.infer<typeof publicationCommitResponseSchema>;
