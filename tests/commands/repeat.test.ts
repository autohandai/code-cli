import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseInput, intervalToCron, repeat } from '../../src/commands/repeat.js';
import { RepeatManager } from '../../src/core/RepeatManager.js';

// ─── parseInput tests ───────────────────────────────────────────────────────

describe('parseInput', () => {
  it('rule 1: leading interval token', () => {
    expect(parseInput('5m /babysit-prs')).toMatchObject({ interval: '5m', prompt: '/babysit-prs', explicit: true });
    expect(parseInput('2h check build')).toMatchObject({ interval: '2h', prompt: 'check build', explicit: true });
    expect(parseInput('1d deploy')).toMatchObject({ interval: '1d', prompt: 'deploy', explicit: true });
    expect(parseInput('30s run quick check')).toMatchObject({ interval: '30s', prompt: 'run quick check', explicit: true });
  });

  it('rule 1: leading token alone (empty prompt)', () => {
    expect(parseInput('5m')).toMatchObject({ interval: '5m', prompt: '', explicit: true });
  });

  it('rule 2: leading "every <N> <unit>" clause', () => {
    expect(parseInput('every 2 minutes bun run test')).toMatchObject({ interval: '2m', prompt: 'bun run test', explicit: true });
    expect(parseInput('every 5m check deploy')).toMatchObject({ interval: '5m', prompt: 'check deploy', explicit: true });
    expect(parseInput('every 1 hour run backup')).toMatchObject({ interval: '1h', prompt: 'run backup', explicit: true });
    expect(parseInput('every 30 seconds ping')).toMatchObject({ interval: '30s', prompt: 'ping', explicit: true });
  });

  it('rule 3: trailing "every <N><unit>" (end of input)', () => {
    expect(parseInput('check the deploy every 20m')).toMatchObject({ interval: '20m', prompt: 'check the deploy', explicit: true });
  });

  it('rule 3: trailing "every <N> <unit-word>"', () => {
    expect(parseInput('run tests every 5 minutes')).toMatchObject({ interval: '5m', prompt: 'run tests', explicit: true });
    expect(parseInput('check status every 2 hours')).toMatchObject({ interval: '2h', prompt: 'check status', explicit: true });
    expect(parseInput('backup every 1 day')).toMatchObject({ interval: '1d', prompt: 'backup', explicit: true });
    expect(parseInput('ping every 30 seconds')).toMatchObject({ interval: '30s', prompt: 'ping', explicit: true });
  });

  it('rule 4: middle "every <N><unit>" joins surrounding text', () => {
    expect(parseInput('tell me a joke every 10s about life')).toMatchObject({
      interval: '10s', prompt: 'tell me a joke about life', explicit: true,
    });
    expect(parseInput('run tests every 2m and report results')).toMatchObject({
      interval: '2m', prompt: 'run tests and report results', explicit: true,
    });
    expect(parseInput('check deploy every 1h then notify me')).toMatchObject({
      interval: '1h', prompt: 'check deploy then notify me', explicit: true,
    });
  });

  it('rule 4: middle "every <N> <unit-word>" joins surrounding text', () => {
    expect(parseInput('pull changes every 5 minutes and run lint')).toMatchObject({
      interval: '5m', prompt: 'pull changes and run lint', explicit: true,
    });
  });

  it('rule: singular "every <unit>" without number implies 1', () => {
    expect(parseInput('say hello to me every minute')).toMatchObject({ interval: '1m', prompt: 'say hello to me', explicit: true });
    expect(parseInput('check git commits every hour')).toMatchObject({ interval: '1h', prompt: 'check git commits', explicit: true });
    expect(parseInput('run backup every day')).toMatchObject({ interval: '1d', prompt: 'run backup', explicit: true });
    expect(parseInput('ping every second')).toMatchObject({ interval: '1s', prompt: 'ping', explicit: true });
  });

  it('rule: leading singular "every <unit>"', () => {
    expect(parseInput('every minute check the logs')).toMatchObject({ interval: '1m', prompt: 'check the logs', explicit: true });
    expect(parseInput('every hour run tests')).toMatchObject({ interval: '1h', prompt: 'run tests', explicit: true });
  });

  it('rule: middle singular "every <unit>" joins surrounding text', () => {
    expect(parseInput('say hello every minute to me')).toMatchObject({ interval: '1m', prompt: 'say hello to me', explicit: true });
  });

  it('rule 5: "every" not followed by time expression → default', () => {
    expect(parseInput('check every PR')).toMatchObject({ interval: '5m', prompt: 'check every PR', explicit: false });
  });

  it('rule 5: no interval → default 5m', () => {
    expect(parseInput('check the deploy')).toMatchObject({ interval: '5m', prompt: 'check the deploy', explicit: false });
    expect(parseInput('run tests')).toMatchObject({ interval: '5m', prompt: 'run tests', explicit: false });
  });
});

