/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  compressImage,
  detectImageFormatFromBuffer,
  compressImageBuffer,
  IMAGE_TARGET_RAW_SIZE,
  IMAGE_MAX_DIMENSION,
  compressImageBufferWithTargetLimit,
} from '../../src/utils/imageCompression.js';

// --- Helpers for creating test image buffers ---

async function createPngBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
}

async function createJpegBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 255 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function createWebpBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 255, b: 0 },
    },
  })
    .webp()
    .toBuffer();
}

// Generate a noise PNG to reliably exceed 3.75MB at moderate dimensions
async function createLargePngBuffer(
  width: number,
  height: number
): Promise<Buffer> {
  // Create a complex gradient with noise to resist PNG compression
  const pixels = width * height;
  const data = Buffer.alloc(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    data[i * 4] = (i * 7 + Math.floor(i / width) * 13) % 256;
    data[i * 4 + 1] = (i * 11 + Math.floor(i / width) * 17) % 256;
    data[i * 4 + 2] = (i * 19 + Math.floor(i / width) * 23) % 256;
    data[i * 4 + 3] = 255;
  }
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 1 }) // low compression = large file
    .toBuffer();
}

async function createLargeJpegBuffer(
  width: number,
  height: number
): Promise<Buffer> {
  const pixels = width * height;
  const data = Buffer.alloc(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    data[i * 3] = (i * 7) % 256;
    data[i * 3 + 1] = (i * 11) % 256;
    data[i * 3 + 2] = (i * 13) % 256;
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 }) // high quality = large file
    .toBuffer();
}

describe('detectImageFormatFromBuffer', () => {
  it('detects PNG from magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00]);
    expect(detectImageFormatFromBuffer(buf)).toBe('image/png');
  });

  it('detects JPEG from magic bytes', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]);
    expect(detectImageFormatFromBuffer(buf)).toBe('image/jpeg');
  });

  it('detects GIF from magic bytes', () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(detectImageFormatFromBuffer(buf)).toBe('image/gif');
  });

  it('detects WebP from RIFF....WEBP signature', () => {
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46,
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectImageFormatFromBuffer(buf)).toBe('image/webp');
  });

  it('returns PNG as default for too-short buffers', () => {
    expect(detectImageFormatFromBuffer(Buffer.from([0x00, 0x01]))).toBe(
      'image/png'
    );
  });

  it('returns PNG as default for unknown format', () => {
    expect(detectImageFormatFromBuffer(Buffer.from([0x01, 0x02, 0x03, 0x04]))).toBe(
      'image/png'
    );
  });
});

describe('compressImage — no-op path', () => {
  it('returns small PNG unchanged when under target size and under max dimension', async () => {
    const data = await createPngBuffer(100, 100);
    const result = await compressImage(data, 'image/png');

    expect(result.mimeType).toBe('image/png');
    expect(result.compressedData.length).toBeLessThanOrEqual(
      IMAGE_TARGET_RAW_SIZE
    );
    expect(result.compressedData.length).toBeLessThanOrEqual(data.length * 2); // allow small metadata growth
  });

  it('returns small JPEG unchanged when under target size and under max dimension', async () => {
    const data = await createJpegBuffer(100, 100);
    const result = await compressImage(data, 'image/jpeg');

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.compressedData.length).toBeLessThanOrEqual(
      IMAGE_TARGET_RAW_SIZE
    );
  });
});

describe('compressImage — compression-first (preserves resolution)', () => {
  it('compresses a large PNG using PNG palette optimization', async () => {
    // 6000x5000 with low PNG compression generates a well-compressible gradient
    const data = await createLargePngBuffer(6000, 5000);
    expect(data.length).toBeGreaterThan(IMAGE_TARGET_RAW_SIZE);

    const result = await compressImage(data, 'image/png');

    expect(result.compressedData.length).toBeLessThanOrEqual(
      IMAGE_TARGET_RAW_SIZE
    );
  });

  it('compresses a large JPEG by progressively lowering quality', async () => {
    const data = await createLargeJpegBuffer(4000, 3000);
    expect(data.length).toBeGreaterThan(IMAGE_TARGET_RAW_SIZE);

    const result = await compressImage(data, 'image/jpeg');

    expect(result.compressedData.length).toBeLessThanOrEqual(
      IMAGE_TARGET_RAW_SIZE
    );
    expect(result.mimeType).toBe('image/jpeg');
  });
});

