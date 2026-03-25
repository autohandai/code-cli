export type AutoModeLaunchMode = 'disabled' | 'standalone' | 'interactive' | 'unavailable';

export interface AutoModeRoutingOptions {
  hasAutoModeFlag: boolean;
  autoModeTask?: string;
  prompt?: string;
  stdinIsTTY: boolean;
}

export function resolveAutoModeLaunchMode(options: AutoModeRoutingOptions): AutoModeLaunchMode {
  if (!options.hasAutoModeFlag) {
    return 'disabled';
  }

  if (options.autoModeTask?.trim()) {
    return 'standalone';
  }

  return options.stdinIsTTY ? 'interactive' : 'unavailable';
}
