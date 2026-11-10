import { describe, expect, it, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { startReviewedReply, configureExaSearch, changeSearchInSettings, configureRouterPolicy } from '../../src/testing/scenarios/finalReplyScenario.js';
import { createMockAutohandAINativeSequenceServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

const ui = { promptSuggestions: false, showCompletionNotification: false, terminalBell: false };
describe('final reply visibility and search setup', () => {
  it.each([false, true])('holds the candidate until review and preserves rejected or interrupted drafts; cancel=%s', async cancel => {
    const changesReview = Promise.withResolvers<void>();
    const approvalReview = Promise.withResolvers<void>();
    const server = await createMockAutohandAINativeSequenceServer([
      { content: 'Reading facts.', toolCall: { id: 'read', name: 'read_file', args: { path: 'package.json' } } },
      { content: 'REVIEW_PENDING_ANSWER: package facts checked.' },
      { content: '{"verdict":"changes_requested","feedback":"Verify the version too."}', responseGate: changesReview.promise },
      { content: 'REVIEW_REVISED_ANSWER: package and version checked.' },
      { content: '{"verdict":"approved","feedback":"Verified."}', responseGate: approvalReview.promise },
    ]);
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai', autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture', model: 'moa', orchestration: true, baseUrl: server.baseUrl },
      features: { autohand_inference: true, automaticSpecialists: false },
      agent: { autoMemory: false, maxIterations: 6, sessionRetryLimit: 0 }, network: { maxRetries: 0, retryDelay: 0 }, ui,
      search: { provider: 'exa', exaApiKey: 'fixture' },
    } });
    let session: Awaited<ReturnType<typeof launchBuiltAutohand>> | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 120, rows: 50 });
      await startReviewedReply(session, () => vi.waitFor(() => expect(server.requests).toHaveLength(3), { timeout: 20_000 }));
      expect(JSON.stringify(server.requests[2])).toContain('independent Moa advisor');
      expect(session.getRawOutput()).not.toContain('REVIEW_PENDING_ANSWER');
      expect(session.getRawOutput()).not.toContain('REVIEW_REVISED_ANSWER');
      expect(session.getRawOutput()).not.toContain('Completed in');
      if (cancel) {
        await session.press('escape');
        await session.waitForText('completion review was interrupted', { timeout: 15_000 });
        expect(session.getRawOutput()).not.toContain('Completed in');
        expect(session.getRawOutput()).not.toContain('REVIEW_REVISED_ANSWER');
        expect(server.requests).toHaveLength(3);
      } else {
        changesReview.resolve();
        await session.waitForText('completion review requested changes');
        await vi.waitFor(() => expect(server.requests).toHaveLength(5), { timeout: 20_000 });
        expect(session.getRawOutput()).toContain('Draft — completion is not confirmed');
        expect(session.getRawOutput()).toContain('REVIEW_PENDING_ANSWER');
        expect(session.getRawOutput()).not.toContain('REVIEW_REVISED_ANSWER');
        expect(session.getRawOutput()).not.toContain('Completed in');
        approvalReview.resolve();
        await session.waitForText('REVIEW_REVISED_ANSWER', { timeout: 20_000 });
        await session.waitForText('Completed in', { timeout: 20_000 });
        expect(session.getRawOutput()).toContain('completion review requested changes');
      }
      expect(session.getRawOutput()).toContain('REVIEW_PENDING_ANSWER');
      expect(session.getRawOutput()).toContain('Draft — completion is not confirmed');
      await exitInteractive(session);
      expect(session.exitInfo?.exitCode).toBe(0);
      const sessionsRoot = path.join(state.autohandHome, 'sessions');
      const dirs = (await readdir(sessionsRoot, { withFileTypes: true })).filter(entry => entry.isDirectory());
      const histories = await Promise.all(dirs.map(entry => readFile(path.join(sessionsRoot, entry.name, 'conversation.jsonl'), 'utf8')));
      expect(histories.join('\n')).toContain('REVIEW_PENDING_ANSWER');
      expect(histories.join('\n')).toContain(cancel ? 'completion review was interrupted' : 'completion review requested changes');
      if (cancel) expect(histories.join('\n')).not.toContain('REVIEW_REVISED_ANSWER');
      else expect(histories.join('\n')).toContain('REVIEW_REVISED_ANSWER');
    } finally {
      changesReview.resolve();
      approvalReview.resolve();
      session?.close();
      await session?.waitForExit(5000);
      await server.close(); await state.cleanup();
    }
  });
  it('navigates search providers, saves Exa credentials, and exits cleanly', async () => {
    const state = await createTempAutohandHome({ config: { search: { provider: 'browser-profile' }, auth: {}, ui, agent: { autoMemory: false } } });
    let session: Awaited<ReturnType<typeof launchBuiltAutohand>> | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 120, rows: 40 });
      await configureExaSearch(session);
      const config = JSON.parse(await readFile(state.configPath, 'utf8'));
      expect(config.search).toMatchObject({ provider: 'exa', exaApiKey: 'exa-terminal-fixture' });
      await changeSearchInSettings(session);
      await exitInteractive(session);
    } finally { session?.close(); await session?.waitForExit(5000); await state.cleanup(); }
  });
  it('saves a confirmed router policy absent from /models through the terminal', async () => {
    const server = await createMockAutohandAINativeSequenceServer([], { models: ['qwen3-coder'] });
    const state = await createTempAutohandHome({ config: { search: { provider: 'exa', exaApiKey: 'fixture' }, ui, agent: { autoMemory: false } } });
    let session: Awaited<ReturnType<typeof launchBuiltAutohand>> | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 120, rows: 40 });
      await configureRouterPolicy(session, server.baseUrl);
      const config = JSON.parse(await readFile(state.configPath, 'utf8'));
      expect(config.provider).toBe('custom:routes');
      expect(config.customProviders.routes.model).toBe('router-balanced');
      await exitInteractive(session);
    } finally { session?.close(); await session?.waitForExit(5000); await server.close(); await state.cleanup(); }
  });
});
