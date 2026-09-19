import { describe, expect, it } from 'vitest';
import { resolveAhTracesRuntimePaths } from '../../src/traces/runtimePaths.js';

describe('ahtraces runtime paths', () => {
  it('keeps durable state under Autohand home and uses a short Unix control socket', () => {
    const paths = resolveAhTracesRuntimePaths({
      autohandHome: '/Users/tester/.autohand',
      platform: 'darwin',
      temporaryDirectory: '/tmp',
      userId: 501,
    });

    expect(paths.directory).toBe('/Users/tester/.autohand/traces');
    expect(paths.stateFile).toBe('/Users/tester/.autohand/traces/daemon.json');
    expect(paths.socketPath).toMatch(/^\/tmp\/ahtraces-501-[a-f0-9]{16}\.sock$/);
    expect(Buffer.byteLength(paths.socketPath)).toBeLessThan(100);
  });

  it('uses a per-home named pipe on Windows', () => {
    const paths = resolveAhTracesRuntimePaths({
      autohandHome: 'C:\\Users\\tester\\.autohand',
      platform: 'win32',
      temporaryDirectory: 'C:\\Temp',
    });

    expect(paths.socketPath).toMatch(/^\\\\\.\\pipe\\ahtraces-[a-f0-9]{16}$/);
  });

  it('does not collide case-distinct Autohand homes on case-sensitive platforms', () => {
    const lower = resolveAhTracesRuntimePaths({
      autohandHome: '/home/tester/.autohand',
      platform: 'linux',
      temporaryDirectory: '/tmp',
      userId: 1000,
    });
    const upper = resolveAhTracesRuntimePaths({
      autohandHome: '/home/tester/.Autohand',
      platform: 'linux',
      temporaryDirectory: '/tmp',
      userId: 1000,
    });

    expect(lower.socketPath).not.toBe(upper.socketPath);
  });
});