// ─── intervalToCron tests ───────────────────────────────────────────────────

describe('intervalToCron', () => {
  it('minutes that divide 60 cleanly', () => {
    expect(intervalToCron('5m')).toMatchObject({ cronExpression: '*/5 * * * *', humanReadable: 'every 5 minutes' });
    expect(intervalToCron('10m')).toMatchObject({ cronExpression: '*/10 * * * *' });
    expect(intervalToCron('15m')).toMatchObject({ cronExpression: '*/15 * * * *' });
    expect(intervalToCron('30m')).toMatchObject({ cronExpression: '*/30 * * * *' });
    expect(intervalToCron('1m')).toMatchObject({ cronExpression: '*/1 * * * *', humanReadable: 'every 1 minute' });
  });

  it('minutes that do not divide 60 → rounds to nearest clean divisor', () => {
    const result = intervalToCron('7m');
    // 7 doesn't divide 60; nearest divisors of 60 are 6 and 10; 6 is closer
    expect(result.cronExpression).toBe('*/6 * * * *');
    expect(result.roundedNote).toBeDefined();
  });

  it('minutes >= 60 → converts to hours', () => {
    const result = intervalToCron('60m');
    expect(result.cronExpression).toBe('0 */1 * * *');
    expect(result.humanReadable).toBe('every 1 hour');
  });

  it('120m → 2 hours', () => {
    const result = intervalToCron('120m');
    expect(result.cronExpression).toBe('0 */2 * * *');
  });

  it('hours that divide 24', () => {
    expect(intervalToCron('2h')).toMatchObject({ cronExpression: '0 */2 * * *', humanReadable: 'every 2 hours' });
    expect(intervalToCron('6h')).toMatchObject({ cronExpression: '0 */6 * * *' });
    expect(intervalToCron('12h')).toMatchObject({ cronExpression: '0 */12 * * *' });
  });

  it('hours that do not divide 24 → rounds', () => {
    const result = intervalToCron('7h');
    // 7 doesn't divide 24; nearest divisors are 6 and 8; 6 wins (found first at equal distance)
    expect(result.cronExpression).toBe('0 */6 * * *');
    expect(result.roundedNote).toBeDefined();
  });

  it('days', () => {
    expect(intervalToCron('1d')).toMatchObject({ cronExpression: '0 0 */1 * *', humanReadable: 'every 1 day at midnight' });
    expect(intervalToCron('3d')).toMatchObject({ cronExpression: '0 0 */3 * *' });
  });

  it('seconds → rounds up to minutes', () => {
    const result = intervalToCron('30s');
    expect(result.cronExpression).toBe('*/1 * * * *');
    expect(result.roundedNote).toContain('Rounded');
  });

  it('90s → 2m', () => {
    const result = intervalToCron('90s');
    expect(result.cronExpression).toBe('*/2 * * * *');
    expect(result.roundedNote).toContain('Rounded');
  });

  it('throws on invalid format', () => {
    expect(() => intervalToCron('abc')).toThrow('Invalid interval');
    expect(() => intervalToCron('5x')).toThrow('Invalid interval');
  });
});

// ─── RepeatManager tests ───────────────────────────────────────────────────

