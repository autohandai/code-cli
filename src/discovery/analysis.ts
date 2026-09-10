import { spawn } from 'node:child_process';
import { z } from 'zod';

const STDERR_TAIL_LIMIT = 2_000;

/** Keeps the child's last stderr lines readable and free of secrets and control characters. */
function describeDiagnostics(diagnostics: string): string {
  const tail = diagnostics
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ' ')
    .replace(/\bahc_[\w-]+|\bsk-[\w-]+|-----BEGIN[^-]*PRIVATE KEY-----/g, '[redacted]')
    .trim();
  return tail ? `\n  Analysis stderr (tail): ${tail}` : '';
}

const resultSchema = z.object({
  type: z.literal('result'),
  content: z.string().max(256_000),
});
export function createDiscoveryAnalyzer(options: {
  cwd: string;
  executable?: string;
  prefix?: string[];
  configPath?: string;
  timeoutMs?: number;
}) {
  return async (evidence: string, signal?: AbortSignal): Promise<string> => {
    signal?.throwIfAborted();
    if (Buffer.byteLength(evidence) > 512_000)
      throw new Error(
        'Discovery analysis evidence exceeds 512 KB. Narrow the workspace or skill search.'
      );
    const entry = process.argv[1];
    if (!entry && !options.prefix)
      throw new Error('Could not locate the Autohand analysis executable.');
    const prefix =
      options.prefix ??
      (entry.includes('$bunfs') ? [] : [...process.execArgv, entry]);
    const child = spawn(
      options.executable ?? process.execPath,
      [
        ...prefix,
        ...(options.configPath ? ['--config', options.configPath] : []),
        '--bare',
        '--restricted',
        '--max-iterations',
        '2',
        '--json',
        'local',
        '-p',
        '$workflow-discovery Analyze only the supplied evidence and candidates from stdin. Do not call tools. Return the validated recommendation JSON described by the skill.',
      ],
      {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        env: {
          ...process.env,
          AUTOHAND_DISCOVERY_CHILD: '',
          AUTOHAND_NO_BANNER: '1',
          AUTOHAND_DISABLE_AUTO_REPORT: '1',
        },
      }
    );
    let output = '';
    let bytes = 0;
    let diagnostics = '';
    let failure: Error | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      child.kill('SIGTERM');
      grace = setTimeout(() => child.kill('SIGKILL'), 1000);
      grace.unref();
    };
    const cancel = () => stop(new Error('Discovery analysis cancelled.'));
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(
      () =>
        stop(
          new Error('Discovery analysis timed out after its execution limit.')
        ),
      options.timeoutMs ?? 120_000
    );
    timer.unref();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      bytes += Buffer.byteLength(data);
      if (bytes > 512_000)
        stop(new Error('Discovery analysis exceeded its output limit.'));
      else output += data;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (data: string) => {
      diagnostics = `${diagnostics}${data}`.slice(-STDERR_TAIL_LIMIT);
    });
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE')
        stop(
          new Error('Could not send discovery evidence to the analysis child.')
        );
    });
    child.stdin.end(evidence);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', () =>
          reject(new Error('Could not start discovery analysis.'))
        );
        child.once('close', resolve);
      });
      if (failure) throw failure;
      if (code !== 0)
        throw new Error(
          `Discovery analysis failed. Check the configured provider; local drafts are unchanged.${describeDiagnostics(diagnostics)}`
        );
      try {
        return resultSchema.parse(JSON.parse(output)).content;
      } catch {
        throw new Error(
          'Discovery analysis did not return a structured command result.'
        );
      }
    } finally {
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      signal?.removeEventListener('abort', cancel);
    }
  };
}
