import { readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

function incompatibleLedgerError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /^(Invalid operation |Control operation ledger (is invalid|entry is invalid|lease is invalid)|Unexpected token)/.test(message);
}

function quarantinePath(filePath, now) {
  const suffix = now().toISOString().replace(/[:.]/g, '-');
  return `${filePath}.incompatible-${suffix}`;
}

const TERMINAL_LEGACY_STATUSES = new Set(['succeeded', 'failed', 'completed', 'resolved-manually']);

function migrationBlockDocument(now) {
  const timestamp = now().toISOString();
  return {
    schemaVersion: 1,
    lease: null,
    operations: [{
      id: randomUUID(), kind: 'ledger-migration', action: 'manual-review', planId: randomUUID(),
      context: {
        profileId: 'migration-block', profileFingerprint: null,
        targetMachineSha256: `sha256:${'0'.repeat(64)}`,
        capabilitySnapshotSha256: `sha256:${'0'.repeat(64)}`,
        adapterId: 'ledger-migration', adapterVersion: '1.0.0',
        adapterIntegrity: '0'.repeat(64), planSnapshotDigest: '0'.repeat(64),
      },
      status: 'manual-required', phase: 'migration-review-required',
      createdAt: timestamp, updatedAt: timestamp, completedAt: null, recoveryRequiredAt: timestamp,
    }],
  };
}

function requiresMigrationBlock(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.operations)) return true;
  if (raw.lease !== null && raw.lease !== undefined) return true;
  return raw.operations.some((operation) => !operation || !TERMINAL_LEGACY_STATUSES.has(operation.status));
}

/**
 * Older desktop builds wrote an operation ledger before the immutable target
 * and capability fingerprints existed. That ledger cannot safely authorize a
 * new action, but it must not prevent the monitoring UI from opening. Preserve
 * it beside the new ledger, then start with an empty, fail-closed ledger.
 */
export async function recoverCompatibleOperationLedger({ createLedger, filePath, now = () => new Date(), move = rename, read = readFile, write = writeFile, report = console.error } = {}) {
  if (typeof createLedger !== 'function' || typeof filePath !== 'string' || !filePath) throw new Error('Ledger recovery dependencies are required.');
  const ledger = createLedger({ filePath });
  try {
    return Object.freeze({ ledger, recovery: await ledger.recover(), quarantinedPath: null });
  } catch (error) {
    if (!incompatibleLedgerError(error)) throw error;
    let migrationRequired = true;
    try { migrationRequired = requiresMigrationBlock(JSON.parse(await read(filePath, 'utf8'))); } catch { migrationRequired = true; }
    const archivedPath = quarantinePath(filePath, now);
    try {
      await move(filePath, archivedPath);
    } catch (moveError) {
      throw new Error(`Incompatible control operation ledger could not be preserved: ${moveError instanceof Error ? moveError.message : String(moveError)}`);
    }
    if (migrationRequired) {
      await write(filePath, `${JSON.stringify(migrationBlockDocument(now), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      report(`Quarantined incompatible control operation ledger at ${archivedPath}; manual migration review is required before control can resume.`);
    } else {
      report(`Quarantined terminal-only incompatible control operation ledger at ${archivedPath}.`);
    }
    const freshLedger = createLedger({ filePath });
    return Object.freeze({ ledger: freshLedger, recovery: await freshLedger.recover(), quarantinedPath: archivedPath });
  }
}