describe('RepeatManager', () => {
  let manager: RepeatManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RepeatManager();
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  it('schedules a job and triggers callback', () => {
    const cb = vi.fn();
    manager.onTrigger(cb);

    const job = manager.schedule('run tests', 60_000, '*/1 * * * *', 'every 1 minute');
    expect(job.id).toBeDefined();
    expect(job.prompt).toBe('run tests');

    // Should not have fired yet
    expect(cb).not.toHaveBeenCalled();

    // Advance time by 1 minute
    vi.advanceTimersByTime(60_000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(job);

    // Advance another minute
    vi.advanceTimersByTime(60_000);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('cancels a job', () => {
    const cb = vi.fn();
    manager.onTrigger(cb);

    const job = manager.schedule('run tests', 60_000, '*/1 * * * *', 'every 1 minute');
    const ok = manager.cancel(job.id);
    expect(ok).toBe(true);

    vi.advanceTimersByTime(120_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancel returns false for unknown id', () => {
    expect(manager.cancel('nonexistent')).toBe(false);
  });

  it('lists active jobs', () => {
    manager.schedule('job1', 60_000, '*/1 * * * *', 'every 1 minute');
    manager.schedule('job2', 120_000, '*/2 * * * *', 'every 2 minutes');
    expect(manager.list()).toHaveLength(2);
  });

  it('shutdown clears all jobs', () => {
    const cb = vi.fn();
    manager.onTrigger(cb);

    manager.schedule('job1', 60_000, '*/1 * * * *', 'every 1 minute');
    manager.schedule('job2', 60_000, '*/1 * * * *', 'every 1 minute');
    manager.shutdown();

    expect(manager.list()).toHaveLength(0);
    vi.advanceTimersByTime(120_000);
    expect(cb).not.toHaveBeenCalled();
  });

  // ─── maxRuns: auto-cancel after N executions ───────────────────────────

  it('auto-cancels job after maxRuns triggers', () => {
    const cb = vi.fn();
    manager.onTrigger(cb);

    manager.schedule('test', 60_000, '*/1 * * * *', 'every 1 minute', { maxRuns: 3 });

    // Fire 3 times
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(60_000);
    expect(cb).toHaveBeenCalledTimes(3);

    // 4th tick should NOT fire — job was auto-cancelled
    vi.advanceTimersByTime(60_000);
    expect(cb).toHaveBeenCalledTimes(3);
    expect(manager.list()).toHaveLength(0);
  });

  it('job without maxRuns keeps running indefinitely', () => {
    const cb = vi.fn();
    manager.onTrigger(cb);

    manager.schedule('test', 60_000, '*/1 * * * *', 'every 1 minute');

    vi.advanceTimersByTime(60_000 * 10);
    expect(cb).toHaveBeenCalledTimes(10);
    expect(manager.list()).toHaveLength(1);
  });

  it('stores maxRuns and runCount on the job', () => {
    manager.schedule('test', 60_000, '*/1 * * * *', 'every 1 minute', { maxRuns: 5 });
    const job = manager.list()[0];
    expect(job.maxRuns).toBe(5);
    expect(job.runCount).toBe(0);
  });

  it('increments runCount on each trigger', () => {
    const cb = vi.fn();
    manager.onTrigger(cb);

    manager.schedule('test', 60_000, '*/1 * * * *', 'every 1 minute', { maxRuns: 10 });

    vi.advanceTimersByTime(60_000 * 3);
    const job = manager.list()[0];
    expect(job.runCount).toBe(3);
  });

  // ─── custom expiry duration ────────────────────────────────────────────

  it('uses custom expiresInMs instead of default 3 days', () => {
    const cb = vi.fn();
    manager.onTrigger(cb);

    const ONE_HOUR_MS = 60 * 60 * 1000;
    manager.schedule('test', 60_000, '*/1 * * * *', 'every 1 minute', { expiresInMs: ONE_HOUR_MS });

    const job = manager.list()[0];
    expect(job.expiresAt).toBe(job.createdAt + ONE_HOUR_MS);

    // Still alive before expiry
    vi.advanceTimersByTime(ONE_HOUR_MS - 1);
    expect(manager.list()).toHaveLength(1);

    // Expires at exactly ONE_HOUR_MS
    vi.advanceTimersByTime(1);
    expect(manager.list()).toHaveLength(0);
  });

  it('default expiry is still 3 days when no custom expiresInMs', () => {
    manager.schedule('test', 60_000, '*/1 * * * *', 'every 1 minute');
    const job = manager.list()[0];
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    expect(job.expiresAt).toBe(job.createdAt + THREE_DAYS_MS);
  });
});

// ─── /repeat command handler tests ──────────────────────────────────────────

describe('/repeat command', () => {
  let manager: RepeatManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RepeatManager();
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  it('shows usage when called with no args', async () => {
    const result = await repeat({ repeatManager: manager }, []);
    expect(result).toContain('/repeat');
    expect(result).toContain('Usage');
  });

  it('shows usage when prompt is empty after parsing', async () => {
    const result = await repeat({ repeatManager: manager }, ['5m']);
    expect(result).toContain('Usage');
  });

  it('returns warning when no repeat manager', async () => {
    const result = await repeat({ repeatManager: undefined }, ['5m', 'test']);
    expect(result).toContain('not available');
  });

  it('schedules a job with leading interval', async () => {
    const result = await repeat({ repeatManager: manager }, ['5m', 'run', 'tests']);
    expect(result).toContain('Recurring job scheduled');
    expect(result).toContain('run tests');
    expect(result).toContain('every 5 minutes');
    expect(manager.list()).toHaveLength(1);
  });

  it('schedules a job with trailing every clause', async () => {
    const result = await repeat({ repeatManager: manager }, ['check', 'deploy', 'every', '20m']);
    expect(result).toContain('Recurring job scheduled');
    expect(result).toContain('check deploy');
    expect(result).toContain('every 20 minutes');
  });

  it('schedules with default interval when none specified', async () => {
    const result = await repeat({ repeatManager: manager }, ['check', 'the', 'deploy']);
    expect(result).toContain('Recurring job scheduled');
    expect(result).toContain('every 5 minutes');
  });

  it('cancel subcommand cancels a job', async () => {
    const job = manager.schedule('test', 60_000, '*/1 * * * *', 'every 1 minute');
    const result = await repeat({ repeatManager: manager }, ['cancel', job.id]);
    expect(result).toContain('Cancelled');
    expect(manager.list()).toHaveLength(0);
  });

  it('cancel subcommand with invalid id', async () => {
    const result = await repeat({ repeatManager: manager }, ['cancel', 'bad-id']);
    expect(result).toContain('No active job');
  });

  it('cancel subcommand with no id shows usage', async () => {
    const result = await repeat({ repeatManager: manager }, ['cancel']);
    expect(result).toContain('Usage');
  });

  it('list subcommand shows active jobs', async () => {
    manager.schedule('job1', 60_000, '*/1 * * * *', 'every 1 minute');
    const result = await repeat({ repeatManager: manager }, ['list']);
    expect(result).toContain('Active recurring jobs');
    expect(result).toContain('job1');
  });

  it('list subcommand with no jobs', async () => {
    const result = await repeat({ repeatManager: manager }, ['list']);
    expect(result).toContain('No recurring jobs');
  });

  it('schedules a job with middle every clause', async () => {
    const result = await repeat(
      { repeatManager: manager },
      'tell me a joke every 10s about life'.split(' '),
    );
    expect(result).toContain('Recurring job scheduled');
    expect(result).toContain('tell me a joke about life');
    // 10s rounds to 1m
    expect(result).toContain('every 1 minute');
    expect(manager.list()).toHaveLength(1);
  });

  it('shows rounding note for non-clean intervals', async () => {
    const result = await repeat({ repeatManager: manager }, ['7m', 'run', 'lint']);
    expect(result).toContain('Note:');
  });

  // ─── LLM intent extraction tests ────────────────────────────────────────

  it('uses LLM to extract interval from natural language when regex falls through', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue({
        content: '{"interval":"2m","prompt":"navigate to my gh pr list and pick one item to work on"}',
      }),
    };

    const result = await repeat(
      { repeatManager: manager, llm: mockLlm as any },
      'navigate to my gh pr list and pick one item to work on twice a minute'.split(' '),
    );
    expect(result).toContain('Recurring job scheduled');
    expect(result).toContain('every 2 minutes');
    expect(result).toContain('navigate to my gh pr list and pick one item to work on');
    expect(mockLlm.complete).toHaveBeenCalledTimes(1);
  });

  it('uses LLM for ambiguous "hourly" phrasing', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue({
        content: '{"interval":"1h","prompt":"make a git commit with empty message to trigger ci cd"}',
      }),
    };

    const result = await repeat(
      { repeatManager: manager, llm: mockLlm as any },
      'make a git commit with empty message to trigger ci cd hourly'.split(' '),
    );
    expect(result).toContain('Recurring job scheduled');
    expect(result).toContain('every 1 hour');
    expect(mockLlm.complete).toHaveBeenCalledTimes(1);
  });

  it('always calls LLM first when available, even for explicit intervals', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue({
        content: '{"interval":"5m","prompt":"run tests"}',
      }),
    };

    const result = await repeat(
      { repeatManager: manager, llm: mockLlm as any },
      ['5m', 'run', 'tests'],
    );
    expect(result).toContain('Recurring job scheduled');
    expect(mockLlm.complete).toHaveBeenCalledTimes(1);
  });

  it('falls back to regex when LLM returns invalid JSON', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue({
        content: 'I cannot parse this input',
      }),
    };

    const result = await repeat(
      { repeatManager: manager, llm: mockLlm as any },
      ['run', 'tests'],
    );
    expect(result).toContain('Recurring job scheduled');
    expect(result).toContain('every 5 minutes'); // default interval
    expect(result).toContain('run tests');
  });

  it('falls back to regex when LLM throws', async () => {
    const mockLlm = {
      complete: vi.fn().mockRejectedValue(new Error('API error')),
    };

    const result = await repeat(
      { repeatManager: manager, llm: mockLlm as any },
      ['run', 'tests'],
    );
    expect(result).toContain('Recurring job scheduled');
    expect(result).toContain('every 5 minutes');
  });

  it('falls back to regex when LLM returns invalid interval format', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue({
        content: '{"interval":"every 5 minutes","prompt":"run tests"}',
      }),
    };

    const result = await repeat(
      { repeatManager: manager, llm: mockLlm as any },
      ['run', 'tests'],
    );
    expect(result).toContain('Recurring job scheduled');
    expect(result).toContain('every 5 minutes'); // default
  });

  it('works without LLM (no llm in context)', async () => {
    const result = await repeat(
      { repeatManager: manager },
      ['check', 'deploy'],
    );
    expect(result).toContain('Recurring job scheduled');
    expect(result).toContain('every 5 minutes');
  });

  // ─── BUG 2: subcommand typo detection ──────────────────────────────────

  it('suggests "list" when user types "lsit"', async () => {
    const result = await repeat({ repeatManager: manager }, ['lsit']);
    expect(result).not.toContain('Recurring job scheduled');
    expect(result).toContain('list');
    expect(manager.list()).toHaveLength(0);
  });

  it('suggests "cancel" when user types "cancle" alone', async () => {
    const result = await repeat({ repeatManager: manager }, ['cancle']);
    expect(result).not.toContain('Recurring job scheduled');
    expect(result).toContain('cancel');
    expect(manager.list()).toHaveLength(0);
  });

  it('shows usage when user types "help"', async () => {
    const result = await repeat({ repeatManager: manager }, ['help']);
    expect(result).toContain('Usage');
    expect(manager.list()).toHaveLength(0);
  });

  it('suggests "help" when user types "hepl"', async () => {
    const result = await repeat({ repeatManager: manager }, ['hepl']);
    expect(result).not.toContain('Recurring job scheduled');
    expect(result).toContain('help');
    expect(manager.list()).toHaveLength(0);
  });

  it('does not flag multi-word prompts as typos', async () => {
    const result = await repeat({ repeatManager: manager }, ['lint', 'the', 'codebase']);
    expect(result).toContain('Recurring job scheduled');
  });

  it('does not flag words far from subcommands', async () => {
    const result = await repeat({ repeatManager: manager }, ['deploy']);
    expect(result).toContain('Recurring job scheduled');
  });

  // ─── maxRuns: LLM extracts execution count ─────────────────────────────

  it('schedules with maxRuns when LLM extracts count', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue({
        content: '{"interval":"2m","prompt":"tell me a joke","maxRuns":10}',
      }),
    };

    const result = await repeat(
      { repeatManager: manager, llm: mockLlm as any },
      'tell me a joke every 2 minutes only 10 times'.split(' '),
    );
    expect(result).toContain('Recurring job scheduled');
    expect(result).toContain('10 runs');
    const job = manager.list()[0];
    expect(job.maxRuns).toBe(10);
  });

  it('schedules without maxRuns when LLM omits it', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue({
        content: '{"interval":"5m","prompt":"run tests"}',
      }),
    };

    const result = await repeat(
      { repeatManager: manager, llm: mockLlm as any },
      ['run', 'tests', 'every', '5m'],
    );
    expect(result).toContain('Recurring job scheduled');
    expect(result).not.toContain('runs');
    const job = manager.list()[0];
    expect(job.maxRuns).toBeUndefined();
  });

  // ─── custom expiry: LLM extracts duration ──────────────────────────────

  it('schedules with custom expiry when LLM extracts expiresIn', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue({
        content: '{"interval":"1d","prompt":"check PRs","expiresIn":"7d"}',
      }),
    };

    const result = await repeat(
      { repeatManager: manager, llm: mockLlm as any },
      'check PRs every day for the next week'.split(' '),
    );
    expect(result).toContain('Recurring job scheduled');
    expect(result).toContain('7 day');
    const job = manager.list()[0];
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    expect(job.expiresAt).toBe(job.createdAt + SEVEN_DAYS_MS);
  });

  it('defaults to 3 days expiry when LLM omits expiresIn', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue({
        content: '{"interval":"5m","prompt":"run tests"}',
      }),
    };

    const result = await repeat(
      { repeatManager: manager, llm: mockLlm as any },
      ['5m', 'run', 'tests'],
    );
    expect(result).toContain('auto-expire after 3 days');
  });

  // ─── Disambiguation: conflicting interval signals ───────────────────

  it('resolves conflicting intervals: "every day" + "intervals of 10 minutes per run" → 10m wins', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue({
        content: '{"interval":"10m","prompt":"run this command echo hello world","expiresIn":"1d"}',
      }),
    };

    const result = await repeat(
      { repeatManager: manager, llm: mockLlm as any },
      'do this every day run this command echo hello world until tomorrow with intervals of 10 minutes per run'.split(' '),
    );
    expect(result).toContain('Recurring job scheduled');
    expect(result).toContain('every 10 minutes');
    expect(result).toContain('1 day');
    const job = manager.list()[0];
    expect(job.intervalMs).toBe(10 * 60 * 1000);
  });

  it('resolves "every day at 10am for the next week" → interval 1d, expires 7d', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue({
        content: '{"interval":"1d","prompt":"run the build","expiresIn":"7d"}',
      }),
    };

    const result = await repeat(
      { repeatManager: manager, llm: mockLlm as any },
      'every day at 10 am for the next week run the build'.split(' '),
    );
    expect(result).toContain('every 1 day');
    expect(result).toContain('7 day');
  });

  it('resolves "hourly for 2 days only 5 times" → all three fields', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue({
        content: '{"interval":"1h","prompt":"check deployment status","maxRuns":5,"expiresIn":"2d"}',
      }),
    };

    const result = await repeat(
      { repeatManager: manager, llm: mockLlm as any },
      'check deployment status hourly for 2 days only 5 times'.split(' '),
    );
    expect(result).toContain('every 1 hour');
    expect(result).toContain('5 runs');
    expect(result).toContain('2 day');
  });

  it('shows both maxRuns and custom expiry in confirmation', async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue({
        content: '{"interval":"1h","prompt":"check build","maxRuns":5,"expiresIn":"2d"}',
      }),
    };

    const result = await repeat(
      { repeatManager: manager, llm: mockLlm as any },
      'check build every hour only 5 times for 2 days'.split(' '),
    );
    expect(result).toContain('5 runs');
    expect(result).toContain('2 day');
  });
});
