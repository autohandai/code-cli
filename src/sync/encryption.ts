/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Encryption utilities for settings sync
 * Uses AES-256-GCM for authenticated encryption of sensitive data
 */
import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT = 'autohand-sync-v1'; // Static salt for key derivation
const ITERATIONS = 100000; // PBKDF2 iterations

/**
 * Encrypted value format: iv:authTag:ciphertext (all base64)
 */
export interface EncryptedValue {
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * Derive a 256-bit encryption key from the auth token
 * Uses PBKDF2 for secure key derivation
 */
export function deriveKey(authToken: string): Buffer {
  if (!authToken || authToken.length < 10) {
    throw new Error('Invalid auth token for key derivation');
  }
  return crypto.pbkdf2Sync(authToken, SALT, ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt a string value using AES-256-GCM
 * Returns a string in format: iv:authTag:ciphertext
 */
export function encrypt(plaintext: string, authToken: string): string {
  if (!plaintext) {
    return plaintext;
  }

  const key = deriveKey(authToken);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
  ciphertext += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext}`;
}

/**
 * Decrypt a string value encrypted with encrypt()
 * Expects format: iv:authTag:ciphertext
 */
export function decrypt(encrypted: string, authToken: string): string {
  if (!encrypted || !encrypted.includes(':')) {
    throw new Error('Invalid encrypted format');
  }

  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format: expected iv:authTag:ciphertext');
  }

  const [ivB64, authTagB64, ciphertext] = parts;

  const key = deriveKey(authToken);
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid IV length');
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

/**
 * Check if a string looks like an encrypted value
 */
export function isEncrypted(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }
  const parts = value.split(':');
  if (parts.length !== 3) {
    return false;
  }
  // Check if all parts are valid base64
  try {
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    return iv.length === IV_LENGTH && authTag.length === AUTH_TAG_LENGTH;
  } catch {
    return false;
  }
}

/**
 * Encrypt sensitive fields in a config object
 * Recursively finds and encrypts any field named 'apiKey' or ending with 'Key'
 */
export function encryptConfig(config: Record<string, unknown>, authToken: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (value === null || value === undefined) {
      result[key] = value;
      continue;
    }

    // Recursively process nested objects
    if (typeof value === 'object' && !Array.isArray(value)) {
      result[key] = encryptConfig(value as Record<string, unknown>, authToken);
      continue;
    }

    // Encrypt API keys
    if (typeof value === 'string' && isSensitiveKey(key) && value.length > 0 && !isEncrypted(value)) {
      result[key] = encrypt(value, authToken);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Decrypt sensitive fields in a config object
 * Recursively finds and decrypts any encrypted field named 'apiKey' or ending with 'Key'
 */
export function decryptConfig(config: Record<string, unknown>, authToken: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (value === null || value === undefined) {
      result[key] = value;
      continue;
    }

    // Recursively process nested objects
    if (typeof value === 'object' && !Array.isArray(value)) {
      result[key] = decryptConfig(value as Record<string, unknown>, authToken);
      continue;
    }

    // Decrypt API keys
    if (typeof value === 'string' && isSensitiveKey(key) && isEncrypted(value)) {
      try {
        result[key] = decrypt(value, authToken);
      } catch {
        // If decryption fails, keep the encrypted value
        // This can happen if the auth token changed
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Check if a key name indicates a sensitive value that should be encrypted
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return (
    lowerKey === 'apikey' ||
    lowerKey.endsWith('key') ||
    lowerKey.endsWith('token') ||
    lowerKey.endsWith('secret') ||
    lowerKey === 'password'
  );
}

/**
 * Compute SHA-256 hash of a string or buffer
 */
export function computeHash(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a random encryption key (for testing)
 */
export function generateRandomKey(): string {
  return crypto.randomBytes(32).toString('base64');
}
