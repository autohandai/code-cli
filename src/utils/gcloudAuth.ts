/**
 * Google Cloud CLI authentication utilities
 * @license Apache-2.0
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/** Token cache with expiry tracking */
interface TokenCache {
  token: string;
  expiresAt: number; // Unix timestamp in ms
}

/** In-memory token cache (tokens expire in ~28 min, we refresh at 25 min) */
let tokenCache: TokenCache | null = null;

/**
 * Check if gcloud CLI is installed and available
 */
export async function isGcloudInstalled(): Promise<boolean> {
  try {
    await execAsync('gcloud --version', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current gcloud project ID (if configured)
 */
export async function getGcloudProject(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('gcloud config get-value project', { timeout: 5000 });
    const project = stdout.trim();
    return project && project !== '(unset)' ? project : null;
  } catch {
    return null;
  }
}

/**
 * Get a fresh access token using gcloud CLI
 * Uses caching to avoid repeated calls
 */
export async function getGcloudAccessToken(): Promise<{ token: string; error?: string }> {
  // Check cache first
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return { token: tokenCache.token };
  }

  try {
    const { stdout } = await execAsync('gcloud auth print-access-token', { timeout: 10000 });
    const token = stdout.trim();

    if (!token || token.length < 10) {
      return { token: '', error: 'Failed to get access token. You may need to run: gcloud auth login' };
    }

    // Cache the token (Google tokens expire in ~28 min, we use 25 min to be safe)
    tokenCache = {
      token,
      expiresAt: Date.now() + (25 * 60 * 1000) // 25 minutes
    };

    return { token };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('not found') || errorMessage.includes('command not found')) {
      return {
        token: '',
        error: 'gcloud CLI not found. Install it from: https://cloud.google.com/sdk/docs/install'
      };
    }

    if (errorMessage.includes('Could not determine account')) {
      return {
        token: '',
        error: 'Not logged in. Run: gcloud auth login'
      };
    }

    return {
      token: '',
      error: `Failed to get access token: ${errorMessage}`
    };
  }
}

/**
 * Clear the token cache (useful when auth fails)
 */
export function clearGcloudTokenCache(): void {
  tokenCache = null;
}

/**
 * Get the current gcloud account email
 */
export async function getGcloudAccount(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('gcloud auth list --format=value(account)', { timeout: 5000 });
    const account = stdout.trim().split('\n')[0];
    return account || null;
  } catch {
    return null;
  }
}