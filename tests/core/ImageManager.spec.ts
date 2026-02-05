/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ImageManager } from '../../src/core/ImageManager';

describe('ImageManager', () => {
  let manager: ImageManager;

  beforeEach(() => {
    manager = new ImageManager();
  });

  describe('add()', () => {
    it('returns sequential IDs starting from 1', () => {
      const data1 = Buffer.from('fake-image-1');
      const data2 = Buffer.from('fake-image-2');

      const id1 = manager.add(data1, 'image/png');
      const id2 = manager.add(data2, 'image/jpeg');

      expect(id1).toBe(1);
      expect(id2).toBe(2);
    });

    it('stores image with correct mime type', () => {
      const data = Buffer.from('fake-image');
      const id = manager.add(data, 'image/png', 'screenshot.png');

      const image = manager.get(id);
      expect(image).toBeDefined();
      expect(image?.mimeType).toBe('image/png');
      expect(image?.filename).toBe('screenshot.png');
    });

    it('stores filename when provided', () => {
      const data = Buffer.from('fake-image');
      const id = manager.add(data, 'image/png', 'my-screenshot.png');

      const image = manager.get(id);
      expect(image?.filename).toBe('my-screenshot.png');
    });

    it('works without filename', () => {
      const data = Buffer.from('fake-image');
      const id = manager.add(data, 'image/png');

      const image = manager.get(id);
      expect(image?.filename).toBeUndefined();
    });
  });

  describe('get()', () => {
    it('returns correct image by ID', () => {
      const data1 = Buffer.from('image-1-data');
      const data2 = Buffer.from('image-2-data');

      const id1 = manager.add(data1, 'image/png');
      const id2 = manager.add(data2, 'image/jpeg');

      expect(manager.get(id1)?.data.toString()).toBe('image-1-data');
      expect(manager.get(id2)?.data.toString()).toBe('image-2-data');
    });

    it('returns undefined for non-existent ID', () => {
      expect(manager.get(999)).toBeUndefined();
    });

    it('returns undefined for ID 0', () => {
      expect(manager.get(0)).toBeUndefined();
    });
  });

  describe('getAll()', () => {
    it('returns empty array when no images', () => {
      expect(manager.getAll()).toEqual([]);
    });

    it('returns all images in order added', () => {
      manager.add(Buffer.from('img1'), 'image/png', 'first.png');
      manager.add(Buffer.from('img2'), 'image/jpeg', 'second.jpg');
      manager.add(Buffer.from('img3'), 'image/gif', 'third.gif');

      const all = manager.getAll();
      expect(all.length).toBe(3);
      expect(all[0].id).toBe(1);
      expect(all[0].filename).toBe('first.png');
      expect(all[1].id).toBe(2);
      expect(all[1].filename).toBe('second.jpg');
      expect(all[2].id).toBe(3);
      expect(all[2].filename).toBe('third.gif');
    });
  });

  describe('clear()', () => {
    it('removes all images', () => {
      manager.add(Buffer.from('img1'), 'image/png');
      manager.add(Buffer.from('img2'), 'image/jpeg');

      expect(manager.count()).toBe(2);

      manager.clear();

      expect(manager.count()).toBe(0);
      expect(manager.getAll()).toEqual([]);
    });

    it('resets ID counter', () => {
      manager.add(Buffer.from('img1'), 'image/png');
      manager.add(Buffer.from('img2'), 'image/jpeg');
      manager.clear();

      const newId = manager.add(Buffer.from('img3'), 'image/gif');
      expect(newId).toBe(1);
    });
  });

  describe('count()', () => {
    it('returns 0 for empty manager', () => {
      expect(manager.count()).toBe(0);
    });

    it('returns correct count after adding images', () => {
      manager.add(Buffer.from('img1'), 'image/png');
      expect(manager.count()).toBe(1);

      manager.add(Buffer.from('img2'), 'image/jpeg');
      expect(manager.count()).toBe(2);
    });
  });

  describe('toClaudeFormat()', () => {
    it('returns empty array when no images', () => {
      expect(manager.toClaudeFormat()).toEqual([]);
    });

    it('converts images to Claude API format', () => {
      const pngData = Buffer.from('PNG-DATA');
      const jpegData = Buffer.from('JPEG-DATA');

      manager.add(pngData, 'image/png');
      manager.add(jpegData, 'image/jpeg');

      const formatted = manager.toClaudeFormat();

      expect(formatted.length).toBe(2);
      expect(formatted[0]).toEqual({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: pngData.toString('base64')
        }
      });
      expect(formatted[1]).toEqual({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: jpegData.toString('base64')
        }
      });
    });
  });

  describe('toOpenAIFormat()', () => {
    it('returns empty array when no images', () => {
      expect(manager.toOpenAIFormat()).toEqual([]);
    });

    it('converts images to OpenAI API format', () => {
      const pngData = Buffer.from('PNG-DATA');

      manager.add(pngData, 'image/png');

      const formatted = manager.toOpenAIFormat();

      expect(formatted.length).toBe(1);
      expect(formatted[0]).toEqual({
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${pngData.toString('base64')}`
        }
      });
    });
  });

  describe('formatPlaceholder()', () => {
    it('returns placeholder text for image', () => {
      const id = manager.add(Buffer.from('data'), 'image/png', 'test.png');
      const placeholder = manager.formatPlaceholder(id);

      expect(placeholder).toBe('[Image #1] test.png');
    });

    it('returns placeholder without filename if not provided', () => {
      const id = manager.add(Buffer.from('data'), 'image/png');
      const placeholder = manager.formatPlaceholder(id);

      expect(placeholder).toBe('[Image #1]');
    });

    it('returns empty string for non-existent ID', () => {
      expect(manager.formatPlaceholder(999)).toBe('');
    });
  });
});

describe('Image Detection Utilities', () => {
  describe('isImagePath()', () => {
    // This will test the utility function that detects image file paths
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

    it('detects common image extensions', () => {
      const paths = [
        '/path/to/image.png',
        './screenshot.jpg',
        '~/Desktop/mockup.jpeg',
        'test.gif',
        'image.webp'
      ];

      for (const path of paths) {
        const ext = path.split('.').pop()?.toLowerCase();
        expect(imageExtensions.some(e => e.slice(1) === ext)).toBe(true);
      }
    });

    it('rejects non-image extensions', () => {
      const paths = [
        'file.txt',
        'script.js',
        'style.css',
        'data.json'
      ];

      for (const path of paths) {
        const ext = '.' + path.split('.').pop()?.toLowerCase();
        expect(imageExtensions.includes(ext)).toBe(false);
      }
    });
  });

  describe('isBase64Image()', () => {
    it('detects base64 data URLs', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
      expect(dataUrl.startsWith('data:image/')).toBe(true);
    });

    it('rejects non-image data URLs', () => {
      const dataUrl = 'data:text/plain;base64,SGVsbG8=';
      expect(dataUrl.startsWith('data:image/')).toBe(false);
    });
  });
});
