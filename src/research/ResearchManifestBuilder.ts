/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import type { Code, Heading, Image, Link, Paragraph, PhrasingContent, Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import sharp from 'sharp';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

export const RESEARCH_PUBLICATION_LIMITS = Object.freeze({
  titleCharacters: 180,
  summaryCharacters: 500,
  markdownBytes: 512 * 1024,
  assetCount: 20,
  assetBytes: 10 * 1024 * 1024,
  totalAssetBytes: 25 * 1024 * 1024,
  alternativeTextCharacters: 500,
});

export type ResearchPublicationVisibility = 'public' | 'private';
export type ResearchImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export interface ResearchPublicationAsset {
  logicalReference: string;
  filename: string;
  mediaType: ResearchImageMediaType;
  byteCount: number;
  sha256: string;
  alternativeText: string;
  absolutePath: string;
  bytes: Buffer;
}

export interface ResearchPublicationDraft {
  apiOrigin: string;
  workspaceRootRealPath: string;
  markdownAbsolutePath: string;
  workspaceRelativeMarkdownPath: string;
  receiptPath: string;
  title: string;
  summary: string;
  visibility: ResearchPublicationVisibility;
  requestedSlug?: string;
  markdown: string;
  markdownBytes: Buffer;
  markdownSha256: string;
  assets: ResearchPublicationAsset[];
  topics: string[];
  totalUploadBytes: number;
}

export interface BuildResearchPublicationDraftOptions {
  workspaceRoot: string;
  markdownPath: string;
  visibility: ResearchPublicationVisibility;
  apiBaseUrl: string;
  requestedSlug?: string;
  topics?: string[];
}

export interface ValidatedResearchMarkdownPath {
  workspaceRootRealPath: string;
  markdownAbsolutePath: string;
  workspaceRelativeMarkdownPath: string;
}

export class ResearchPublicationValidationError extends Error {
  readonly kind = 'validation';

  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ResearchPublicationValidationError';
  }
}

export async function validateResearchMarkdownPath(
  workspaceRoot: string,
  markdownPath: string,
): Promise<ValidatedResearchMarkdownPath> {
  const workspaceRootRealPath = await realDirectory(workspaceRoot, 'workspace_unavailable');
  const candidate = path.isAbsolute(markdownPath)
    ? path.resolve(markdownPath)
    : path.resolve(workspaceRootRealPath, markdownPath);

  const markdownAbsolutePath = await realRegularFile(
    candidate,
    workspaceRootRealPath,
    'research report',
  );
  const workspaceRelativeMarkdownPath = toPosixPath(
    path.relative(workspaceRootRealPath, markdownAbsolutePath),
  );
  if (!workspaceRelativeMarkdownPath || workspaceRelativeMarkdownPath.startsWith('../')) {
    throw validation('The research path is outside the active workspace.', 'path_outside_workspace');
  }

  return {
    workspaceRootRealPath,
    markdownAbsolutePath,
    workspaceRelativeMarkdownPath,
  };
}

