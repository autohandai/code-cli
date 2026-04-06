/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { compressImageBufferWithTargetLimit, IMAGE_TARGET_RAW_SIZE } from '../utils/imageCompression.js';

/**
 * Supported image MIME types for multimodal LLM inputs
 */
export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/**
 * Image attachment stored in session
 */
export interface ImageAttachment {
  id: number;
  data: Buffer;
  mimeType: ImageMimeType;
  filename?: string;
  width?: number;
  height?: number;
}

/**
 * Claude vision API format
 */
export interface ClaudeImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

/**
 * OpenAI vision API format
 */
export interface OpenAIImageContent {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

/**
 * Manages image attachments for multimodal LLM sessions.
 * Tracks images sequentially as [Image #1], [Image #2], etc.
 */
export class ImageManager {
  private images: Map<number, ImageAttachment> = new Map();
  private counter = 0;

  /**
   * Maximum image size before compression (3.75MB raw target, cc-src's IMAGE_TARGET_RAW_SIZE).
   * Accounts for base64 4/3 expansion to stay under 5MB API limit.
   */
  private static readonly MAX_IMAGE_SIZE = IMAGE_TARGET_RAW_SIZE;

  /**
   * Add a new image attachment (sync — compression happens lazily in toOpenAIFormat).
   * @param data - Raw image data as Buffer
   * @param mimeType - Image MIME type
   * @param filename - Optional original filename
   * @returns Sequential image ID starting from 1
   */
  add(data: Buffer, mimeType: ImageMimeType, filename?: string): number {
    const id = ++this.counter;

    this.images.set(id, {
      id,
      data,
      mimeType,
      filename,
    });

    return id;
  }

  /**
   * Add a new image attachment without compression (for internal use)
   * @param data - Raw image data as Buffer
   * @param mimeType - Image MIME type
   * @param filename - Optional original filename
   * @returns Sequential image ID starting from 1
   */
  addRaw(data: Buffer, mimeType: ImageMimeType, filename?: string): number {
    const id = ++this.counter;
    this.images.set(id, {
      id,
      data,
      mimeType,
      filename,
    });
    return id;
  }

  /**
   * Get image by ID
   * @param id - Image ID
   * @returns Image attachment or undefined if not found
   */
  get(id: number): ImageAttachment | undefined {
    return this.images.get(id);
  }

  /**
   * Get all images in order they were added
   * @returns Array of image attachments sorted by ID
   */
  getAll(): ImageAttachment[] {
    return Array.from(this.images.values()).sort((a, b) => a.id - b.id);
  }

  /**
   * Clear all images and reset counter (called on /new or session end)
   */
  clear(): void {
    this.images.clear();
    this.counter = 0;
  }

  /**
   * Get number of images currently stored
   */
  count(): number {
    return this.images.size;
  }

  /**
   * Convert all images to Claude vision API format
   * @returns Array of Claude image content objects
   */
  toClaudeFormat(): ClaudeImageContent[] {
    return this.getAll().map((img) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: img.mimeType,
        data: img.data.toString('base64'),
      },
    }));
  }

  /**
   * Convert all images to OpenAI vision API format.
   * Images exceeding the target size are properly compressed (not truncated).
   * @param tokenLimit - Optional token budget for image compression
   * @returns Array of OpenAI image content objects
   */
  async toOpenAIFormat(tokenLimit?: number): Promise<OpenAIImageContent[]> {
    const allImages = this.getAll();
    const results: OpenAIImageContent[] = [];

    for (const img of allImages) {
      let base64Data = img.data.toString('base64');

      // If we have a token limit, compress the image to fit
      if (tokenLimit) {
        const compressed = await compressImageBufferWithTargetLimit(
          img.data,
          tokenLimit,
          img.mimeType,
        );
        base64Data = compressed.base64;
      } else {
        // For images stored above the raw target size, compress them
        if (img.data.length > ImageManager.MAX_IMAGE_SIZE) {
          const compressed = await compressImageBufferWithTargetLimit(
            img.data,
            Math.floor(IMAGE_TARGET_RAW_SIZE),
            img.mimeType,
          );
          base64Data = compressed.base64;
        }
      }

      results.push({
        type: 'image_url' as const,
        image_url: {
          url: `data:${img.mimeType};base64,${base64Data}`,
        },
      });
    }

    return results;
  }

  /**
   * Format placeholder text for display
   * @param id - Image ID
   * @returns Placeholder string like "[Image #1] filename.png" or empty string if not found
   */
  formatPlaceholder(id: number): string {
    const image = this.get(id);
    if (!image) {
      return '';
    }
    if (image.filename) {
      return `[Image #${id}] ${image.filename}`;
    }
    return `[Image #${id}]`;
  }
}

