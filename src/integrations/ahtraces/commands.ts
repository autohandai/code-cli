/** @license Apache-2.0 */
import { loadConfig } from '../../config.js';
import { runAhTracesProcess } from './client.js';
import { setTraceMonitoringEnabled } from './preferences.js';

type PublicTraceCommand = 'status' | 'on' | 'off' | 'stop' | 'help';

interface TraceCommandArguments {
  command: PublicTraceCommand;
  configPath?: string;
  json: boolean;
}

function optionValue(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseTraceCommandArguments(argv: readonly string[]): TraceCommandArguments {
  let command: PublicTraceCommand | undefined;
  let configPath: string | undefined;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--config') {
      configPath = optionValue(argv, index, argument);
      index += 1;
    } else if (argument === '--json') {
      json = true;
    } else if (argument === '--help' || argument === '-h') {
      command = 'help';
    } else if (!argument.startsWith('-') && ['status', 'on', 'off', 'stop'].includes(argument)) {
      if (command) throw new Error(`Unexpected traces command: ${argument}`);
      command = argument as PublicTraceCommand;
    } else {
      throw new Error(`Unknown traces command: ${argument}`);
    }
  }
  return {
    command: command ?? 'status',
    ...(configPath ? { configPath } : {}),
    json,
  };
}

function printHelp(): void {
  console.log([
    'Usage: autohand traces [status|on|off|stop]',
    '',
    '  status   Show whether the Autohand traces sub agent is running',
    '  on       Enable metadata trace sync and start the sub agent',
    '  off      Disable trace monitoring and remove local derived data',
    '  stop     Stop the current daemon without changing consent',
    '',
    'View synchronized traces at https://console.autohand.ai/traces.',
  ].join('\n'));
}

export async function runAhTracesCommand(argv: readonly string[]): Promise<number> {
  const parsed = parseTraceCommandArguments(argv);
  if (parsed.command === 'help') {
    printHelp();
    return 0;
  }
  if (parsed.command === 'on' || parsed.command === 'off') {
    const enabled = parsed.command === 'on';
    const config = await loadConfig(parsed.configPath);
    await setTraceMonitoringEnabled(config, enabled);
    console.log(enabled
      ? 'Agent traces are on. Metadata syncs to https://console.autohand.ai/traces and does not count against API usage.'
      : 'Agent traces are off. The daemon stopped and local derived trace data was removed.');
    return 0;
  }

  const result = await runAhTracesProcess([
    parsed.command,
    ...(parsed.json ? ['--json'] : []),
  ], {});
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}
