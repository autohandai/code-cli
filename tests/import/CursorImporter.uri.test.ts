import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SessionIndex, SessionMetadata } from '../../src/session/types.js';

const mocks = vi.hoisted(() => {
  const prepare = vi.fn();
  const close = vi.fn();
  return {
    prepare,
    close,
    database: vi.fn(function DatabaseSync() { return { prepare, close }; }),
    fs: {
      pathExists: vi.fn(), readdir: vi.fn(), readJson: vi.fn(),
      ensureDir: vi.fn(), writeJson: vi.fn(), writeFile: vi.fn(), copy: vi.fn(),
    },
    atomicWriteJson: vi.fn(),
    withFileLock: vi.fn(async (_lockPath: string, operation: () => Promise<unknown>) => operation()),
  };
});

vi.mock('node:sqlite', () => ({ DatabaseSync: mocks.database }));
vi.mock('fs-extra', () => ({ default: mocks.fs }));
vi.mock('../../src/utils/atomicFile.js', () => ({
  atomicWriteJson: mocks.atomicWriteJson,
  withFileLock: mocks.withFileLock,
}));

import { CursorImporter } from '../../src/import/importers/CursorImporter.js';

const sourceHome = path.join(os.tmpdir(), 'autohand-cursor-uri-fixture');
const chatsDirectory = path.join(sourceHome, 'chats');
const hashDirectory = path.join(chatsDirectory, 'fixture-hash');
const databasePath = path.join(hashDirectory, 'fixture-id', 'store.db');
const projectRoot = path.join(os.tmpdir(), 'autohand-cursor-project-fixture');
const userMessage = Buffer.from(JSON.stringify({ role: 'user', content: 'Preserve this fixture conversation.' }));

function uriBlob(uri: string, delimiter = 0): Buffer {
  return Buffer.concat([Buffer.from([0x3b]), Buffer.from(uri), Buffer.from([delimiter, 0xff])]);
}

function prepareFixture(blobs: Buffer[]): CursorImporter {
  mocks.prepare.mockImplementation((sql: string) => {
    if (sql.includes('meta')) return { get: () => ({ value: Buffer.from(JSON.stringify({
      agentId: 'fixture-id', name: 'Fixture project', createdAt: 1772503000000, lastUsedModel: 'fixture-model',
    })).toString('hex') }) };
    return { all: () => [...blobs, userMessage].map(data => ({ data })) };
  });
  return new CursorImporter({ sourceHome });
}

async function importProject(blobs: Buffer[]): Promise<{ metadata: SessionMetadata; index: SessionIndex }> {
  const result = await prepareFixture(blobs).import(['sessions']);
  expect(result.imported.get('sessions')).toEqual({ success: 1, failed: 0, skipped: 0 });
  expect(mocks.database).toHaveBeenCalledWith(databasePath, { readOnly: true });
  expect(mocks.close).toHaveBeenCalledOnce();
  const metadataCall = mocks.fs.writeJson.mock.calls.find(([file]) => String(file).endsWith('metadata.json'));
  expect(metadataCall).toBeDefined();
  const metadata = metadataCall?.[1] as SessionMetadata;
  const index = mocks.atomicWriteJson.mock.calls[0]?.[1] as SessionIndex;
  expect(mocks.fs.writeFile.mock.calls[0]?.[1]).toContain('Preserve this fixture conversation.');
  return { metadata, index };
}

function expectProjectAssociation(metadata: SessionMetadata, index: SessionIndex, expected: string): void {
  expect(metadata.projectPath).toBe(expected);
  expect(metadata.projectName).toBe(path.basename(expected));
  expect(index.sessions).toEqual([expect.objectContaining({ id: metadata.sessionId, projectPath: expected })]);
  expect(index.byProject).toEqual({ [expected]: [metadata.sessionId] });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fs.pathExists.mockImplementation(async (file: string) => [sourceHome, chatsDirectory, databasePath].includes(file));
  mocks.fs.readdir.mockImplementation(async (directory: string) => {
    const name = directory === chatsDirectory ? 'fixture-hash' : directory === hashDirectory ? 'fixture-id' : undefined;
    return name ? [{ name, isDirectory: () => true }] : [];
  });
  mocks.fs.readJson.mockResolvedValue({});
  mocks.fs.ensureDir.mockResolvedValue(undefined);
  mocks.fs.writeJson.mockResolvedValue(undefined);
  mocks.fs.writeFile.mockResolvedValue(undefined);
  mocks.atomicWriteJson.mockResolvedValue(undefined);
});