/**
 * Supported image file extensions
 */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

/**
 * Check if a file path is an image based on extension
 * @param path - File path to check
 * @returns true if path ends with a supported image extension
 */
export function isImagePath(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
}

/**
 * Check if a string is a base64 image data URL
 * @param str - String to check
 * @returns true if string is a valid image data URL
 */
export function isBase64Image(str: string): boolean {
  return str.startsWith('data:image/') && str.includes(';base64,');
}

/**
 * Extract MIME type from a file extension
 * @param ext - File extension (with or without dot)
 * @returns ImageMimeType or undefined if not supported
 */
export function getMimeTypeFromExtension(ext: string): ImageMimeType | undefined {
  const normalized = ext.toLowerCase().replace(/^\./, '');
  switch (normalized) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return undefined;
  }
}

/**
 * Parse a base64 data URL and extract the image data
 * @param dataUrl - Data URL string
 * @returns Object with mimeType and data Buffer, or undefined if invalid
 */
export function parseBase64DataUrl(
  dataUrl: string
): { mimeType: ImageMimeType; data: Buffer } | undefined {
  if (!isBase64Image(dataUrl)) {
    return undefined;
  }

  const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) {
    return undefined;
  }

  const [, mimeType, base64Data] = match;

  // Validate MIME type
  if (
    mimeType !== 'image/png' &&
    mimeType !== 'image/jpeg' &&
    mimeType !== 'image/gif' &&
    mimeType !== 'image/webp'
  ) {
    return undefined;
  }

  try {
    const data = Buffer.from(base64Data, 'base64');
    return { mimeType: mimeType as ImageMimeType, data };
  } catch {
    return undefined;
  }
}

/**
 * Models that support vision/image inputs (fallback list)
 * For dynamic detection, use modelSupportsImages() from providers/modelCapabilities.js
 */
export const VISION_MODELS = [
  'claude-3-opus',
  'claude-3-sonnet',
  'claude-3-haiku',
  'claude-3.5-sonnet',
  'claude-3.5-haiku',
  'claude-3.7-sonnet',
  'claude-4',
  'claude-sonnet-4',
  'claude-opus-4',
  'gpt-4-vision',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.5',
  'gpt-4-turbo',
  'chatgpt-4o',
  'gemini-pro-vision',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-2.0',
  'gemini-2.5',
  'pixtral',
  'qwen-vl',
  'minicpm-v',
  'deepseek-vl',
];

/**
 * Check if a model supports vision/image inputs (synchronous, pattern-based)
 * For dynamic detection from OpenRouter API, use modelSupportsImages() instead.
 * @param model - Model name or ID
 * @returns true if model supports vision
 */
export function supportsVision(model: string): boolean {
  const lowerModel = model.toLowerCase();

  // Check against expanded fallback list
  if (VISION_MODELS.some((v) => lowerModel.includes(v.toLowerCase()))) {
    return true;
  }

  // Additional pattern checks for models not in the list
  if (
    lowerModel.includes('vision') ||
    lowerModel.includes('vl-') ||
    lowerModel.includes('-vl') ||
    lowerModel.includes('multimodal')
  ) {
    return true;
  }

  // Claude 3+ and 4+ all support vision
  if (/claude-[3-9]/.test(lowerModel) || /claude-(sonnet|opus)-[4-9]/.test(lowerModel)) {
    return true;
  }

  // GPT-4o and variants
  if (lowerModel.includes('gpt-4o') || lowerModel.includes('gpt-4-turbo') || lowerModel.includes('gpt-4.5')) {
    return true;
  }

  // Gemini 1.5+ and 2.x
  if (/gemini-[1-9]\.[0-9]/.test(lowerModel)) {
    return true;
  }

  // Pixtral, Qwen VL, MiniCPM-V, DeepSeek VL
  if (
    lowerModel.includes('pixtral') ||
    (lowerModel.includes('qwen') && lowerModel.includes('vl')) ||
    (lowerModel.includes('minicpm') && lowerModel.includes('v')) ||
    (lowerModel.includes('deepseek') && lowerModel.includes('vl'))
  ) {
    return true;
  }

  return false;
}
