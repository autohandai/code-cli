/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SETTINGS_REGISTRY,
  SETTING_CATEGORIES,
  getNestedValue,
  setNestedValue,
  getSettingsForCategory,
  formatSettingValue,
  type SettingCategory,
} from '../../src/commands/settings.js';

describe('getNestedValue', () => {
  it('reads a top-level key', () => {
    expect(getNestedValue({ foo: 'bar' }, 'foo')).toBe('bar');
  });

  it('reads a nested key', () => {
    expect(getNestedValue({ ui: { theme: 'dark' } }, 'ui.theme')).toBe('dark');
  });

  it('returns undefined for missing path', () => {
    expect(getNestedValue({}, 'ui.theme')).toBeUndefined();
  });

  it('returns undefined for partially missing path', () => {
    expect(getNestedValue({ ui: {} }, 'ui.theme')).toBeUndefined();
  });

  it('handles deeply nested paths', () => {
    const obj = { a: { b: { c: 42 } } };
    expect(getNestedValue(obj, 'a.b.c')).toBe(42);
  });
});

describe('setNestedValue', () => {
  it('sets a top-level key', () => {
    const obj: any = {};
    setNestedValue(obj, 'foo', 'bar');
    expect(obj.foo).toBe('bar');
  });

  it('sets a nested key', () => {
    const obj: any = { ui: {} };
    setNestedValue(obj, 'ui.theme', 'light');
    expect(obj.ui.theme).toBe('light');
  });

  it('creates intermediate objects if missing', () => {
    const obj: any = {};
    setNestedValue(obj, 'ui.theme', 'dark');
    expect(obj.ui.theme).toBe('dark');
  });

  it('overwrites existing value', () => {
    const obj: any = { ui: { theme: 'dark' } };
    setNestedValue(obj, 'ui.theme', 'light');
    expect(obj.ui.theme).toBe('light');
  });

  it('handles deeply nested paths', () => {
    const obj: any = {};
    setNestedValue(obj, 'a.b.c', 99);
    expect(obj.a.b.c).toBe(99);
  });
});

