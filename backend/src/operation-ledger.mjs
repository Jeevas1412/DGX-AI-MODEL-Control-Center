import { access, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 1;
const MAX_OPERATIONS = 100;
const OPERATION_ID = /^[a-f0-9-]{36}$/;
const LOCK_RETRY_MS = 10;
const LOCK_RETRY_COUNT = 100;
const STALE_LOCK_MS = 30_000;

function nowIso(now) {
  return now().toISOString();
}

function emptyDocument() {
  return { schemaVersion: SCHEMA_VERSION, lease: null, operations: [] };
}

function safeText(value, name, pattern = /^[a-z0-9._-]{1,96}$/) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`Invalid operation ${name}.`);
  return value;
}

function requireOperationContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Operation context is required.');
  return Object.freeze({
    profileId: safeText(value.profileId, 'profileId'),
    profileFingerprint: value.profileFingerprint === null ? null : safeText(value.profileFingerprint, 'profileFingerprint', /^[A-Za-z0-9:+._-]{1,160}$/),
    targetMachineSha256: safeText(value.targetMachineSha256, 'targetMachineSha256', /^sha256:[a-f0-9]{64}$/),
    capabilitySnapshotSha256: safeText(value.capabilitySnapshotSha256, 'capabilitySnapshotSha256', /^sha256:[a-f0-9]{64}$/),
    adapterId: safeText(value.adapterId, 'adapterId'),
    adapterVersion: safeText(value.adapterVersion, 'adapterVersion'),
    adapterIntegrity: safeText(value.adapterIntegrity, 'adapterIntegrity', /^[a-f0-9]{64}$/),
    planSnapshotDigest: safeText(value.planSnapshotDigest, 'planSnapshotDigest', /^[a-f0-9]{64}$/),
  });
}

function publicOperation(operation) {
  return Object.freeze({
    id: operation.id,
    kind: operation.kind,
    action: operation.action,
    planId: operation.planId,
    context: Object.freeze({ ...operation.context }),
    status: operation.status,
    phase: operation.phase,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    completedAt: operation.completedAt ?? null,
    recoveryRequiredAt: operation.recoveryRequiredAt ?? null,
  });
}

function validateDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.operations)) {
    throw new Error('Control operation ledger is invalid.');
  }
  if (value.lease !== null && (!value.lease || !OPERATION_ID.test(value.lease.operationId) || typeof value.lease.acquiredAt !== 'string')) {
    throw new Error('Control operation ledger lease is invalid.');
  }
  for (const operation of value.operations) {
    if (!operation || !OPERATION_ID.test(operation.id) || typeof operation.kind !== 'string' || typeof operation.action !== 'string' || typeof operation.planId !== 'string') {
      throw new Error('Control operation ledger entry is invalid.');
    }
    requireOperationContext(operation.context);
  }
  return value;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function atomicWrite(filePath, document) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'w', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(document)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireMutationLock(filePath) {
  const lockPath = `${filePath}.lock`;
  await mkdir(dirname(filePath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      const metadata = { schemaVersion: 1, nonce: randomUUID(), pid: process.pid, createdAt: new Date().toISOString() };
      await handle.writeFile(`${JSON.stringify(metadata)}\n`, 'utf8');
      await handle.sync();
      return { lockPath, handle };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const details = await stat(lockPath);
        // Never remove a lock after a separate stat() check. A new owner may
        // acquire the same pathname between those calls, which would turn a
        // stale-lock cleanup into deletion of another transaction's lock.
        // A stale local lock therefore fails closed and requires explicit
        // operator recovery; normal process exit releases its file handle.
        if (Date.now() - details.mtimeMs > STALE_LOCK_MS) {
          throw new Error('Control operation ledger has a stale local lock and requires manual recovery.');
        }
      } catch (lockError) {
        if (lockError?.code !== 'ENOENT') throw lockError;
      }
      await wait(LOCK_RETRY_MS);
    }
  }
  throw new Error('Control operation ledger is busy. Retry after the current local transaction completes.');
}

/**
 * Durable local-only control ledger. It records no commands, paths, tokens or
 * raw remote output. A recovered in-flight operation always blocks new work
 * until a human explicitly resolves it in a future adapter-specific flow.
 */
