/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  deriveKey,
  isEncrypted,
  encryptConfig,
  decryptConfig,
  computeHash,
  generateRandomKey,
} from '../../src/sync/encryption.js';

describe('Encryption Utilities', () => {
  const testToken = 'test-auth-token-1234567890';
  const differentToken = 'different-auth-token-9876543210';

  describe('deriveKey', () => {
    it('derives a consistent key from the same token', () => {
      const key1 = deriveKey(testToken);
      const key2 = deriveKey(testToken);
      expect(key1.equals(key2)).toBe(true);
    });

    it('derives different keys from different tokens', () => {
      const key1 = deriveKey(testToken);
      const key2 = deriveKey(differentToken);
      expect(key1.equals(key2)).toBe(false);
    });

    it('derives a 256-bit (32 byte) key', () => {
      const key = deriveKey(testToken);
      expect(key.length).toBe(32);
    });

    it('throws for invalid tokens', () => {
      expect(() => deriveKey('')).toThrow('Invalid auth token');
      expect(() => deriveKey('short')).toThrow('Invalid auth token');
    });
  });

  describe('encrypt/decrypt', () => {
    it('encrypts and decrypts a string correctly', () => {
      const plaintext = 'sk-or-v1-1234567890abcdef';
      const encrypted = encrypt(plaintext, testToken);
      const decrypted = decrypt(encrypted, testToken);
      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertext each time (random IV)', () => {
      const plaintext = 'my-api-key';
      const encrypted1 = encrypt(plaintext, testToken);
      const encrypted2 = encrypt(plaintext, testToken);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('returns empty string for empty input', () => {
      expect(encrypt('', testToken)).toBe('');
    });

    it('fails decryption with wrong token', () => {
      const plaintext = 'secret-api-key';
      const encrypted = encrypt(plaintext, testToken);
      expect(() => decrypt(encrypted, differentToken)).toThrow();
    });

    it('handles special characters', () => {
      const plaintext = 'key-with-special-chars!@#$%^&*()_+-=[]{}|;:,.<>?';
      const encrypted = encrypt(plaintext, testToken);
      const decrypted = decrypt(encrypted, testToken);
      expect(decrypted).toBe(plaintext);
    });

    it('handles unicode characters', () => {
      const plaintext = 'key-with-unicode-\u4e2d\u6587-\u65e5\u672c\u8a9e';
      const encrypted = encrypt(plaintext, testToken);
      const decrypted = decrypt(encrypted, testToken);
      expect(decrypted).toBe(plaintext);
    });

    it('handles long strings', () => {
      const plaintext = 'a'.repeat(10000);
      const encrypted = encrypt(plaintext, testToken);
      const decrypted = decrypt(encrypted, testToken);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('isEncrypted', () => {
    it('returns true for encrypted values', () => {
      const encrypted = encrypt('test', testToken);
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('returns false for plain values', () => {
      expect(isEncrypted('sk-or-v1-1234567890')).toBe(false);
      expect(isEncrypted('just-a-string')).toBe(false);
      expect(isEncrypted('')).toBe(false);
    });

    it('returns false for invalid formats', () => {
      expect(isEncrypted('only:two:parts:extra')).toBe(false);
      expect(isEncrypted('invalid')).toBe(false);
      expect(isEncrypted(null as unknown as string)).toBe(false);
      expect(isEncrypted(undefined as unknown as string)).toBe(false);
    });
  });

  describe('encryptConfig', () => {
    it('encrypts apiKey fields', () => {
      const config = {
        provider: 'openrouter',
        openrouter: {
          apiKey: 'sk-or-v1-secret',
          baseUrl: 'https://openrouter.ai/api/v1',
        },
      };

      const encrypted = encryptConfig(config, testToken);

      expect(encrypted.provider).toBe('openrouter');
      expect((encrypted.openrouter as Record<string, unknown>).baseUrl).toBe('https://openrouter.ai/api/v1');
      expect(isEncrypted((encrypted.openrouter as Record<string, unknown>).apiKey as string)).toBe(true);
    });

    it('encrypts nested API keys', () => {
      const config = {
        providers: {
          openrouter: { apiKey: 'sk-openrouter' },
          anthropic: { apiKey: 'sk-anthropic' },
          openai: { apiKey: 'sk-openai' },
        },
      };

      const encrypted = encryptConfig(config, testToken);
      const providers = encrypted.providers as Record<string, Record<string, string>>;

      expect(isEncrypted(providers.openrouter.apiKey)).toBe(true);
      expect(isEncrypted(providers.anthropic.apiKey)).toBe(true);
      expect(isEncrypted(providers.openai.apiKey)).toBe(true);
    });

    it('does not re-encrypt already encrypted values', () => {
      const config = {
        openrouter: {
          apiKey: 'sk-or-v1-secret',
        },
      };

      const encrypted1 = encryptConfig(config, testToken);
      const encrypted2 = encryptConfig(encrypted1, testToken);

      // Should be same encrypted value (not double-encrypted)
      expect((encrypted1.openrouter as Record<string, string>).apiKey).toBe(
        (encrypted2.openrouter as Record<string, string>).apiKey
      );
    });

    it('handles null and undefined values', () => {
      const config = {
        apiKey: null,
        secretKey: undefined,
        nested: { apiKey: null },
      };

      const encrypted = encryptConfig(config as unknown as Record<string, unknown>, testToken);

      expect(encrypted.apiKey).toBeNull();
      expect(encrypted.secretKey).toBeUndefined();
      expect((encrypted.nested as Record<string, unknown>).apiKey).toBeNull();
    });

    it('encrypts fields ending with Key, Token, Secret', () => {
      const config = {
        accessToken: 'my-access-token',
        clientSecret: 'my-client-secret',
        encryptionKey: 'my-encryption-key',
        password: 'my-password',
        normalField: 'not-encrypted',
      };

      const encrypted = encryptConfig(config, testToken);

      expect(isEncrypted(encrypted.accessToken as string)).toBe(true);
      expect(isEncrypted(encrypted.clientSecret as string)).toBe(true);
      expect(isEncrypted(encrypted.encryptionKey as string)).toBe(true);
      expect(isEncrypted(encrypted.password as string)).toBe(true);
      expect(isEncrypted(encrypted.normalField as string)).toBe(false);
    });
  });

  describe('decryptConfig', () => {
    it('decrypts encrypted apiKey fields', () => {
      const originalConfig = {
        provider: 'openrouter',
        openrouter: {
          apiKey: 'sk-or-v1-secret',
          baseUrl: 'https://openrouter.ai/api/v1',
        },
      };

      const encrypted = encryptConfig(originalConfig, testToken);
      const decrypted = decryptConfig(encrypted, testToken);

      expect(decrypted).toEqual(originalConfig);
    });

    it('handles decryption failure gracefully', () => {
      const config = {
        openrouter: {
          apiKey: encrypt('sk-or-v1-secret', testToken),
        },
      };

      // Try to decrypt with wrong token - should keep encrypted value
      const decrypted = decryptConfig(config, differentToken);

      // Should keep the encrypted value (not throw)
      expect(isEncrypted((decrypted.openrouter as Record<string, string>).apiKey)).toBe(true);
    });

    it('roundtrips complex config', () => {
      const originalConfig = {
        provider: 'openrouter',
        model: 'anthropic/claude-3.5-sonnet',
        openrouter: {
          apiKey: 'sk-or-v1-1234567890',
          baseUrl: 'https://openrouter.ai/api/v1',
        },
        anthropic: {
          apiKey: 'sk-ant-api03-secret',
        },
        workspace: {
          defaultRoot: '/home/user/projects',
        },
        ui: {
          theme: 'dark',
        },
        sync: {
          enabled: true,
          interval: 300000,
        },
      };

      const encrypted = encryptConfig(originalConfig, testToken);
      const decrypted = decryptConfig(encrypted, testToken);

      expect(decrypted).toEqual(originalConfig);
    });
  });

  describe('computeHash', () => {
    it('computes consistent SHA-256 hash for strings', () => {
      const data = 'test data';
      const hash1 = computeHash(data);
      const hash2 = computeHash(data);
      expect(hash1).toBe(hash2);
    });

    it('computes different hashes for different data', () => {
      const hash1 = computeHash('data1');
      const hash2 = computeHash('data2');
      expect(hash1).not.toBe(hash2);
    });

    it('returns 64-character hex string (256 bits)', () => {
      const hash = computeHash('test');
      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });

    it('handles Buffer input', () => {
      const data = Buffer.from('test data');
      const hash = computeHash(data);
      expect(hash.length).toBe(64);
    });
  });

  describe('generateRandomKey', () => {
    it('generates a base64-encoded random key', () => {
      const key = generateRandomKey();
      expect(typeof key).toBe('string');
      // Base64 encoding of 32 bytes = 44 characters (with padding)
      expect(key.length).toBe(44);
    });

    it('generates unique keys', () => {
      const key1 = generateRandomKey();
      const key2 = generateRandomKey();
      expect(key1).not.toBe(key2);
    });
  });
});