describe('SETTINGS_REGISTRY', () => {
  it('has entries for all categories', () => {
    const registeredCategories = new Set(SETTINGS_REGISTRY.map(s => s.category));
    for (const cat of SETTING_CATEGORIES) {
      expect(registeredCategories.has(cat.id)).toBe(true);
    }
  });

  it('every entry has required fields', () => {
    for (const setting of SETTINGS_REGISTRY) {
      expect(setting.key).toBeTruthy();
      expect(setting.labelKey).toBeTruthy();
      expect(setting.category).toBeTruthy();
      expect(setting.type).toBeTruthy();
      expect(['boolean', 'string', 'number', 'enum', 'password'].includes(setting.type)).toBe(true);
    }
  });

  it('enum settings have enumValues defined', () => {
    const enums = SETTINGS_REGISTRY.filter(s => s.type === 'enum');
    for (const setting of enums) {
      expect(setting.enumValues).toBeDefined();
      expect(setting.enumValues!.length).toBeGreaterThan(0);
    }
  });

  it('redirect settings have redirect field', () => {
    const redirects = SETTINGS_REGISTRY.filter(s => s.redirect);
    expect(redirects.length).toBeGreaterThan(0);
    for (const setting of redirects) {
      expect(setting.redirect).toMatch(/^\//);
    }
  });

  it('has no duplicate keys', () => {
    const keys = SETTINGS_REGISTRY.map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('getSettingsForCategory', () => {
  it('returns only settings for the given category', () => {
    const uiSettings = getSettingsForCategory('ui');
    expect(uiSettings.length).toBeGreaterThan(0);
    for (const s of uiSettings) {
      expect(s.category).toBe('ui');
    }
  });

  it('returns empty array for unknown category', () => {
    expect(getSettingsForCategory('nonexistent' as SettingCategory)).toEqual([]);
  });
});

describe('formatSettingValue', () => {
  it('formats boolean true', () => {
    const result = formatSettingValue(true, 'boolean');
    expect(result).toContain('on');
  });

  it('formats boolean false', () => {
    const result = formatSettingValue(false, 'boolean');
    expect(result).toContain('off');
  });

  it('formats undefined as default indicator', () => {
    const result = formatSettingValue(undefined, 'boolean');
    expect(result).toBeTruthy();
  });

  it('formats string value', () => {
    const result = formatSettingValue('dark', 'string');
    expect(result).toContain('dark');
  });

  it('formats number value', () => {
    const result = formatSettingValue(100, 'number');
    expect(result).toContain('100');
  });

  it('masks password value', () => {
    const result = formatSettingValue('sk-secret-key', 'password');
    expect(result).not.toContain('sk-secret-key');
    expect(result).toContain('****');
  });

  it('shows not set for empty password', () => {
    const result = formatSettingValue(undefined, 'password');
    expect(result).toBeTruthy();
  });
});

// ── Integration Tests ──────────────────────────────────────────────────

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: vi.fn(),
  showInput: vi.fn(),
  showConfirm: vi.fn(),
  showPassword: vi.fn(),
}));

vi.mock('../../src/config.js', () => ({
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

// Dynamic imports to get mocked versions
const { showModal: mockShowModal, showInput: mockShowInput, showConfirm: mockShowConfirm, showPassword: mockShowPassword } = await import('../../src/ui/ink/components/Modal.js');
const { saveConfig: mockSaveConfig } = await import('../../src/config.js');
const { settings: settingsCmd } = await import('../../src/commands/settings.js');

function createMockConfig(): any {
  return {
    configPath: '/tmp/test/config.json',
    ui: { theme: 'dark', terminalBell: true, autoConfirm: false },
    agent: { maxIterations: 100, debug: false },
    permissions: { mode: 'interactive' },
    network: { maxRetries: 3, timeout: 30000 },
    telemetry: { enabled: false },
    automode: { maxIterations: 50 },
    teams: { enabled: true, maxTeammates: 5 },
    search: { provider: 'google' },
  };
}

describe('settings command integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exits when user presses ESC at category level', async () => {
    (mockShowModal as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const config = createMockConfig();
    await settingsCmd({ config });
    expect(mockShowModal).toHaveBeenCalledOnce();
  });

  it('shows settings for selected category then returns on back', async () => {
    (mockShowModal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ label: 'UI & Display', value: 'ui' })
      .mockResolvedValueOnce({ label: 'Back', value: '__back__' })
      .mockResolvedValueOnce(null);
    const config = createMockConfig();
    await settingsCmd({ config });
    expect(mockShowModal).toHaveBeenCalledTimes(3);
  });

  it('toggles boolean setting and saves', async () => {
    (mockShowModal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ label: 'UI & Display', value: 'ui' })
      .mockResolvedValueOnce({ label: 'Terminal bell: on', value: 'ui.terminalBell' })
      .mockResolvedValueOnce({ label: 'Back', value: '__back__' })
      .mockResolvedValueOnce(null);
    (mockShowConfirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const config = createMockConfig();
    await settingsCmd({ config });
    expect(config.ui.terminalBell).toBe(false);
    expect(mockSaveConfig).toHaveBeenCalled();
  });

  it('edits enum setting and saves', async () => {
    (mockShowModal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ label: 'Permissions', value: 'permissions' })
      .mockResolvedValueOnce({ label: 'Permission mode', value: 'permissions.mode' })
      .mockResolvedValueOnce({ label: 'unrestricted', value: 'unrestricted' })
      .mockResolvedValueOnce({ label: 'Back', value: '__back__' })
      .mockResolvedValueOnce(null);
    const config = createMockConfig();
    await settingsCmd({ config });
    expect(config.permissions.mode).toBe('unrestricted');
    expect(mockSaveConfig).toHaveBeenCalled();
  });

  it('edits number setting and saves', async () => {
    (mockShowModal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ label: 'Network', value: 'network' })
      .mockResolvedValueOnce({ label: 'Timeout (ms)', value: 'network.timeout' })
      .mockResolvedValueOnce({ label: 'Back', value: '__back__' })
      .mockResolvedValueOnce(null);
    (mockShowInput as ReturnType<typeof vi.fn>).mockResolvedValueOnce('60000');
    const config = createMockConfig();
    await settingsCmd({ config });
    expect(config.network.timeout).toBe(60000);
    expect(mockSaveConfig).toHaveBeenCalled();
  });

  it('edits password setting and saves', async () => {
    (mockShowModal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ label: 'Search', value: 'search' })
      .mockResolvedValueOnce({ label: 'Brave API key', value: 'search.braveApiKey' })
      .mockResolvedValueOnce({ label: 'Back', value: '__back__' })
      .mockResolvedValueOnce(null);
    (mockShowPassword as ReturnType<typeof vi.fn>).mockResolvedValueOnce('sk-brave-123');
    const config = createMockConfig();
    await settingsCmd({ config });
    expect(config.search.braveApiKey).toBe('sk-brave-123');
    expect(mockSaveConfig).toHaveBeenCalled();
  });

  it('shows redirect message for redirected settings', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    (mockShowModal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ label: 'UI & Display', value: 'ui' })
      .mockResolvedValueOnce({ label: 'Theme', value: 'ui.theme' })
      .mockResolvedValueOnce({ label: 'Back', value: '__back__' })
      .mockResolvedValueOnce(null);
    const config = createMockConfig();
    await settingsCmd({ config });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('/theme'));
    consoleSpy.mockRestore();
  });

  it('does not save when user cancels edit', async () => {
    (mockShowModal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ label: 'Agent Behavior', value: 'agent' })
      .mockResolvedValueOnce({ label: 'Max iterations', value: 'agent.maxIterations' })
      .mockResolvedValueOnce({ label: 'Back', value: '__back__' })
      .mockResolvedValueOnce(null);
    (mockShowInput as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const config = createMockConfig();
    await settingsCmd({ config });
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });
});
