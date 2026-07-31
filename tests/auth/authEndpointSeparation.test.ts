import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_CONFIG, SYNC_CONFIG } from '../../src/constants.js';

const originalApiURL = process.env.AUTOHAND_API_URL;
const originalAuthURL = process.env.AUTOHAND_AUTH_URL;
const originalAuthApiURL = process.env.AUTOHAND_AUTH_API_URL;

afterEach(() => {
  if (originalApiURL === undefined) delete process.env.AUTOHAND_API_URL;
  else process.env.AUTOHAND_API_URL = originalApiURL;

  if (originalAuthURL === undefined) delete process.env.AUTOHAND_AUTH_URL;
  else process.env.AUTOHAND_AUTH_URL = originalAuthURL;

  if (originalAuthApiURL === undefined) delete process.env.AUTOHAND_AUTH_API_URL;
  else process.env.AUTOHAND_AUTH_API_URL = originalAuthApiURL;
});

describe('Autohand auth endpoint separation', () => {
  it('keeps login on the registered web origin when the API uses a preview', () => {
    process.env.AUTOHAND_API_URL = 'https://mobile-preview.example.com';
    delete process.env.AUTOHAND_AUTH_URL;

    delete process.env.AUTOHAND_AUTH_API_URL;
    expect(AUTH_CONFIG.apiBaseUrl).toBe('https://api.autohand.ai/v1/auth');
    expect(AUTH_CONFIG.authorizationUrl).toBe('https://autohand.ai/signin');
    expect(SYNC_CONFIG.apiBaseUrl).toBe('https://autohand.ai/api');
  });

  it('supports an explicit auth origin independently of the API origin', () => {
    process.env.AUTOHAND_API_URL = 'https://mobile-preview.example.com';
    process.env.AUTOHAND_AUTH_URL = ' https://auth-preview.example.com/ ';

    process.env.AUTOHAND_AUTH_API_URL = ' https://api-auth-preview.example.com/v1/auth/ ';
    expect(AUTH_CONFIG.apiBaseUrl).toBe('https://api-auth-preview.example.com/v1/auth');
    expect(AUTH_CONFIG.authorizationUrl).toBe('https://auth-preview.example.com/signin');
    expect(SYNC_CONFIG.apiBaseUrl).toBe('https://auth-preview.example.com/api');
  });
});
