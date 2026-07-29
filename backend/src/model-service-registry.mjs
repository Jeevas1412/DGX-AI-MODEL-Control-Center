import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { findModelServiceTemplate } from './model-service-templates.mjs';

const target = (value) => {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error('Invalid managed service target.');
  return value;
};
const text = (value, label, pattern, max) => {
  if (typeof value !== 'string' || !pattern.test(value) || value.length > max) throw new Error(`Invalid managed service ${label}.`);
  return value.trim();
};
const initial = () => Object.freeze({ schemaVersion: 2, entries: Object.freeze([]) });

export function createModelServiceRegistry({ filePath, now = () => new Date() } = {}) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('Managed service registry filePath is required.');
  let queue = Promise.resolve();
  async function load() {
    try {
      const doc = JSON.parse(await readFile(filePath, 'utf8'));
      if (!doc || ![1, 2].includes(doc.schemaVersion) || !Array.isArray(doc.entries) || doc.entries.length > 50) throw new Error('Managed service registry is invalid.');
      const entries = doc.entries.map((entry) => Object.freeze({
        id: text(entry.id, 'id', /^[a-f0-9-]{36}$/, 36),
        catalogEntryId: text(entry.catalogEntryId, 'catalogEntryId', /^[a-f0-9-]{36}$/, 36),
        targetMachineSha256: target(entry.targetMachineSha256),
        templateId: text(entry.templateId, 'templateId', /^[a-z0-9-]{3,64}$/, 64),
        displayName: text(entry.displayName, 'displayName', /^[^\r\n]{1,96}$/, 96),
        status: entry.status === 'draft' || entry.status === 'registered' ? entry.status : (() => { throw new Error('Managed service status is invalid.'); })(),
        createdAt: text(entry.createdAt, 'createdAt', /^\d{4}-\d{2}-\d{2}T/, 24),
        updatedAt: text(entry.updatedAt, 'updatedAt', /^\d{4}-\d{2}-\d{2}T/, 24),
        ...(entry.status === 'registered' ? {
          adapterId: text(entry.adapterId, 'adapterId', /^[a-z0-9-]{3,64}$/, 64),
          adapterVersion: text(entry.adapterVersion, 'adapterVersion', /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/, 64),
          adapterIntegritySha256: target(entry.adapterIntegritySha256),
          registeredAt: text(entry.registeredAt, 'registeredAt', /^\d{4}-\d{2}-\d{2}T/, 24),
          remoteRegistrationId: text(entry.remoteRegistrationId, 'remoteRegistrationId', /^[a-f0-9-]{36}$/, 36),
        } : {}),
      }));
      return Object.freeze({ schemaVersion: 2, entries: Object.freeze(entries) });
    } catch (error) { if (error?.code === 'ENOENT') return initial(); throw error; }
  }
  async function save(doc) {
    await mkdir(dirname(filePath), { recursive: true });
    const temp = `${filePath}.${randomUUID()}.tmp`;
    try { await writeFile(temp, `${JSON.stringify(doc, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); await rename(temp, filePath); } finally { await rm(temp, { force: true }); }
  }
  function addDraft({ catalogEntryId, targetMachineSha256, templateId, displayName }) {
    const run = queue.then(async () => {
      const template = findModelServiceTemplate(templateId);
      if (!template) throw new Error('Unsupported service template.');
      const current = await load(); const safeTarget = target(targetMachineSha256);
      const existing = current.entries.find((entry) => entry.catalogEntryId === catalogEntryId && entry.targetMachineSha256 === safeTarget);
      // A catalog item has one managed-service record per verified DGX.  It
      // may however need a different product template before registration.
      // Keep an already registered binding immutable, but let a local draft be
      // corrected through the guided onboarding flow instead of forcing users
      // to edit files or create duplicate configurations.
      if (existing?.status === 'registered') return existing;
      if (existing) {
        const nextDisplayName = text(displayName, 'displayName', /^[^\r\n]{1,96}$/, 96);
        if (existing.templateId === template.id && existing.displayName === nextDisplayName) return existing;
        const updated = Object.freeze({ ...existing, templateId: template.id, displayName: nextDisplayName, updatedAt: now().toISOString() });
        await save({ schemaVersion: 2, entries: current.entries.map((entry) => entry.id === existing.id ? updated : entry) });
        return updated;
      }
      const timestamp = now().toISOString();
      const entry = Object.freeze({ id: randomUUID(), catalogEntryId: text(catalogEntryId, 'catalogEntryId', /^[a-f0-9-]{36}$/, 36), targetMachineSha256: safeTarget, templateId: template.id, displayName: text(displayName, 'displayName', /^[^\r\n]{1,96}$/, 96), status: 'draft', createdAt: timestamp, updatedAt: timestamp });
      await save({ schemaVersion: 2, entries: [...current.entries, entry] }); return entry;
    }); queue = run.catch(() => {}); return run;
  }
  function markRegistered({ id, adapterId, adapterVersion, adapterIntegritySha256, remoteRegistrationId }) {
    const run = queue.then(async () => {
      const current = await load(); const timestamp = now().toISOString();
      const found = current.entries.find((entry) => entry.id === id);
      if (!found) throw new Error('Managed service configuration was not found.');
      if (found.status === 'registered') return found;
      const registered = Object.freeze({ ...found, status: 'registered', adapterId: text(adapterId, 'adapterId', /^[a-z0-9-]{3,64}$/, 64), adapterVersion: text(adapterVersion, 'adapterVersion', /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/, 64), adapterIntegritySha256: target(adapterIntegritySha256), remoteRegistrationId: text(remoteRegistrationId, 'remoteRegistrationId', /^[a-f0-9-]{36}$/, 36), registeredAt: timestamp, updatedAt: timestamp });
      await save({ schemaVersion: 2, entries: current.entries.map((entry) => entry.id === id ? registered : entry) });
      return registered;
    }); queue = run.catch(() => {}); return run;
  }
  /** Refresh local bindings after a same-version fixed adapter digest correction. */
  function rebindRegisteredAdapter({ targetMachineSha256, adapterId, adapterVersion, adapterIntegritySha256 }) {
    const run = queue.then(async () => {
      const current = await load();
      const safeTarget = target(targetMachineSha256);
      const safeAdapterId = text(adapterId, 'adapterId', /^[a-z0-9-]{3,64}$/, 64);
      const safeVersion = text(adapterVersion, 'adapterVersion', /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/, 64);
      const safeIntegrity = target(adapterIntegritySha256);
      const timestamp = now().toISOString();
      const rebound = current.entries.filter((entry) => entry.status === 'registered'
        && entry.targetMachineSha256 === safeTarget
        && entry.adapterId === safeAdapterId
        && entry.adapterVersion === safeVersion)
        .map((entry) => Object.freeze({ ...entry, adapterIntegritySha256: safeIntegrity, updatedAt: timestamp }));
      if (!rebound.length) return Object.freeze([]);
      const byId = new Map(rebound.map((entry) => [entry.id, entry]));
      await save({ schemaVersion: 2, entries: current.entries.map((entry) => byId.get(entry.id) ?? entry) });
      return Object.freeze(rebound);
    });
    queue = run.catch(() => {}); return run;
  }
  async function loadForTarget(targetMachineSha256) { const safe = target(targetMachineSha256); const doc = await load(); return Object.freeze({ schemaVersion: 2, entries: Object.freeze(doc.entries.filter((entry) => entry.targetMachineSha256 === safe)) }); }
  return Object.freeze({ load, loadForTarget, addDraft, markRegistered, rebindRegisteredAdapter });
}