export async function buildResearchPublicationDraft(
  options: BuildResearchPublicationDraftOptions,
): Promise<ResearchPublicationDraft> {
  const validatedPath = await validateResearchMarkdownPath(
    options.workspaceRoot,
    options.markdownPath,
  );
  const markdownBytes = await fs.readFile(validatedPath.markdownAbsolutePath);
  if (markdownBytes.byteLength === 0) {
    throw validation('The research report is empty.', 'markdown_empty');
  }
  if (markdownBytes.byteLength > RESEARCH_PUBLICATION_LIMITS.markdownBytes) {
    throw validation('The research report exceeds the 512 KiB publication limit.', 'markdown_too_large');
  }

  let markdown: string;
  try {
    markdown = new TextDecoder('utf-8', { fatal: true }).decode(markdownBytes);
  } catch {
    throw validation('The research report must be valid UTF-8 Markdown.', 'markdown_invalid_utf8');
  }

  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root;
  const titleNode = tree.children.find(
    (node): node is Heading => node.type === 'heading' && node.depth === 1,
  );
  const title = titleNode ? phrasingText(titleNode.children) : '';
  if (!title) {
    throw validation('The research report needs a non-empty level-one title.', 'title_missing');
  }
  if (title.length > RESEARCH_PUBLICATION_LIMITS.titleCharacters) {
    throw validation('The research title exceeds 180 characters.', 'title_too_long');
  }

  const titleIndex = titleNode ? tree.children.indexOf(titleNode) : -1;
  const summaryNode = tree.children
    .slice(titleIndex + 1)
    .find((node): node is Paragraph => node.type === 'paragraph');
  const summary = summaryNode ? phrasingText(summaryNode.children) : '';
  if (!summary) {
    throw validation('The research report needs a summary paragraph after its title.', 'summary_missing');
  }
  if (summary.length > RESEARCH_PUBLICATION_LIMITS.summaryCharacters) {
    throw validation('The research summary exceeds 500 characters.', 'summary_too_long');
  }

  const images: Image[] = [];
  visit(tree, (node) => {
    if (node.type === 'html') {
      throw validation('Raw HTML is not accepted in published research.', 'raw_html');
    }
    if (node.type === 'code') {
      const language = ((node as Code).lang ?? '').toLowerCase();
      if (language === 'mermaid' || language === 'svg') {
        throw validation('Executable diagram source is not accepted.', 'executable_diagram');
      }
    }
    if (node.type === 'link') {
      validateMarkdownLink(node as Link);
    }
    if (node.type === 'image') {
      images.push(node as Image);
    }
  });

  const assetsByReference = new Map<string, ResearchPublicationAsset>();
  const markdownDirectory = path.dirname(validatedPath.markdownAbsolutePath);
  for (const image of images) {
    const logicalReference = normalizeLogicalReference(image.url);
    validateLogicalReference(logicalReference);
    const alternativeText = image.alt?.trim() ?? '';
    if (!alternativeText) {
      throw validation('Every published image needs alternative text.', 'alternative_text_missing');
    }
    if (alternativeText.length > RESEARCH_PUBLICATION_LIMITS.alternativeTextCharacters) {
      throw validation('Image alternative text exceeds 500 characters.', 'alternative_text_too_long');
    }

    const previous = assetsByReference.get(logicalReference);
    if (previous) {
      if (previous.alternativeText !== alternativeText) {
        throw validation(
          `Image "${logicalReference}" is used with different alternative text.`,
          'alternative_text_mismatch',
        );
      }
      continue;
    }

    const candidate = path.resolve(markdownDirectory, logicalReference);
    const absolutePath = await realRegularFile(
      candidate,
      validatedPath.workspaceRootRealPath,
      `image "${logicalReference}"`,
    );
    const bytes = await fs.readFile(absolutePath);
    if (bytes.byteLength === 0 || bytes.byteLength > RESEARCH_PUBLICATION_LIMITS.assetBytes) {
      throw validation(
        `Image "${logicalReference}" exceeds the supported size.`,
        'asset_too_large',
      );
    }
    const mediaType = detectRasterMediaType(bytes);
    if (!mediaType) {
      throw validation(
        `Image "${logicalReference}" is not a supported PNG, JPEG, WebP, or GIF.`,
        'asset_unsupported',
      );
    }
    await validateRasterBytes(bytes, mediaType, logicalReference);
    assetsByReference.set(logicalReference, {
      logicalReference,
      filename: path.basename(absolutePath),
      mediaType,
      byteCount: bytes.byteLength,
      sha256: sha256(bytes),
      alternativeText,
      absolutePath,
      bytes,
    });
  }

  const assets = [...assetsByReference.values()]
    .sort((left, right) => left.logicalReference.localeCompare(right.logicalReference));
  if (assets.length > RESEARCH_PUBLICATION_LIMITS.assetCount) {
    throw validation('The research report contains more than 20 distinct images.', 'too_many_assets');
  }
  const totalAssetBytes = assets.reduce((total, asset) => total + asset.byteCount, 0);
  if (totalAssetBytes > RESEARCH_PUBLICATION_LIMITS.totalAssetBytes) {
    throw validation('The report images exceed the 25 MiB combined limit.', 'assets_too_large');
  }

  const apiOrigin = normalizeApiOrigin(options.apiBaseUrl);
  return {
    apiOrigin,
    ...validatedPath,
    receiptPath: `${validatedPath.markdownAbsolutePath}.publication.json`,
    title,
    summary,
    visibility: options.visibility,
    ...(options.requestedSlug ? { requestedSlug: options.requestedSlug } : {}),
    markdown,
    markdownBytes,
    markdownSha256: sha256(markdownBytes),
    assets,
    topics: options.topics ?? [],
    totalUploadBytes: markdownBytes.byteLength + totalAssetBytes,
  };
}

export function derivePublicationIdempotencyKey(draft: ResearchPublicationDraft): string {
  const assetIdentity = [...draft.assets]
    .sort((left, right) => left.logicalReference.localeCompare(right.logicalReference))
    .flatMap((asset) => [asset.logicalReference, asset.sha256]);
  const digest = createHash('sha256')
    .update([
      draft.apiOrigin,
      draft.workspaceRelativeMarkdownPath,
      draft.markdownSha256,
      draft.visibility,
      draft.requestedSlug ?? '',
      ...assetIdentity,
    ].join('\0'))
    .digest('hex')
    .slice(0, 48);
  return `deep-research-v1:${digest}`;
}

