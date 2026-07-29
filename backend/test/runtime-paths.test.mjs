import assert from 'node:assert/strict';
import test from 'node:test';
import { access, copyFile, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRuntimePaths, migrateConnectionProfile, migrateLegacyRuntimeData } from '../src/runtime-paths.mjs';

test('runtime paths are rooted only in the supplied user data directory', () => {
  const paths = createRuntimePaths({ baseDirectory: 'C:/Users/example/AppData/Local', appDirectory: 'DGX AI Control Center' });
  assert.equal(paths.root, 'C:\\Users\\example\\AppData\\Local\\DGX AI Control Center');
  assert.match(paths.connectionProfiles, /DGX AI Control Center\\connection-profiles\.json$/);
  assert.match(paths.benchmarkHistory, /DGX AI Control Center\\history\\benchmark-history\.jsonl$/);
  assert.match(paths.operationLedger, /DGX AI Control Center\\control-operation-ledger\.json$/);
});

test('legacy migration copies only missing files, retains sources, and records no absolute source paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-runtime-paths-'));
  try {
    const legacy = join(directory, 'legacy-data');
    const paths = createRuntimePaths({ baseDirectory: join(directory, 'user-data'), appDirectory: '' });
    await (await import('node:fs/promises')).mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, 'benchmark-history.jsonl'), '{"id":"legacy"}\n', 'utf8');
    const first = await migrateLegacyRuntimeData({ runtimePaths: paths, legacyDirectory: legacy });
    assert.equal(first.outcomes.find((item) => item.file === 'benchmark-history.jsonl').status, 'copied');
    assert.equal(await readFile(paths.benchmarkHistory, 'utf8'), '{"id":"legacy"}\n');
    assert.equal(await readFile(join(paths.migrationBackupDirectory, 'benchmark-history.jsonl'), 'utf8'), '{"id":"legacy"}\n');
    assert.equal(await readFile(join(legacy, 'benchmark-history.jsonl'), 'utf8'), '{"id":"legacy"}\n');
    const manifestBeforeRepeat = await readFile(paths.migrationManifest, 'utf8');
    const second = await migrateLegacyRuntimeData({ runtimePaths: paths, legacyDirectory: legacy });
    assert.equal(second.outcomes[0].status, 'already-completed');
    const manifest = await readFile(paths.migrationManifest, 'utf8');
    assert.equal(manifest, manifestBeforeRepeat);
    assert.doesNotMatch(manifest, /legacy-data|user-data/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('connection profile migration copies once without overwriting or recording source paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-profile-migration-'));
  try {
    const source = join(directory, 'legacy', 'connection-profiles.json');
    const paths = createRuntimePaths({ baseDirectory: join(directory, 'desktop-data'), appDirectory: '' });
    await (await import('node:fs/promises')).mkdir(dirname(source), { recursive: true });
    await writeFile(source, '{"profiles":[],"activeProfileId":null}\n', 'utf8');
    const first = await migrateConnectionProfile({ runtimePaths: paths, sourcePath: source });
    assert.equal(first.status, 'copied');
    assert.equal(await readFile(paths.connectionProfiles, 'utf8'), '{"profiles":[],"activeProfileId":null}\n');
    assert.equal(await readFile(join(paths.migrationBackupDirectory, 'connection-profiles.json'), 'utf8'), '{"profiles":[],"activeProfileId":null}\n');
    assert.equal(await readFile(source, 'utf8'), '{"profiles":[],"activeProfileId":null}\n');
    const manifest = await readFile(paths.connectionProfileMigrationManifest, 'utf8');
    assert.doesNotMatch(manifest, /legacy|desktop-data/);
    assert.equal((await migrateConnectionProfile({ runtimePaths: paths, sourcePath: source })).status, 'already-completed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('legacy migration removes only newly copied destinations if a later copy fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-runtime-rollback-'));
  try {
    const legacy = join(directory, 'legacy-data');
    const paths = createRuntimePaths({ baseDirectory: join(directory, 'user-data'), appDirectory: '' });
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, 'benchmark-history.jsonl'), '{"id":"first"}\n', 'utf8');
    await writeFile(join(legacy, 'local-service-control-audit.jsonl'), '{"id":"second"}\n', 'utf8');
    const failingFs = {
      access,
      copyFile: async (source, destination, flags) => {
        if (destination === paths.localServiceControlAudit) {
          const error = new Error('simulated copy failure');
          error.code = 'EIO';
          throw error;
        }
        return copyFile(source, destination, flags);
      },
      mkdir,
      rename,
      rm,
      writeFile,
    };
    await assert.rejects(migrateLegacyRuntimeData({ runtimePaths: paths, legacyDirectory: legacy, fs: failingFs }), /simulated copy failure/);
    await assert.rejects(access(paths.benchmarkHistory));
    assert.equal(await readFile(join(legacy, 'benchmark-history.jsonl'), 'utf8'), '{"id":"first"}\n');
    await assert.rejects(access(paths.migrationManifest));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
