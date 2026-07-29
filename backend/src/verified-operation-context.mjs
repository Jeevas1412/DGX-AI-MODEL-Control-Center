import { createHash } from 'node:crypto';

const DIGEST = /^[a-f0-9]{64}$/;
const SHA256_EVIDENCE = /^sha256:[a-f0-9]{64}$/;
const MAX_VERIFICATION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Keep the user-facing reason machine-readable without exposing SSH details.
// The desktop client can use this code to offer the fixed re-verification
// flow, while the human-readable message remains stable for existing clients.
function verificationError(message) {
  const error = new Error(message);
  error.code = 'PROFILE_REVERIFY_REQUIRED';
  return error;
}

export function requireFreshVerifiedProfile(profile, now = () => new Date()) {
  if (!profile || profile.verification?.status !== 'verified' || typeof profile.verification.verifiedAt !== 'string') {
    throw verificationError('No verified active connection profile is selected.');
  }
  const verifiedAt = Date.parse(profile.verification.verifiedAt);
  const current = now().getTime();
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(current) || verifiedAt > current + 5 * 60 * 1000 || current - verifiedAt > MAX_VERIFICATION_AGE_MS) {
    throw verificationError('Active connection verification is expired. Re-run fixed read-only verification before control.');
  }
  return profile;
}

function requireVerificationEvidence(profile) {
  const evidence = profile?.verification?.evidence;
  if (!evidence || !SHA256_EVIDENCE.test(evidence.targetMachineSha256 ?? '') || !SHA256_EVIDENCE.test(evidence.capabilitySnapshotSha256 ?? '')) {
    throw verificationError('Active connection identity evidence is unavailable. Re-run fixed read-only verification before control.');
  }
  return Object.freeze({
    targetMachineSha256: evidence.targetMachineSha256,
    capabilitySnapshotSha256: evidence.capabilitySnapshotSha256,
  });
}

function canonical(value, seen = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, seen)).join(',')}]`;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || seen.has(value)) {
    throw new Error('Operation context value must be finite, JSON-compatible data.');
  }
  seen.add(value);
  const output = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key], seen)}`).join(',')}}`;
  seen.delete(value);
  return output;
}

export function digestOperationSnapshot(value) {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function requireAdapterManifest(adapter) {
  const manifest = adapter?.manifest;
  if (!manifest || typeof manifest !== 'object' || !/^[a-z0-9][a-z0-9-]{0,95}$/.test(manifest.id) || !/^\d+\.\d+\.\d+$/.test(manifest.version) || !DIGEST.test(manifest.integrity) || !Array.isArray(manifest.services) || !Array.isArray(manifest.actions)) {
    throw new Error('Registered adapter manifest is invalid.');
  }
  return manifest;
}

/**
 * Builds the durable operation context from the real local profile store and
 * the currently registered adapter manifest. It never opens an SSH session.
 */
export function createVerifiedOperationContextProvider({ profileStore, profileVerifier, now = () => new Date() } = {}) {
  if (!profileStore || typeof profileStore.load !== 'function') throw new Error('Verified operation context requires a profile store.');
  if (typeof profileVerifier !== 'function') throw new Error('Verified operation context requires a fixed profile verifier.');

  return async function verifiedOperationContext({ plan, adapter, planSnapshotDigest } = {}) {
    const manifest = requireAdapterManifest({ manifest: adapter });
    if (!plan || typeof plan !== 'object' || !DIGEST.test(planSnapshotDigest)) throw new Error('Verified operation context requires a planned snapshot digest.');
    if (!manifest.services.includes(plan.serviceId) || !manifest.actions.includes(plan.action)) {
      throw new Error('Registered adapter capability does not cover this control plan.');
    }
    const document = await profileStore.load();
    const profile = document?.profiles?.find((item) => item.id === document.activeProfileId);
    requireFreshVerifiedProfile(profile, now);
    const evidence = requireVerificationEvidence(profile);
    const reverified = await profileVerifier(profile);
    const currentEvidence = reverified?.verificationEvidence;
    if (reverified?.connection !== 'reachable'
      || currentEvidence?.targetMachineSha256 !== evidence.targetMachineSha256
      || currentEvidence?.capabilitySnapshotSha256 !== evidence.capabilitySnapshotSha256) {
      throw verificationError('Active connection identity or capability evidence changed. Re-run fixed read-only verification before control.');
    }
    return Object.freeze({
      profileId: profile.id,
      profileFingerprint: profile.hostKeyFingerprint ?? null,
      ...evidence,
      adapterId: manifest.id,
      adapterVersion: manifest.version,
      adapterIntegrity: manifest.integrity,
      planSnapshotDigest,
    });
  };
}