export async function assertResearchPublicationDraftUnchanged(
  draft: ResearchPublicationDraft,
): Promise<void> {
  await assertFileSnapshot(
    draft.markdownAbsolutePath,
    draft.workspaceRootRealPath,
    draft.markdownSha256,
    draft.markdownBytes.byteLength,
    'research report',
  );
  for (const asset of draft.assets) {
    await assertFileSnapshot(
      asset.absolutePath,
      draft.workspaceRootRealPath,
      asset.sha256,
      asset.byteCount,
      `image "${asset.logicalReference}"`,
    );
  }
}

function normalizeApiOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw validation('The Open Research host is invalid.', 'api_origin_invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw validation('The Open Research host must use HTTP or HTTPS.', 'api_origin_invalid');
  }
  return parsed.origin;
}

function validateMarkdownLink(node: Link): void {
  const value = node.url.trim();
  if (value.startsWith('#') || value.startsWith('/')) {
    return;
  }
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw validation('Markdown contains an unsafe or invalid link.', 'link_invalid');
  }
}

function normalizeLogicalReference(value: string): string {
  return value.replace(/^\.\//, '');
}

function validateLogicalReference(value: string): void {
  if (
    !value
    || /^([a-z][a-z\d+.-]*:)?\/\//i.test(value)
    || value.startsWith('data:')
    || value.startsWith('/')
    || value.includes('\\')
    || value.includes('\0')
    || value.split('/').includes('..')
    || value.includes('?')
    || value.includes('#')
  ) {
    throw validation(
      'Remote or unsafe Markdown images are not accepted.',
      'asset_reference_unsafe',
    );
  }
}

function phrasingText(children: PhrasingContent[]): string {
  return children
    .map((child) => {
      if ('value' in child && typeof child.value === 'string') {
        return child.value;
      }
      if ('children' in child && Array.isArray(child.children)) {
        return phrasingText(child.children as PhrasingContent[]);
      }
      return '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectRasterMediaType(bytes: Buffer): ResearchImageMediaType | null {
  if (
    bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  const gifHeader = bytes.subarray(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return 'image/gif';
  }
  return null;
}

async function validateRasterBytes(
  bytes: Buffer,
  mediaType: ResearchImageMediaType,
  logicalReference: string,
): Promise<void> {
  try {
    const metadata = await sharp(bytes, {
      animated: true,
      limitInputPixels: 40_000_000,
    }).metadata();
    const expectedFormat: Record<ResearchImageMediaType, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpeg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (
      metadata.format !== expectedFormat[mediaType]
      || width < 1
      || height < 1
      || width > 12_000
      || height > 12_000
      || width * height > 40_000_000
    ) {
      throw new Error('invalid image metadata');
    }
  } catch {
    throw validation(
      `Image "${logicalReference}" is corrupt or exceeds the supported dimensions.`,
      'asset_invalid',
    );
  }
}

async function assertFileSnapshot(
  filePath: string,
  workspaceRootRealPath: string,
  expectedDigest: string,
  expectedBytes: number,
  label: string,
): Promise<void> {
  try {
    const currentRealPath = await realRegularFile(filePath, workspaceRootRealPath, label);
    if (currentRealPath !== filePath) {
      throw new Error('real path changed');
    }
    const bytes = await fs.readFile(currentRealPath);
    if (bytes.byteLength !== expectedBytes || sha256(bytes) !== expectedDigest) {
      throw new Error('digest changed');
    }
  } catch (error) {
    if (error instanceof ResearchPublicationValidationError) {
      throw error;
    }
    throw validation(
      `The ${label} changed after the publication preview. Review it and try again.`,
      'file_changed',
    );
  }
}

async function realDirectory(value: string, code: string): Promise<string> {
  try {
    const realPath = await fs.realpath(value);
    const stat = await fs.stat(realPath);
    if (!stat.isDirectory()) {
      throw new Error('not a directory');
    }
    return realPath;
  } catch {
    throw validation('The active workspace is unavailable.', code);
  }
}

async function realRegularFile(
  candidate: string,
  workspaceRootRealPath: string,
  label: string,
): Promise<string> {
  try {
    const realPath = await fs.realpath(candidate);
    if (!isInside(workspaceRootRealPath, realPath)) {
      throw validation(
        `The ${label} resolves outside the active workspace.`,
        'path_outside_workspace',
      );
    }
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) {
      throw validation(`The ${label} is not a regular file.`, 'file_not_regular');
    }
    await fs.access(realPath, fs.constants.R_OK);
    return realPath;
  } catch (error) {
    if (error instanceof ResearchPublicationValidationError) {
      throw error;
    }
    throw validation(`The ${label} is missing or unreadable.`, 'file_unreadable');
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function validation(message: string, code: string): ResearchPublicationValidationError {
  return new ResearchPublicationValidationError(message, code);
}