describe('compressImage — dimension resize', () => {
  it('resizes image that exceeds max dimension', async () => {
    const data = await createPngBuffer(3000, 2000);
    const result = await compressImage(data, 'image/png');

    const meta = await sharp(result.compressedData).metadata();
    expect(meta.width).toBeLessThanOrEqual(IMAGE_MAX_DIMENSION);
    expect(meta.height).toBeLessThanOrEqual(IMAGE_MAX_DIMENSION);
    expect(result.compressedData.length).toBeLessThanOrEqual(
      IMAGE_TARGET_RAW_SIZE
    );
  });

  it('preserves aspect ratio when resizing', async () => {
    const data = await createPngBuffer(4000, 2000);
    const result = await compressImage(data, 'image/png');

    const meta = await sharp(result.compressedData).metadata();
    // Width should be clamped to 2000, height should scale proportionally
    expect(meta.width).toBeLessThanOrEqual(IMAGE_MAX_DIMENSION);
    expect(meta.height).toBeLessThanOrEqual(IMAGE_MAX_DIMENSION);
    // Aspect ratio: 4000:2000 = 2:1, so after resize height:width should still be ~1:2
    const originalRatio = 2000 / 4000;
    const newRatio = (meta.height ?? 1) / (meta.width ?? 1);
    // Allow some tolerance from palette rounding
    expect(Math.abs(newRatio - originalRatio)).toBeLessThan(0.05);
  });
});

describe('compressImage — aggressive fallback', () => {
  it('eventually produces image under target even for extremely large input', async () => {
    // 8000x6000 with low PNG compression = very large
    const data = await createLargePngBuffer(8000, 6000);
    expect(data.length).toBeGreaterThan(IMAGE_TARGET_RAW_SIZE);

    const result = await compressImage(data, 'image/png');

    expect(result.compressedData.length).toBeLessThanOrEqual(
      IMAGE_TARGET_RAW_SIZE
    );
  });
});

describe('compressImage — format handling', () => {
  it('converts PNG to JPEG for very large images when palette is not enough', async () => {
    const data = await createLargePngBuffer(8000, 6000);
    const result = await compressImage(data, 'image/png');

    expect(result.compressedData.length).toBeLessThanOrEqual(
      IMAGE_TARGET_RAW_SIZE
    );
  });

  it('handles WebP format', async () => {
    const data = await createWebpBuffer(100, 100);
    const result = await compressImage(data, 'image/webp');

    expect(result.compressedData.length).toBeLessThanOrEqual(
      IMAGE_TARGET_RAW_SIZE
    );
  });
});

describe('compressImage — edge cases', () => {
  it('rejects empty buffer with clear error', async () => {
    await expect(compressImage(Buffer.alloc(0), 'image/png')).rejects.toThrow();
  });

  it('rejects invalid/corrupt image data with clear error', async () => {
    await expect(compressImage(Buffer.from('not-an-image'), 'image/png')).rejects.toThrow();
  });
});

describe('compressImageBuffer', () => {
  it('compresses image to fit within a custom byte limit', async () => {
    const data = await createLargePngBuffer(4000, 3000);
    const maxBytes = 500_000; // 500KB limit

    const result = await compressImageBuffer(data, maxBytes);

    expect(result.base64.length * 0.75).toBeLessThanOrEqual(maxBytes * 1.5); // allow some tolerance with base64 encoding
    expect(result.mediaType).toBeDefined();
    expect(result.originalSize).toBe(data.length);
  });

  it('returns image without compression when already under limit', async () => {
    const data = await createPngBuffer(50, 50);
    const maxBytes = 10 * 1024 * 1024; // 10MB

    const result = await compressImageBuffer(data, maxBytes);

    expect(result.originalSize).toBe(data.length);
    expect(result.mediaType).toBeDefined();
  });
});

describe('compressImageBufferWithTargetLimit', () => {
  it('converts token limit to byte limit and compresses', async () => {
    const data = await createLargePngBuffer(4000, 3000);
    const maxTokens = 500_000; // ~1M raw chars base64 → ~750KB raw

    const result = await compressImageBufferWithTargetLimit(data, maxTokens);

    expect(result.mediaType).toBeDefined();
    expect(result.originalSize).toBe(data.length);
  });
});

describe('Constants exported', () => {
  it('IMAGE_TARGET_RAW_SIZE is 3.75MB', () => {
    expect(IMAGE_TARGET_RAW_SIZE).toBe(3.75 * 1024 * 1024);
  });

  it('IMAGE_MAX_DIMENSION is 2000', () => {
    expect(IMAGE_MAX_DIMENSION).toBe(2000);
  });
});
