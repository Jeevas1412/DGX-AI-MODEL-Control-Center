import assert from 'node:assert/strict';
import test from 'node:test';
import { createLegacyCurrentDgxServiceAdapter } from '../src/legacy-adapters/current-dgx-service-adapter.mjs';
import { createVerifiedOperationContextProvider, digestOperationSnapshot } from '../src/verified-operation-context.mjs';

const adapter = createLegacyCurrentDgxServiceAdapter();
const plan = Object.freeze({ serviceId: 'image', action: 'warmup' });
const digest = digestOperationSnapshot({ services: [{ id: 'image', status: 'running' }] });
const evidence = Object.freeze({ targetMachineSha256: `sha256:${'a'.repeat(64)}`, capabilitySnapshotSha256: `sha256:${'b'.repeat(64)}` });

test('verified operation context binds an active verified profile, registered capability, integrity and snapshot digest', async () => {
  const profile = { id: 'profile-verified', hostKeyFingerprint: 'SHA256:abcd_1234', verification: { status: 'verified', verifiedAt: '2026-07-20T10:00:00.000Z', evidence } };
  const provider = createVerifiedOperationContextProvider({ profileStore: { load: async () => ({ activeProfileId: profile.id, profiles: [profile] }) }, profileVerifier: async () => ({ connection: 'reachable', verificationEvidence: evidence }), now: () => new Date('2026-07-21T00:00:00.000Z') });
  assert.deepEqual(await provider({ plan, adapter: adapter.manifest, planSnapshotDigest: digest }), {
    profileId: profile.id,
    profileFingerprint: profile.hostKeyFingerprint,
    ...evidence,
    adapterId: adapter.manifest.id,
    adapterVersion: adapter.manifest.version,
    adapterIntegrity: adapter.manifest.integrity,
    planSnapshotDigest: digest,
  });
});

test('verified operation context rejects an unverified profile and a plan outside registered adapter capability', async () => {
  const provider = createVerifiedOperationContextProvider({ profileStore: { load: async () => ({ activeProfileId: 'profile-unverified', profiles: [{ id: 'profile-unverified', hostKeyFingerprint: null, verification: { status: 'unverified', verifiedAt: null, evidence: null } }] }) }, profileVerifier: async () => ({ connection: 'unreachable' }) });
  await assert.rejects(provider({ plan, adapter: adapter.manifest, planSnapshotDigest: digest }), /No verified active/);
  const verifiedProvider = createVerifiedOperationContextProvider({ profileStore: { load: async () => ({ activeProfileId: 'profile-verified', profiles: [{ id: 'profile-verified', hostKeyFingerprint: null, verification: { status: 'verified', verifiedAt: '2026-07-20T10:00:00.000Z', evidence } }] }) }, profileVerifier: async () => ({ connection: 'reachable', verificationEvidence: evidence }) });
  await assert.rejects(verifiedProvider({ plan: { serviceId: 'unknown', action: 'warmup' }, adapter: adapter.manifest, planSnapshotDigest: digest }), /does not cover/);
});

test('verified operation context rejects expired verification evidence for control without affecting monitoring', async () => {
  const profile = { id: 'profile-verified', hostKeyFingerprint: null, verification: { status: 'verified', verifiedAt: '2026-07-01T00:00:00.000Z', evidence } };
  const provider = createVerifiedOperationContextProvider({ profileStore: { load: async () => ({ activeProfileId: profile.id, profiles: [profile] }) }, profileVerifier: async () => ({ connection: 'reachable', verificationEvidence: evidence }), now: () => new Date('2026-07-21T00:00:00.000Z') });
  await assert.rejects(provider({ plan, adapter: adapter.manifest, planSnapshotDigest: digest }), /verification is expired/);
});

test('verification failures expose a stable re-verification code for the desktop client', async () => {
  const profile = { id: 'profile-verified', hostKeyFingerprint: null, verification: { status: 'verified', verifiedAt: '2026-07-01T00:00:00.000Z', evidence } };
  const provider = createVerifiedOperationContextProvider({ profileStore: { load: async () => ({ activeProfileId: profile.id, profiles: [profile] }) }, profileVerifier: async () => ({ connection: 'reachable', verificationEvidence: evidence }), now: () => new Date('2026-07-21T00:00:00.000Z') });
  await assert.rejects(
    provider({ plan, adapter: adapter.manifest, planSnapshotDigest: digest }),
    (error) => error?.code === 'PROFILE_REVERIFY_REQUIRED' && /verification is expired/.test(error.message),
  );
});

test('verified operation context refuses a target or capability identity change at confirmation time', async () => {
  const profile = { id: 'profile-verified', hostKeyFingerprint: null, verification: { status: 'verified', verifiedAt: '2026-07-20T10:00:00.000Z', evidence } };
  const provider = createVerifiedOperationContextProvider({
    profileStore: { load: async () => ({ activeProfileId: profile.id, profiles: [profile] }) },
    profileVerifier: async () => ({ connection: 'reachable', verificationEvidence: { ...evidence, targetMachineSha256: `sha256:${'c'.repeat(64)}` } }),
    now: () => new Date('2026-07-21T00:00:00.000Z'),
  });
  await assert.rejects(provider({ plan, adapter: adapter.manifest, planSnapshotDigest: digest }), /identity or capability evidence changed/);
});
