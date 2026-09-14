/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { canSteerComposerInput } from '../../src/ui/composerSteering.js';

describe('canSteerComposerInput', () => {
  it.each(['/ps', '/stop', '/deep-search status', '!ls', ':reviewer ship it', ':colon-worker'])(
    'runs %s immediately instead of steering the turn', (text) => {
      expect(canSteerComposerInput(text)).toBe(false);
    },
  );

  it.each(['focus on tests', 'meet at 12:', ':smile: looks good', '/var/folders/x/Screenshot.png', ' '])(
    'lets %j reach the running turn', (text) => {
      expect(canSteerComposerInput(text)).toBe(true);
    },
  );
});
