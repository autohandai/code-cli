import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { isRecord } from './record.js';
import { parseSessionTransfer, parseTransferReceipt, transferMessageContent, type SessionTransfer, type TransferReceipt } from './session-transfer.js';

/** Recover the CLI's owner-record lock format without removing an active owner's files. */
async function recoverExitedImporter(lock: string): Promise<void> {
  try {
    const stat = await fs.lstat(lock);
    if (!stat.isDirectory()) { return; }
    const entries = await fs.readdir(lock, { withFileTypes: true });
    if (!entries.length) { if (Date.now() - stat.mtimeMs >= 300_000) { await fs.rmdir(lock); } return; }
    for (const entry of entries) {
      if (!entry.isFile() || !/^[0-9a-f-]{36}\.owner$/.test(entry.name)) { return; }
      let owner: unknown;
      try { owner = JSON.parse(await fs.readFile(path.join(lock, entry.name), 'utf8')); } catch { return; }
      if (!isRecord(owner) || owner.version !== 1 || entry.name !== `${String(owner.ownerId)}.owner`
        || typeof owner.createdAt !== 'number' || !Number.isFinite(owner.createdAt) || Date.now() - owner.createdAt < 300_000
        || typeof owner.pid !== 'number' || !Number.isInteger(owner.pid) || owner.pid <= 0) { return; }
      try { process.kill(owner.pid, 0); return; }
      catch (error) { if (!isRecord(error) || error.code !== 'ESRCH') { return; } }
    }
    for (const entry of entries) { await fs.unlink(path.join(lock, entry.name)); }
    await fs.rmdir(lock);
  } catch (error) {
    if (!isRecord(error) || !['ENOENT', 'ENOTEMPTY', 'EEXIST', 'ENOTDIR'].includes(String(error.code))) { throw error; }
  }
}

/** Import once into the CLI's durable session format; no imported prompt is executed. */
export async function importTransferSession(snapshot: SessionTransfer, receipt: TransferReceipt, workspace: string, directory: string): Promise<string> {
  const value = parseSessionTransfer(snapshot), transfer = parseTransferReceipt(receipt);
  const root = path.resolve(workspace);
  if (!(await fs.stat(root)).isDirectory()) { throw new Error('Choose an existing workspace directory.'); }
  await fs.mkdir(directory, { recursive: true });
  const id = `web-${transfer.id}`, destination = path.join(directory, id);
  const lock = path.join(directory, 'index.json.lock'), owner = `${randomUUID()}.owner`;
  const deadline = Date.now() + 10_000;
  while (true) {
    try { await fs.mkdir(lock, { mode: 0o700 }); break; }
    catch (error) {
      if (!isRecord(error) || error.code !== 'EEXIST' || Date.now() >= deadline) { throw error; }
      await recoverExitedImporter(lock); await delay(25);
    }
  }
  let temporary: string | undefined;
  try {
    await fs.writeFile(path.join(lock, owner), JSON.stringify({ version: 1, ownerId: owner.slice(0, -6), pid: process.pid, createdAt: Date.now() }), { mode: 0o600, flag: 'wx' });
    let existing: unknown;
    try { existing = JSON.parse(await fs.readFile(path.join(destination, 'metadata.json'), 'utf8')); }
    catch (error) { if (!isRecord(error) || error.code !== 'ENOENT') { throw error; } }
    if (existing !== undefined && (!isRecord(existing) || !isRecord(existing.importedFrom) || existing.importedFrom.originalId !== transfer.id ||
        existing.importedFrom.accountId !== transfer.accountId || existing.projectPath !== root)) {
      throw new Error('This transfer was already imported into another workspace.');
    }
    let index: unknown;
    try { index = JSON.parse(await fs.readFile(path.join(directory, 'index.json'), 'utf8')); }
    catch (error) { if (!isRecord(error) || error.code !== 'ENOENT') { throw error; } index = { sessions: [], byProject: {} }; }
    if (!isRecord(index) || !Array.isArray(index.sessions) || !isRecord(index.byProject)) { throw new Error('The local session index is unavailable.'); }
    if (existing === undefined) {
      temporary = await fs.mkdtemp(path.join(directory, `${id}.import-`));
      const metadata = { sessionId: id, projectPath: root, projectName: path.basename(root), model: value.model,
        createdAt: value.createdAt, lastActiveAt: new Date().toISOString(), messageCount: value.messages.length, status: 'completed', summary: value.title,
        client: 'web', importedFrom: { source: 'Autohand Code Web', originalId: transfer.id, accountId: transfer.accountId, importedAt: new Date().toISOString() } };
      await fs.writeFile(path.join(temporary, 'metadata.json'), JSON.stringify(metadata, null, 2), { mode: 0o600 });
      await fs.writeFile(path.join(temporary, 'conversation.jsonl'), value.messages.map(message => JSON.stringify({ role: message.role, content: transferMessageContent(message),
        ...(message.images?.length ? { attachmentNames: message.images.map(image => image.name) } : {}), timestamp: message.createdAt })).join('\n') + '\n', { mode: 0o600 });
      await fs.rename(temporary, destination); temporary = undefined;
    }
    // Recover an interrupted index update without rewriting an already resumed conversation.
    if (!index.sessions.some((entry: unknown) => isRecord(entry) && entry.id === id)) {
      index.sessions.push({ id, projectPath: root, createdAt: value.createdAt, summary: value.title, importedFrom: { source: 'Autohand Code Web', originalId: transfer.id } });
    }
    const project: unknown = index.byProject[root];
    if (project !== undefined && (!Array.isArray(project) || project.some((entry: unknown) => typeof entry !== 'string'))) { throw new Error('The local project session index is unavailable.'); }
    index.byProject[root] = [...new Set([...(Array.isArray(project) ? project as string[] : []), id])];
    const indexTemporary = path.join(directory, `index.${randomUUID()}.tmp`);
    try { await fs.writeFile(indexTemporary, JSON.stringify(index, null, 2), { mode: 0o600, flag: 'wx' }); await fs.rename(indexTemporary, path.join(directory, 'index.json')); }
    finally { await fs.rm(indexTemporary, { force: true }); }
    return id;
  } finally {
    if (temporary) { await fs.rm(temporary, { recursive: true, force: true }); }
    await fs.rm(path.join(lock, owner), { force: true }); await fs.rmdir(lock);
  }
}
