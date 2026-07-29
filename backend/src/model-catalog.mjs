import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_ENTRIES = 50;
const SOURCES = new Set(['dgx-local']);

function text(value, field, pattern, maximum) {
  if (typeof value !== 'string' || !pattern.test(value) || value.length > maximum) throw new Error(`Invalid model catalog ${field}.`);
  return value;
}
function timestamp(value) { return text(value, 'timestamp', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 24); }
function safeSource(value) { if (!SOURCES.has(value)) throw new Error('Unsupported model source.'); return value; }
function safeModelId(value) { return text(value, 'modelId', /^mdl-[a-f0-9]{32}$/, 36); }
function safeTargetMachineSha256(value) { return text(value, 'targetMachineSha256', /^sha256:[a-f0-9]{64}$/, 71); }

function validateEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['id', 'source', 'modelId', 'displayName', 'addedAt', 'targetMachineSha256'].includes(key))) throw new Error('Invalid model catalog entry.');
  return Object.freeze({
    id: text(value.id, 'id', /^[a-f0-9-]{36}$/, 36),
    source: safeSource(value.source),
    modelId: safeModelId(value.modelId),
    displayName: text(value.displayName, 'displayName', /^[^\r\n]{1,96}$/, 96).trim(),
    addedAt: timestamp(value.addedAt),
    targetMachineSha256: safeTargetMachineSha256(value.targetMachineSha256),
  });
}

function validateDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 3 || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) throw new Error('Model catalog is invalid.');
  const entries = value.entries.map(validateEntry);
  if (new Set(entries.map((item) => `${item.source}:${item.modelId}`)).size !== entries.length) throw new Error('Model catalog contains duplicate entries.');
  return Object.freeze({ schemaVersion: 3, entries: Object.freeze(entries) });
}
function initialDocument() { return Object.freeze({ schemaVersion: 3, entries: Object.freeze([]) }); }

export function createModelCatalog({ filePath, now = () => new Date() } = {}) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('Model catalog filePath is required.');
  async function load() {
    try {
      const raw = JSON.parse(await readFile(filePath, 'utf8'));
      // Legacy local trial registers are not portable model catalogs.
      // Preserve their files for audit, then start the generic catalog empty
      // rather than displaying or inventing a product model identity.
      if (raw?.schemaVersion === 1 || raw?.schemaVersion === 2) {
        await rename(filePath, `${filePath}.legacy-v1-${randomUUID()}`);
        return initialDocument();
      }
      return validateDocument(raw);
    }
    catch (error) { if (error?.code === 'ENOENT') return initialDocument(); throw error; }
  }
  async function save(document) {
    const safe = validateDocument(document);
    await mkdir(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify(safe, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); await rename(temporary, filePath); }
    finally { await rm(temporary, { force: true }); }
    return safe;
  }
  function add({ source, modelId, displayName, targetMachineSha256 } = {}) {
    const run = mutation.then(async () => {
      const current = await load();
      const safeSourceValue = safeSource(source);
      const safeModelIdValue = safeModelId(modelId);
      const safeTarget = safeTargetMachineSha256(targetMachineSha256);
      const existing = current.entries.find((entry) => entry.source === safeSourceValue && entry.modelId === safeModelIdValue && entry.targetMachineSha256 === safeTarget);
      if (existing) return existing;
      const entry = validateEntry({ id: randomUUID(), source: safeSourceValue, modelId: safeModelIdValue, displayName, addedAt: now().toISOString(), targetMachineSha256: safeTarget });
      await save({ schemaVersion: 3, entries: [...current.entries, entry] });
      return entry;
    });
    mutation = run.catch(() => {});
    return run;
  }
  async function loadForTarget(targetMachineSha256) {
    const target = safeTargetMachineSha256(targetMachineSha256);
    const document = await load();
    return Object.freeze({ schemaVersion: document.schemaVersion, entries: Object.freeze(document.entries.filter((entry) => entry.targetMachineSha256 === target)) });
  }
  return Object.freeze({ load, loadForTarget, add });
}
  let mutation = Promise.resolve();
