/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import sharp from 'sharp';
import type { ImageMimeType } from '../core/ImageManager.js';

/**
 * Maximum raw byte size before compression kicks in.
 * Derived from API_IMAGE_MAX_BASE64_SIZE (5MB / 5,242,880 chars)
 * accounting for base64's 4/3 expansion: 5MB / (4/3) = 3.75MB.
 */
export const IMAGE_TARGET_RAW_SIZE = 3.75 * 1024 * 1024; // 3,932,160 bytes

/**
 * Maximum image dimension (width or height) in pixels.
 * Matches the cc-src approach for consistent behavior.
 */
export const IMAGE_MAX_DIMENSION = 2000;

/**
 * Result from compressing an image buffer.
 */
export interface CompressedImageResult {
  base64: string;
  mediaType: ImageMimeType;
  originalSize: number;
}

/**
 * Detect image format from a buffer using magic bytes.
 * More reliable than file extension or MIME type.
 */
export function detectImageFormatFromBuffer(buffer: Buffer): ImageMimeType {
  if (buffer.length < 4) return 'image/png';

  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: 47 49 46 ("GIF", then 87a or 89a)
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }

  // WebP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46
  ) {
    if (
      buffer.length >= 12 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return 'image/webp';
    }
  }

  return 'image/png'; // default fallback
}

/**
 * Compress an image to reduce file size while maintaining visual quality.
 *
 * Multi-stage pipeline (inspired by cc-src):
 * 1. No-op: if image is already under target size and within max dimensions, return as-is
 * 2. Compression-first: try to shrink file size *without* resizing (preserves resolution)
 * 3. Dimension resize: only if dimensions exceed IMAGE_MAX_DIMENSION
 * 4. Aggressive fallback: resize smaller + JPEG quality 20
 *
 * Each stage uses fresh sharp() instances — reused instances don't apply format
 * conversion correctly when chained after toBuffer().
 */
export async function compressImage(
  data: Buffer,
  mimeType: ImageMimeType,
): Promise<{ compressedData: Buffer; mimeType: ImageMimeType }> {
  if (data.length === 0) {
    throw new Error('Image buffer is empty');
  }

  try {
    // Validate input early — sharp throws for corrupt data
    let probeMetadata: sharp.Metadata;
    try {
      probeMetadata = await sharp(data).metadata();
    } catch {
      throw new Error('Unable to parse image data');
    }

    if (!probeMetadata.format) {
      throw new Error('Unable to parse image data');
    }

    const metadata = probeMetadata;

    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const format = metadata.format; // 'png', 'jpeg', 'webp', 'gif'

    // Stage 1: No-op path — image already fits within all limits
    if (
      data.length <= IMAGE_TARGET_RAW_SIZE &&
      width <= IMAGE_MAX_DIMENSION &&
      height <= IMAGE_MAX_DIMENSION
    ) {
      return { compressedData: data, mimeType };
    }

    // Stage 2: Compression-first (no dimension change)
    if (
      width <= IMAGE_MAX_DIMENSION &&
      height <= IMAGE_MAX_DIMENSION
    ) {
      const compressed = await tryCompressWithoutResize(
        data,
        format,
      );
      if (compressed) {
        return compressed;
      }
    }

    // Stage 3: Dimension resize
    const targetWidth = Math.min(width, IMAGE_MAX_DIMENSION);
    const targetHeight = Math.min(height, IMAGE_MAX_DIMENSION);

    // Try PNG palette optimization at resized dimensions
    if (format === 'png') {
      const pngBuf = await sharp(data)
        .resize(targetWidth, targetHeight, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9, palette: true })
        .toBuffer();
      if (pngBuf.length <= IMAGE_TARGET_RAW_SIZE) {
        return { compressedData: pngBuf, mimeType: 'image/png' };
      }
    }

    // Try JPEG at varying quality levels
    for (const quality of [80, 60, 40, 20]) {
      const jpegBuf = await sharp(data)
        .resize(targetWidth, targetHeight, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
      if (jpegBuf.length <= IMAGE_TARGET_RAW_SIZE) {
        return { compressedData: jpegBuf, mimeType: 'image/jpeg' };
      }
    }

    // Stage 4: Aggressive fallback — resize to min(dim, 1000) + JPEG quality 20
    const aggressiveWidth = Math.min(targetWidth, 1000);
    const aggressiveHeight = Math.round(
      (targetHeight * aggressiveWidth) / Math.max(targetWidth, 1)
    );
    const finalBuf = await sharp(data)
      .resize(aggressiveWidth, aggressiveHeight, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 20 })
      .toBuffer();

    return { compressedData: finalBuf, mimeType: 'image/jpeg' };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Image buffer is empty' || message === 'Unable to parse image data') {
      throw error;
    }
    // Re-throw if the original image was already under the limit
    if (data.length <= IMAGE_TARGET_RAW_SIZE) {
      return { compressedData: data, mimeType };
    }
    throw new Error(`Failed to compress image: ${message}`);
  }
}

/**
 * Try to compress an image without changing its dimensions.
 * Returns null if no strategy produces an image under the target size.
 */
