import { access, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const APP_DIRECTORY = 'DGX AI Control Center';
const LEGACY_FILES = Object.freeze([
  ['benchmark-history.jsonl', ['history', 'benchmark-history.jsonl']],
  ['local-service-control-audit.jsonl', ['audit', 'local-service-control-audit.jsonl']],
  ['change-audit.jsonl', ['audit', 'change-audit.jsonl']],
  ['control-operation-ledger.json', ['control-operation-ledger.json']],
]);

function nonEmptyPath(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return resolve(value);
}

/** Central, user-writable runtime location. Source and install directories are never targets. */
export function createRuntimePaths({ baseDirectory = process.env.LOCALAPPDATA, appDirectory = APP_DIRECTORY } = {}) {
  const base = nonEmptyPath(baseDirectory, 'Runtime base directory');
  if (typeof appDirectory !== 'string') throw new Error('Runtime application directory is invalid.');
  const root = appDirectory ? join(base, appDirectory) : base;
  return Object.freeze({
    root,
    connectionProfiles: join(root, 'connection-profiles.json'),
    modelCatalog: join(root, 'model-catalog.json'),
    modelServiceRegistry: join(root, 'model-service-registry.json'),
    benchmarkHistory: join(root, 'history', 'benchmark-history.jsonl'),
    hardwareHistory: join(root, 'history', 'hardware-history.jsonl'),
    localServiceControlAudit: join(root, 'audit', 'local-service-control-audit.jsonl'),
    changeAudit: join(root, 'audit', 'change-audit.jsonl'),
    operationLedger: join(root, 'control-operation-ledger.json'),
    migrationBackupDirectory: join(root, 'migration-backups', 'v2'),
    migrationManifest: join(root, 'migration-v2.json'),
    connectionProfileMigrationManifest: join(root, 'connection-profile-migration-v1.json'),
  });
}

const defaultFs = { access, copyFile, mkdir, rename, rm, writeFile };

async function exists(filePath, fs) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function copyIfMissing(source, destination, fs) {
  await fs.mkdir(dirname(destination), { recursive: true });
  try {
    await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
    return 'copied';
  } catch (error) {
    if (error?.code === 'EEXIST') return 'already-exists';
    throw error;
  }
}

async function writeManifestAtomically(filePath, value, fs) {
  await fs.mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function rollbackNewFiles(filePaths, fs) {
  await Promise.all([...filePaths].reverse().map(async (filePath) => {
    await fs.rm(filePath, { force: true });
  }));
}

/**
 * Copies known legacy runtime files once. It never overwrites a destination,
 * never removes the source, and records only filenames/outcomes in its manifest.
 */
export async function migrateLegacyRuntimeData({ runtimePaths, legacyDirectory, fs = defaultFs } = {}) {
  if (!runtimePaths?.root || !runtimePaths?.migrationManifest) throw new Error('Runtime paths are required.');
  const legacyRoot = nonEmptyPath(legacyDirectory, 'Legacy runtime directory');
  if (await exists(runtimePaths.migrationManifest, fs)) {
    return Object.freeze({ root: runtimePaths.root, outcomes: Object.freeze([Object.freeze({ file: 'migration-v2.json', status: 'already-completed' })]) });
  }
  const outcomes = [];
  const createdDestinations = [];
  try {
    for (const [legacyName, destinationParts] of LEGACY_FILES) {
      const source = join(legacyRoot, legacyName);
      const destination = join(runtimePaths.root, ...destinationParts);
      if (await exists(destination, fs)) {
        outcomes.push(Object.freeze({ file: legacyName, status: 'destination-exists' }));
        continue;
      }
      if (!await exists(source, fs)) {
        outcomes.push(Object.freeze({ file: legacyName, status: 'legacy-missing' }));
        continue;
      }
      const backupStatus = await copyIfMissing(source, join(runtimePaths.migrationBackupDirectory, legacyName), fs);
      const status = await copyIfMissing(source, destination, fs);
      if (status === 'copied') createdDestinations.push(destination);
      outcomes.push(Object.freeze({ file: legacyName, status: status === 'copied' ? 'copied' : 'destination-exists', backup: backupStatus }));
    }
    await writeManifestAtomically(runtimePaths.migrationManifest, { schemaVersion: 3, completedAt: new Date().toISOString(), outcomes }, fs);
  } catch (error) {
    await rollbackNewFiles(createdDestinations, fs);
    throw error;
  }
  return Object.freeze({ root: runtimePaths.root, outcomes: Object.freeze(outcomes) });
}

/**
 * Imports an existing alias-only connection profile into the desktop runtime
 * once. It is intentionally separate from historic audit migration because a
 * profile can be created after the audit migration already completed.
 */
export async function migrateConnectionProfile({ runtimePaths, sourcePath, fs = defaultFs } = {}) {
  if (!runtimePaths?.root || !runtimePaths?.connectionProfiles || !runtimePaths?.connectionProfileMigrationManifest) throw new Error('Runtime paths are required.');
  const source = nonEmptyPath(sourcePath, 'Connection profile migration source');
  const destination = runtimePaths.connectionProfiles;
  if (source === destination) return Object.freeze({ status: 'same-path' });
  if (await exists(runtimePaths.connectionProfileMigrationManifest, fs)) return Object.freeze({ status: 'already-completed' });
  let status = 'source-missing';
  let backup = 'not-needed';
  let destinationCreated = false;
  try {
    if (await exists(destination, fs)) {
      status = 'destination-exists';
    } else if (await exists(source, fs)) {
      backup = await copyIfMissing(source, join(runtimePaths.migrationBackupDirectory, 'connection-profiles.json'), fs);
      const copied = await copyIfMissing(source, destination, fs);
      destinationCreated = copied === 'copied';
      status = destinationCreated ? 'copied' : 'destination-exists';
    }
    await writeManifestAtomically(runtimePaths.connectionProfileMigrationManifest, { schemaVersion: 2, completedAt: new Date().toISOString(), outcome: status, backup }, fs);
  } catch (error) {
    if (destinationCreated) await rollbackNewFiles([destination], fs);
    throw error;
  }
  return Object.freeze({ status });
}
