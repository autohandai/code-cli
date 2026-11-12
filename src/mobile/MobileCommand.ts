export type MobilePlatform = 'ios' | 'android';

export const MOBILE_COMMAND_USAGE = 'Usage: /mobile [ios|android] [--steer|--queue]';

export function parseMobileSlashCommand(input: string): { command: '/mobile'; args: string[] } | null {
  const match = /^\/(mobile|ios|android)(?:\(([^)\s]+)\))?(?:\s+([\s\S]*))?$/i.exec(input.trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  const platform = name === 'mobile' ? match[2]?.toLowerCase() : name;
  if (name !== 'mobile' && match[2]) return null;
  const args = match[3]?.trim().split(/\s+/).filter(Boolean) ?? [];
  return { command: '/mobile', args: platform ? [platform, ...args] : args };
}

export function mobilePairingOptions(args: readonly string[]):
  | { platform: MobilePlatform; help: boolean }
  | null {
  const platform = args.find(arg => !arg.startsWith('--'))?.toLowerCase() ?? 'ios';
  if (platform !== 'ios' && platform !== 'android') return null;
  if (args.some(arg => !['ios', 'android'].includes(arg.toLowerCase()) && !['--steer', '--queue', '--help'].includes(arg))) return null;
  if (args.filter(arg => !arg.startsWith('--')).length > 1) return null;
  return { platform, help: args.includes('--help') };
}
