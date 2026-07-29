import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectionProfileStore, newOpenSshAliasProfile, validateConnectionProfile } from '../src/connection-profile.mjs';

const timestamp = '2026-07-20T08:00:00.000Z';
const evidence = Object.freeze({ targetMachineSha256: `sha256:${'a'.repeat(64)}`, capabilitySnapshotSha256: `sha256:${'b'.repeat(64)}` });

function profile(overrides = {}) {
  return {
    id: 'dgx-home',
    displayName: 'Home DGX',
    transport: 'openssh-alias',
    sshAlias: 'dgx-home',
    hostKeyFingerprint: 'SHA256:AbcdEFghijKLMNopQRstuv0123456789_-=',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

test('connection profiles accept only a named OpenSSH alias and optional fingerprint', () => {
  assert.deepEqual(validateConnectionProfile(profile()), { ...profile(), verification: { status: 'unverified', verifiedAt: null, evidence: null } });
  assert.equal(validateConnectionProfile(profile({ hostKeyFingerprint: null })).hostKeyFingerprint, null);
  assert.throws(() => validateConnectionProfile(profile({ password: 'not-allowed' })), /Unsupported connection profile field/);
  assert.throws(() => validateConnectionProfile(profile({ privateKeyPath: 'C:\\key' })), /Unsupported connection profile field/);
  assert.throws(() => validateConnectionProfile(profile({ sshAlias: 'dgx; reboot' })), /Invalid connection profile sshAlias/);
});

test('new profiles create opaque IDs and a single timestamped alias definition', () => {
  const created = newOpenSshAliasProfile({ displayName: 'Lab DGX', sshAlias: 'lab-dgx' }, new Date(timestamp));
  assert.match(created.id, /^[a-z0-9-]{36}$/);
  assert.equal(created.sshAlias, 'lab-dgx');
  assert.equal(created.hostKeyFingerprint, null);
  assert.equal(created.createdAt, timestamp);
});

test('connection profile store starts empty and atomically persists validated profiles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-profile-test-'));
  const filePath = join(directory, 'profiles.json');
  try {
    const store = createConnectionProfileStore({ filePath });
    assert.deepEqual(await store.load(), { schemaVersion: 3, activeProfileId: null, profiles: [] });
    const saved = await store.upsert(profile());
    assert.equal(saved.profiles.length, 1);
    assert.deepEqual((await store.load()).profiles, [{ ...profile(), verification: { status: 'unverified', verifiedAt: null, evidence: null } }]);
    assert.match(await readFile(filePath, 'utf8'), /"transport": "openssh-alias"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('legacy profiles migrate in memory as inactive and unverified, and only verified profiles can activate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-profile-test-'));
  const filePath = join(directory, 'profiles.json');
  try {
    await (await import('node:fs/promises')).writeFile(filePath, JSON.stringify({ schemaVersion: 1, profiles: [profile()] }), 'utf8');
    const store = createConnectionProfileStore({ filePath });
    assert.deepEqual(await store.load(), {
      schemaVersion: 3,
      activeProfileId: null,
      profiles: [{ ...profile(), verification: { status: 'unverified', verifiedAt: null, evidence: null } }],
    });
    await assert.rejects(store.activate('dgx-home'), /must be verified/);
    const marked = await store.markVerified('dgx-home', evidence, new Date('2026-07-20T10:00:00.000Z'));
    assert.equal(marked.profiles[0].verification.status, 'verified');
    assert.equal(marked.profiles[0].verification.verifiedAt, '2026-07-20T10:00:00.000Z');
    assert.equal((await store.activate('dgx-home')).activeProfileId, 'dgx-home');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('version 2 verified profiles fail closed until target and capability evidence is freshly recorded', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-profile-test-'));
  const filePath = join(directory, 'profiles.json');
  try {
    await (await import('node:fs/promises')).writeFile(filePath, JSON.stringify({
      schemaVersion: 2,
      activeProfileId: 'dgx-home',
      profiles: [{ ...profile(), verification: { status: 'verified', verifiedAt: timestamp } }],
    }), 'utf8');
    const store = createConnectionProfileStore({ filePath });
    const migrated = await store.load();
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.activeProfileId, null);
    assert.deepEqual(migrated.profiles[0].verification, { status: 'unverified', verifiedAt: null, evidence: null });
    await assert.rejects(store.activate('dgx-home'), /must be verified/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('connection profile store preserves created time while allowing an update', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-profile-test-'));
  try {
    const store = createConnectionProfileStore({ filePath: join(directory, 'profiles.json') });
    await store.upsert(profile());
    const saved = await store.upsert(profile({ displayName: 'Renamed DGX', createdAt: '2026-07-20T09:00:00.000Z', updatedAt: '2026-07-20T10:00:00.000Z' }));
    assert.equal(saved.profiles[0].displayName, 'Renamed DGX');
    assert.equal(saved.profiles[0].createdAt, timestamp);
    assert.equal(saved.profiles[0].updatedAt, '2026-07-20T10:00:00.000Z');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('connection profile activation is blocked while the operation guard reports active or recoverable work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-profile-test-'));
  try {
    const store = createConnectionProfileStore({
      filePath: join(directory, 'profiles.json'),
      canActivate: async () => false,
    });
    await store.upsert(profile());
    await store.markVerified('dgx-home', evidence, new Date('2026-07-20T10:00:00.000Z'));
    await assert.rejects(store.activate('dgx-home'), /cannot change while a control operation is running or requires recovery/);
    assert.equal((await store.load()).activeProfileId, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