export function createOperationLedger({ filePath, now = () => new Date() } = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('Operation ledger path is required.');
  // Keep ordering local to this ledger file. Different profiles/test ledgers must
  // not serialize each other merely because they run in the same Node process.
  let mutationQueue = Promise.resolve();

  async function read() {
    if (!await fileExists(filePath)) return emptyDocument();
    return validateDocument(JSON.parse(await readFile(filePath, 'utf8')));
  }

  async function write(document) {
    validateDocument(document);
    await atomicWrite(filePath, document);
  }

  function mutate(change) {
    const queued = mutationQueue.then(async () => {
      const lock = await acquireMutationLock(filePath);
      try {
        const document = await read();
        const result = await change(document);
        await write(document);
        return result;
      } finally {
        await lock.handle.close();
        await rm(lock.lockPath, { force: true });
      }
    });
    mutationQueue = queued.catch(() => {});
    return queued;
  }

  async function recover() {
    return mutate(async (document) => {
      if (!document.lease) return Object.freeze({ recovered: null, hasRecoveryBlock: document.operations.some((item) => item.status === 'manual-required') });
      const operation = document.operations.find((item) => item.id === document.lease.operationId);
      if (!operation) throw new Error('Control operation ledger lease refers to a missing operation.');
      operation.status = 'manual-required';
      operation.phase = 'recovery-required';
      operation.updatedAt = nowIso(now);
      operation.recoveryRequiredAt = operation.updatedAt;
      document.lease = null;
      return Object.freeze({ recovered: publicOperation(operation), hasRecoveryBlock: true });
    });
  }

  async function start({ id, kind, action, planId, context } = {}) {
    const operationId = safeText(id, 'id', OPERATION_ID);
    return mutate(async (document) => {
      if (document.lease || document.operations.some((item) => item.status === 'manual-required')) throw new Error('A prior control operation requires recovery before new work can start.');
      if (document.operations.some((item) => item.id === operationId)) throw new Error('Control operation already exists.');
      const timestamp = nowIso(now);
      const operation = { id: operationId, kind: safeText(kind, 'kind'), action: safeText(action, 'action'), planId: safeText(planId, 'planId', OPERATION_ID), context: requireOperationContext(context), status: 'running', phase: 'queued', createdAt: timestamp, updatedAt: timestamp, completedAt: null };
      document.operations.push(operation);
      if (document.operations.length > MAX_OPERATIONS) document.operations.splice(0, document.operations.length - MAX_OPERATIONS);
      document.lease = { operationId, acquiredAt: timestamp };
      return publicOperation(operation);
    });
  }

  async function transition(id, { status, phase, completed = false } = {}) {
    const operationId = safeText(id, 'id', OPERATION_ID);
    return mutate(async (document) => {
      const operation = document.operations.find((item) => item.id === operationId);
      if (!operation) throw new Error('Control operation was not found.');
      if (operation.status === 'manual-required') throw new Error('Recovered control operation requires manual resolution.');
      operation.status = safeText(status, 'status');
      operation.phase = safeText(phase, 'phase');
      operation.updatedAt = nowIso(now);
      if (completed) { operation.completedAt = operation.updatedAt; if (document.lease?.operationId === operationId) document.lease = null; }
      return publicOperation(operation);
    });
  }

  async function get(operationId) {
    const document = await read();
    const operation = document.operations.find((item) => item.id === safeText(operationId, 'id', OPERATION_ID));
    if (!operation) throw new Error('Control operation was not found.');
    return publicOperation(operation);
  }

  async function resolveManual(operationId, expectedKind) {
    const safeId = safeText(operationId, 'id', OPERATION_ID);
    const safeKind = safeText(expectedKind, 'expectedKind');
    return mutate(async (document) => {
      const operation = document.operations.find((item) => item.id === safeId);
      if (!operation || operation.status !== 'manual-required') throw new Error('No recovered control operation requires manual resolution.');
      if (operation.kind !== safeKind) throw new Error('Recovered control operation kind does not match this recovery flow.');
      operation.status = 'resolved-manually';
      operation.phase = 'manual-resolution-recorded';
      operation.updatedAt = nowIso(now);
      operation.completedAt = operation.updatedAt;
      return publicOperation(operation);
    });
  }

  async function listManualRequired(kind) {
    const safeKind = safeText(kind, 'kind');
    const document = await read();
    return Object.freeze(document.operations.filter((item) => item.kind === safeKind && item.status === 'manual-required').map(publicOperation));
  }

  async function hasBlockingOperation() {
    const document = await read();
    return document.lease !== null || document.operations.some((item) => item.status === 'manual-required');
  }

  return Object.freeze({ recover, start, transition, get, resolveManual, listManualRequired, hasBlockingOperation });
}
