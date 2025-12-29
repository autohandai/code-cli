/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
   * Add a new image attachment
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
   * Convert all images to OpenAI vision API format
   * @returns Array of OpenAI image content objects
   */
  toOpenAIFormat(): OpenAIImageContent[] {
    return this.getAll().map((img) => ({
      type: 'image_url' as const,
      image_url: {
        url: `data:${img.mimeType};base64,${img.data.toString('base64')}`,
      },
    }));
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
 * Models that support vision/image inputs
 */
export const VISION_MODELS = [
  'claude-3-opus',
  'claude-3-sonnet',
  'claude-3-haiku',
  'claude-3.5-sonnet',
  'claude-3.5-haiku',
  'claude-4',
  'gpt-4-vision',
  'gpt-4o',
  'gpt-4o-mini',
  'gemini-pro-vision',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-2.0',
];

/**
 * Check if a model supports vision/image inputs
 * @param model - Model name or ID
 * @returns true if model supports vision
 */
export function supportsVision(model: string): boolean {
  const lowerModel = model.toLowerCase();
  return VISION_MODELS.some((v) => lowerModel.includes(v.toLowerCase()));
}
