import { describe, expect, it } from 'vitest';
import { mobilePairingOptions, parseMobileSlashCommand } from '../../src/mobile/MobileCommand.js';

describe('mobile pairing command syntax', () => {
  it.each(['/mobile(ios)', '/ios', '/MOBILE(IOS)'])('normalizes %s without producing an agent prompt', input => {
    expect(parseMobileSlashCommand(input)).toEqual({ command: '/mobile', args: ['ios'] });
  });
  it.each(['/mobilex', 'please /mobile', '/ios(foo)', '/model ios'])('does not capture unrelated input %s', input => {
    expect(parseMobileSlashCommand(input)).toBeNull();
  });
  it.each([['windows'], ['ios', 'android'], ['--unknown'], ['--QUEUE'], ['--HELP']])('rejects invalid options %j', (...args) => {
    expect(mobilePairingOptions(args)).toBeNull();
  });
  it('defaults bare /mobile to the native iOS app and retains explicit queue/steer options', () => {
    expect(mobilePairingOptions([])).toEqual({ platform: 'ios', help: false });
    expect(mobilePairingOptions(['android', '--queue'])).toEqual({ platform: 'android', help: false });
    expect(mobilePairingOptions(['--help'])).toEqual({ platform: 'ios', help: true });
  });
});