async function tryCompressWithoutResize(
  data: Buffer,
  format: string | undefined,
): Promise<{ compressedData: Buffer; mimeType: ImageMimeType } | null> {
  // PNG: try palette optimization
  if (format === 'png') {
    const pngBuf = await sharp(data)
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
    if (pngBuf.length <= IMAGE_TARGET_RAW_SIZE) {
      return { compressedData: pngBuf, mimeType: 'image/png' };
    }
  }

  // WebP: try recompressing
  if (format === 'webp') {
    const webpBuf = await sharp(data)
      .webp({ quality: 80, lossless: false })
      .toBuffer();
    if (webpBuf.length <= IMAGE_TARGET_RAW_SIZE) {
      return { compressedData: webpBuf, mimeType: 'image/webp' };
    }
  }

  // Try JPEG conversion at progressively lower qualities
  for (const quality of [80, 60, 40, 20]) {
    const jpegBuf = await sharp(data)
      .jpeg({ quality })
      .toBuffer();
    if (jpegBuf.length <= IMAGE_TARGET_RAW_SIZE) {
      return { compressedData: jpegBuf, mimeType: 'image/jpeg' };
    }
  }

  return null;
}

/**
 * Compress an image buffer to fit within a maximum byte size.
 * Multi-strategy fallback: progressive resize → palette PNG → JPEG → ultra-compressed.
 */
export async function compressImageBuffer(
  imageBuffer: Buffer,
  maxBytes: number = IMAGE_TARGET_RAW_SIZE,
  originalMediaType?: string,
): Promise<CompressedImageResult> {
  if (imageBuffer.length === 0) {
    throw new Error('Image buffer is empty');
  }

  const fallbackFormat = (originalMediaType?.split('/')[1] || 'jpeg').replace('jpg', 'jpeg');
  const metadata = await sharp(imageBuffer).metadata();
  const format = metadata.format || fallbackFormat;

  // Already under limit
  if (imageBuffer.length <= maxBytes) {
    return {
      base64: imageBuffer.toString('base64'),
      mediaType: `image/${format === 'jpg' ? 'jpeg' : format}` as ImageMimeType,
      originalSize: imageBuffer.length,
    };
  }

  // Very small budgets need an aggressive first step to avoid repeated multi-megapixel passes.
  if (maxBytes <= 1024 * 1024) {
    const budgetDimension = Math.max(300, Math.min(1200, Math.round(Math.sqrt(maxBytes))));
    for (const quality of [70, 50, 35, 20]) {
      const jpegBuf = await sharp(imageBuffer)
        .resize(budgetDimension, budgetDimension, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
      if (jpegBuf.length <= maxBytes) {
        return {
          base64: jpegBuf.toString('base64'),
          mediaType: 'image/jpeg',
          originalSize: imageBuffer.length,
        };
      }
    }
  }

  // Start close to the required byte budget to avoid several expensive full-size passes.
  const budgetDimension = Math.max(400, Math.min(IMAGE_MAX_DIMENSION, Math.round(Math.sqrt(maxBytes * 1.5))));
  const estimatedScale = Math.min(
    Math.sqrt(Math.max(maxBytes, 1) / imageBuffer.length),
    budgetDimension / Math.max(metadata.width ?? budgetDimension, metadata.height ?? budgetDimension),
  );
  const preferredStart = Math.min(1, Math.max(0.1, estimatedScale * 1.1));
  const scalingFactors = Array.from(new Set([
    preferredStart,
    Math.max(0.1, preferredStart * 0.75),
    Math.max(0.1, preferredStart * 0.5),
  ])).sort((a, b) => b - a);
  const w = metadata.width ?? IMAGE_MAX_DIMENSION;
  const h = metadata.height ?? IMAGE_MAX_DIMENSION;

  for (const factor of scalingFactors) {
    const newW = Math.round(w * factor);
    const newH = Math.round(h * factor);
    const resized = sharp(imageBuffer).resize(newW, newH, { fit: 'inside', withoutEnlargement: true });

    if (format === 'png') {
      resized.png({ compressionLevel: 9, palette: true });
    } else if (format === 'jpeg' || format === 'jpg') {
      resized.jpeg({ quality: 80 });
    } else if (format === 'webp') {
      resized.webp({ quality: 80 });
    }

    const buf = await resized.toBuffer();
    if (buf.length <= maxBytes) {
      return {
        base64: buf.toString('base64'),
        mediaType: `image/${format === 'jpg' ? 'jpeg' : format}` as ImageMimeType,
        originalSize: imageBuffer.length,
      };
    }
  }

  // Stage 2: Palette PNG
  const palettePng = await sharp(imageBuffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true, colors: 64 })
    .toBuffer();
  if (palettePng.length <= maxBytes) {
    return {
      base64: palettePng.toString('base64'),
      mediaType: 'image/png',
      originalSize: imageBuffer.length,
    };
  }

  // Stage 3: JPEG conversion
  const jpeg = await sharp(imageBuffer)
    .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 50 })
    .toBuffer();
  if (jpeg.length <= maxBytes) {
    return {
      base64: jpeg.toString('base64'),
      mediaType: 'image/jpeg',
      originalSize: imageBuffer.length,
    };
  }

  // Stage 4: Ultra-compressed JPEG
  const ultra = await sharp(imageBuffer)
    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 20 })
    .toBuffer();
  return {
    base64: ultra.toString('base64'),
    mediaType: 'image/jpeg',
    originalSize: imageBuffer.length,
  };
}

/**
 * Compress an image buffer to fit within a token limit.
 * Converts tokens to bytes: maxBytes = (maxTokens / 0.125) * 0.75
 */
export async function compressImageBufferWithTargetLimit(
  imageBuffer: Buffer,
  maxTokens: number,
  originalMediaType?: string,
): Promise<CompressedImageResult> {
  const maxBase64Chars = Math.floor(maxTokens / 0.125);
  const maxBytes = Math.floor(maxBase64Chars * 0.75);
  return compressImageBuffer(imageBuffer, maxBytes, originalMediaType);
}
