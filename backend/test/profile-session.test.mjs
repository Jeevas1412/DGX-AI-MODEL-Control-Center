import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActiveProfileSessionManager } from '../src/profile-session.mjs';
import { createConnectionProfileStore } from '../src/connection-profile.mjs';

const evidence = Object.freeze({ targetMachineSha256: `sha256:${'a'.repeat(64)}`, capabilitySnapshotSha256: `sha256:${'b'.repeat(64)}` });

test('remote session factory is never called without an explicitly verified active profile', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-profile-session-'));
  try {
    const store = createConnectionProfileStore({ filePath: join(directory, 'profiles.json') });
    let calls = 0;
    const manager = createActiveProfileSessionManager({ profileStore: store, createSession: async () => ({}) });
    await assert.rejects(manager.getSession(), /No verified active/);
    assert.equal(calls, 0);
    const profile = { id: 'profile-1', displayName: 'Lab', transport: 'openssh-alias', sshAlias: 'lab-dgx', hostKeyFingerprint: null, verification: { status: 'unverified', verifiedAt: null }, createdAt: '2026-07-20T10:00:00.000Z', updatedAt: '2026-07-20T10:00:00.000Z' };
    await store.upsert(profile);
    await assert.rejects(manager.getSession(), /No verified active/);
    assert.equal(calls, 0);
    await store.markVerified(profile.id, evidence, new Date('2026-07-20T10:01:00.000Z'));
    await store.activate(profile.id);
    const activeManager = createActiveProfileSessionManager({ profileStore: store, createSession: async (selected) => { calls += 1; return { alias: selected.sshAlias }; } });
    assert.deepEqual(await activeManager.getSession(), { alias: 'lab-dgx' });
    assert.deepEqual(await activeManager.getSession(), { alias: 'lab-dgx' });
    assert.equal(calls, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
