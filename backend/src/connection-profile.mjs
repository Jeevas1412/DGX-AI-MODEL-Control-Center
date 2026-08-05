import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 4;
const MAX_PROFILES = 8;
const PROFILE_KEYS = new Set(['id', 'displayName', 'transport', 'sshAlias', 'hostKeyFingerprint', 'verification', 'createdAt', 'updatedAt']);

function text(value, field, pattern, maxLength) {
  if (typeof value !== 'string' || !pattern.test(value) || value.length > maxLength) {
    throw new Error(`Invalid connection profile ${field}.`);
  }
  return value;
}

function timestamp(value, field) {
  return text(value, field, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 24);
}

function optionalFingerprint(value) {
  if (value === null || value === undefined || value === '') return null;
  return text(value, 'hostKeyFingerprint', /^SHA256:[A-Za-z0-9+/=_-]+$/, 128);
}

function verificationEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => key !== 'targetMachineSha256' && key !== 'capabilitySnapshotSha256')) {
    throw new Error('Invalid connection profile verification evidence.');
  }
  return Object.freeze({
    targetMachineSha256: text(value.targetMachineSha256, 'verification.evidence.targetMachineSha256', /^sha256:[a-f0-9]{64}$/, 71),
    capabilitySnapshotSha256: text(value.capabilitySnapshotSha256, 'verification.evidence.capabilitySnapshotSha256', /^sha256:[a-f0-9]{64}$/, 71),
  });
}

function verification(value) {
  if (value === undefined) return Object.freeze({ status: 'unverified', verifiedAt: null, evidence: null });
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => key !== 'status' && key !== 'verifiedAt' && key !== 'evidence')) {
    throw new Error('Invalid connection profile verification.');
  }
  if (value.status === 'unverified' && (value.verifiedAt === null || value.verifiedAt === undefined)) {
    if (value.evidence !== null && value.evidence !== undefined) throw new Error('Invalid connection profile verification.');
    return Object.freeze({ status: 'unverified', verifiedAt: null, evidence: null });
  }
  if (value.status === 'verified') {
    return Object.freeze({ status: 'verified', verifiedAt: timestamp(value.verifiedAt, 'verification.verifiedAt'), evidence: verificationEvidence(value.evidence) });
  }
  throw new Error('Invalid connection profile verification.');
}

function assertOnlyProfileKeys(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Invalid connection profile.');
  for (const key of Object.keys(profile)) {
    if (!PROFILE_KEYS.has(key)) throw new Error(`Unsupported connection profile field: ${key}.`);
  }
}

export function validateConnectionProfile(profile) {
  assertOnlyProfileKeys(profile);
  if (profile.transport !== 'openssh-alias') throw new Error('Unsupported connection profile transport.');
  return Object.freeze({
    id: text(profile.id, 'id', /^[a-z0-9][a-z0-9-]{0,63}$/, 64),
    displayName: text(profile.displayName, 'displayName', /^[^\r\n]{1,64}$/, 64).trim(),
    transport: 'openssh-alias',
    sshAlias: text(profile.sshAlias, 'sshAlias', /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 64),
    hostKeyFingerprint: optionalFingerprint(profile.hostKeyFingerprint),
    verification: verification(profile.verification),
    createdAt: timestamp(profile.createdAt, 'createdAt'),
    updatedAt: timestamp(profile.updatedAt, 'updatedAt'),
  });
}

/**
 * The read-only monitor scope. `monitoredProfileIds` (schema 4) is a
 * separate axis from `activeProfileId`: the active profile remains the
 * single operation/detail target (single-node write semantics are
 * preserved), while the monitor list defines which verified profiles the
 * read-only /api/nodes aggregation covers. An empty list means "all
 * verified profiles". Only profile ids that exist in the store are valid.
 */
function monitoredProfileIds(value, profiles) {
  const candidate = value === undefined || value === null ? [] : value;
  if (!Array.isArray(candidate) || candidate.length > profiles.length || new Set(candidate).size !== candidate.length) {
    throw new Error('Connection profile monitoredProfileIds is invalid.');
  }
  for (const id of candidate) {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || !profiles.some((profile) => profile.id === id)) {
      throw new Error('Connection profile monitoredProfileIds is invalid.');
    }
  }
  return Object.freeze([...candidate]);
}

function validateDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.profiles) || value.profiles.length > MAX_PROFILES) {
    throw new Error('Connection profile store is invalid.');
  }
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('Connection profile store is invalid.');
  }
  // Schema 3 and 4 share the same profile shape and the same verification
  // evidence (targetMachineSha256 + capabilitySnapshotSha256). The schema-4
  // document only adds the read-only monitor scope, so schema-3 evidence is
  // preserved and only the new field defaults to "all verified profiles".
  // Schema 1-2 carried only a timestamp and cannot prove the target and
  // capability set are still in use, so they migrate fail-closed and require
  // an explicit fresh, read-only verification.
  const preservesVerification = value.schemaVersion === SCHEMA_VERSION || value.schemaVersion === 3;
  const profiles = value.profiles.map((profile) => validateConnectionProfile(
    preservesVerification ? profile : { ...profile, verification: { status: 'unverified', verifiedAt: null, evidence: null } },
  ));
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error('Connection profile IDs must be unique.');

  // Version 1 had no activation or verification state. Loading it is a safe
  // in-memory migration: historical profiles never gain remote authority.
  const activeProfileId = preservesVerification ? value.activeProfileId : null;
  if (activeProfileId !== null && (typeof activeProfileId !== 'string' || !profiles.some((profile) => profile.id === activeProfileId))) {
    throw new Error('Connection profile activeProfileId is invalid.');
  }
  const activeProfile = activeProfileId === null ? null : profiles.find((profile) => profile.id === activeProfileId);
  if (activeProfile && activeProfile.verification.status !== 'verified') {
    throw new Error('Active connection profile must be verified.');
  }
  // Schema 1-3 documents carry no monitor scope; they migrate to "all
  // verified profiles". Schema 4 must contain a valid list.
  const monitored = value.schemaVersion === SCHEMA_VERSION ? monitoredProfileIds(value.monitoredProfileIds, profiles) : [];  return Object.freeze({ schemaVersion: SCHEMA_VERSION, activeProfileId, monitoredProfileIds: monitored, profiles });
}

function initialDocument() {
  return Object.freeze({ schemaVersion: SCHEMA_VERSION, activeProfileId: null, monitoredProfileIds: [], profiles: [] });
}

export function newOpenSshAliasProfile({ displayName, sshAlias, hostKeyFingerprint = null }, now = new Date()) {
  const nowValue = now.toISOString();
  return validateConnectionProfile({
    id: randomUUID(),
    displayName,
    transport: 'openssh-alias',
    sshAlias,
    hostKeyFingerprint,
    verification: { status: 'unverified', verifiedAt: null, evidence: null },
    createdAt: nowValue,
    updatedAt: nowValue,
  });
}

export function createConnectionProfileStore({ filePath, canActivate = async () => true }) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('Connection profile store filePath is required.');
  if (typeof canActivate !== 'function') throw new Error('Connection profile store canActivate must be a function.');

  async function load() {
    try {
      return validateDocument(JSON.parse(await readFile(filePath, 'utf8')));
    } catch (error) {
      if (error?.code === 'ENOENT') return initialDocument();
      throw error;
    }
  }

  async function save(document) {
    const safe = validateDocument(document);
    await mkdir(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(safe, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return safe;
  }

  async function upsert(profile) {
    const safe = validateConnectionProfile(profile);
    const current = await load();
    const existing = current.profiles.find((item) => item.id === safe.id);
    const nextProfile = existing
      ? validateConnectionProfile({ ...safe, verification: existing.verification, createdAt: existing.createdAt })
      : safe;
    const profiles = existing
      ? current.profiles.map((item) => item.id === nextProfile.id ? nextProfile : item)
      : [...current.profiles, nextProfile];
    return save({ schemaVersion: SCHEMA_VERSION, activeProfileId: current.activeProfileId, monitoredProfileIds: current.monitoredProfileIds, profiles });
  }

  async function markVerified(id, evidence, now = new Date()) {
    const profileId = text(id, 'id', /^[a-z0-9][a-z0-9-]{0,63}$/, 64);
    const current = await load();
    const existing = current.profiles.find((item) => item.id === profileId);
    if (!existing) throw new Error('Connection profile was not found.');
    const verifiedAt = now.toISOString();
    const updated = validateConnectionProfile({ ...existing, verification: { status: 'verified', verifiedAt, evidence: verificationEvidence(evidence) }, updatedAt: verifiedAt });
    return save({ schemaVersion: SCHEMA_VERSION, activeProfileId: current.activeProfileId, monitoredProfileIds: current.monitoredProfileIds, profiles: current.profiles.map((item) => item.id === profileId ? updated : item) });
  }

  async function activate(id) {
    const profileId = text(id, 'id', /^[a-z0-9][a-z0-9-]{0,63}$/, 64);
    const current = await load();
    const profile = current.profiles.find((item) => item.id === profileId);
    if (!profile) throw new Error('Connection profile was not found.');
    if (profile.verification.status !== 'verified') throw new Error('Connection profile must be verified before activation.');
    if (!await canActivate({ current, nextProfileId: profileId })) {
      throw new Error('Connection profile cannot change while a control operation is running or requires recovery.');
    }
    return save({ schemaVersion: SCHEMA_VERSION, activeProfileId: profileId, monitoredProfileIds: current.monitoredProfileIds, profiles: current.profiles });
  }

  return Object.freeze({ load, save, upsert, markVerified, activate });
}
