/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { redactBrowserToolArguments } from '../../src/browser/browserRedaction.js';

describe('browser transcript redaction', () => {
  it('hides typed values behind opaque refs and preserves safe structure', () => {
    expect(
      redactBrowserToolArguments('browser_fill_form', {
        target: { kind: 'ref', ref: 'br_form' },
        assignments: [
          {
            kind: 'text',
            target: { kind: 'ref', ref: 'br_password' },
            text: 'local-secret',
          },
          {
            kind: 'checked',
            target: { kind: 'ref', ref: 'br_terms' },
            checked: true,
          },
          {
            kind: 'files',
            target: { kind: 'ref', ref: 'br_upload' },
            paths: ['/private/person/report.pdf'],
          },
        ],
      }),
    ).toEqual({
      target: { kind: 'ref', ref: 'br_form' },
      assignments: [
        {
          kind: 'text',
          target: { kind: 'ref', ref: 'br_password' },
          text: '[REDACTED]',
        },
        {
          kind: 'checked',
          target: { kind: 'ref', ref: 'br_terms' },
          checked: true,
        },
        {
          kind: 'files',
          target: { kind: 'ref', ref: 'br_upload' },
          paths: ['report.pdf'],
        },
      ],
    });
  });

  it('redacts wait values and sensitive URL query parameters', () => {
    expect(
      redactBrowserToolArguments('browser_wait_for', {
        condition: {
          kind: 'value',
          target: { kind: 'ref', ref: 'br_otp' },
          value: '123456',
        },
        callbackUrl: 'https://example.test/callback?token=secret&view=safe',
      }),
    ).toEqual({
      condition: {
        kind: 'value',
        target: { kind: 'ref', ref: 'br_otp' },
        value: '[REDACTED]',
      },
      callbackUrl:
        'https://example.test/callback?token=%5BREDACTED%5D&view=safe',
    });
    expect(
      redactBrowserToolArguments('browser_navigate', {
        url: 'https://example.test/callback?token=secret&view=safe',
      }),
    ).toEqual({
      url: 'https://example.test/callback?token=%5BREDACTED%5D&view=safe',
    });
  });
});