describe('Cursor binary-blob project file URIs', () => {
  it.each([
    'Documents - igor/autohand/cli-3', 'project#draft', '100%complete', '日本語-é',
    'Documents - igor/project#100%日本語', 'literal%20folder', "Igor's project",
  ])('preserves the complete native project association for %s', async (suffix) => {
    const expected = path.join(projectRoot, suffix);
    const { metadata, index } = await importProject([uriBlob(pathToFileURL(expected).href)]);
    expectProjectAssociation(metadata, index, expected);
  });

  it.each([0, 0x12, 0x1f, 0x7f])('respects binary terminator %s', async (delimiter) => {
    const expected = path.join(projectRoot, 'project with spaces');
    const { metadata, index } = await importProject([uriBlob(pathToFileURL(expected).href, delimiter)]);
    expectProjectAssociation(metadata, index, expected);
  });

  it('accepts a complete file URI at the end of a blob', async () => {
    const expected = path.join(projectRoot, 'last-project');
    const { metadata, index } = await importProject([Buffer.from(pathToFileURL(expected).href)]);
    expectProjectAssociation(metadata, index, expected);
  });

  it.each([
    'file:///wrong/project%GG', 'file:///wrong/project%', 'file:///wrong/%E6',
    'file:///wrong/project#fragment', 'file:///wrong/project?query=1',
    'file:///wrong/project#', 'file:///wrong/project?',
    'file:///wrong/project broken/name', 'file:///wrong/project%00', 'file:///wrong/project%2Fchild',
  ])('does not accept a partial parent from malformed URI %s', async (uri) => {
    const { metadata, index } = await importProject([uriBlob(uri)]);
    expectProjectAssociation(metadata, index, process.cwd());
  });

  it('skips malformed candidates before a later complete URI', async () => {
    const expected = path.join(projectRoot, 'complete-project');
    const { metadata, index } = await importProject([Buffer.concat([
      uriBlob('file:///wrong/project%GG'), uriBlob(pathToFileURL(expected).href),
    ])]);
    expectProjectAssociation(metadata, index, expected);
  });

  it('accepts a complete JSON-quoted URI without consuming the closing delimiter', async () => {
    const expected = path.join(projectRoot, 'quoted project');
    const { metadata, index } = await importProject([Buffer.from(JSON.stringify({ folderUri: pathToFileURL(expected).href }))]);
    expectProjectAssociation(metadata, index, expected);
  });

  it('keeps an established association when a later blob has a malformed URI', async () => {
    const expected = path.join(projectRoot, 'complete-project');
    const { metadata, index } = await importProject([
      uriBlob(pathToFileURL(expected).href), uriBlob('file:///wrong/project%GG'),
    ]);
    expectProjectAssociation(metadata, index, expected);
  });

  it('does not accept a URI cut off by the bounded blob scan', async () => {
    const { metadata, index } = await importProject([uriBlob(`file:///project/${'a'.repeat(100010)}`)]);
    expect(metadata.projectPath === process.cwd()).toBe(true);
    expect(index.byProject).toHaveProperty(process.cwd());
  });

  it.skipIf(process.platform !== 'win32')('preserves native Windows UNC project paths', async () => {
    const expected = '\\\\server\\share\\Project Name';
    const { metadata, index } = await importProject([uriBlob('file://server/share/Project%20Name')]);
    expectProjectAssociation(metadata, index, expected);
  });

  it('preserves existing import deduplication without rewriting old history', async () => {
    const existingIndex: SessionIndex = {
      sessions: [{ id: 'existing', projectPath: '/previous/project', createdAt: '2026-01-01T00:00:00Z',
        importedFrom: { source: 'cursor', originalId: 'fixture-id' } }],
      byProject: { '/previous/project': ['existing'] },
    };
    const importer = prepareFixture([uriBlob(pathToFileURL(path.join(projectRoot, 'correct path')).href)]);
    mocks.fs.pathExists.mockImplementation(async (file: string) =>
      file.endsWith('index.json') || [sourceHome, chatsDirectory, databasePath].includes(file));
    mocks.fs.readJson.mockResolvedValue(existingIndex);
    const result = await importer.import(['sessions']);
    expect(result.imported.get('sessions')).toEqual({ success: 0, failed: 0, skipped: 1 });
    expect(mocks.fs.writeJson).not.toHaveBeenCalled();
    expect(mocks.atomicWriteJson).not.toHaveBeenCalled();
    expect(existingIndex.byProject).toEqual({ '/previous/project': ['existing'] });
  });
});
