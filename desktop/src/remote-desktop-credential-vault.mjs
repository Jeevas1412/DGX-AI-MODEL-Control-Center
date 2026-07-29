import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 1;
const USERNAME_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%+=_-';

function randomFrom(alphabet, length) {
  const bytes = randomBytes(length);
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join('');
}

function ensureProfileId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new Error('A valid connection profile id is required.');
  return value;
}

function ensureSafeStorage(safeStorage) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || typeof safeStorage.encryptString !== 'function' || typeof safeStorage.decryptString !== 'function' || !safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows protected credential storage is unavailable.');
  }
  return safeStorage;
}

function validateDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.items)) throw new Error('Remote desktop credential vault is invalid.');
  for (const item of value.items) {
    if (!item || typeof item !== 'object' || !/^[a-f0-9-]{36}$/.test(item.id) || !/^[a-f0-9-]{36}$/.test(item.profileId) || !/^dgxrdp-[a-z2-9]{10}$/.test(item.username) || typeof item.passwordProtected !== 'string' || !item.passwordProtected || typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string') {
      throw new Error('Remote desktop credential vault item is invalid.');
    }
  }
  return value;
}

function emptyDocument() { return { schemaVersion: SCHEMA_VERSION, items: [] }; }

async function atomicWrite(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Main-process-only credential storage. It never receives Linux or sudo
 * credentials. Password plaintext is decrypted only by an explicit caller,
 * and no public status method includes a password or protected blob.
 */
export function createRemoteDesktopCredentialVault({ filePath, safeStorage, now = () => new Date() } = {}) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('Remote desktop credential vault path is required.');
  const protector = ensureSafeStorage(safeStorage);

  async function load() {
    try { return validateDocument(JSON.parse(await readFile(filePath, 'utf8'))); }
    catch (error) { if (error?.code === 'ENOENT') return emptyDocument(); throw error; }
  }

  function publicRecord(item) {
    return Object.freeze({ id: item.id, profileId: item.profileId, username: item.username, createdAt: item.createdAt, updatedAt: item.updatedAt });
  }

  async function create(profileId) {
    const boundProfileId = ensureProfileId(profileId);
    const document = await load();
    if (document.items.some((item) => item.profileId === boundProfileId)) throw new Error('Remote desktop credentials already exist for this connection profile.');
    const timestamp = now().toISOString();
    const item = {
      id: randomUUID(), profileId: boundProfileId,
      username: `dgxrdp-${randomFrom(USERNAME_ALPHABET, 10)}`,
      passwordProtected: protector.encryptString(randomFrom(PASSWORD_ALPHABET, 24)).toString('base64'),
      createdAt: timestamp, updatedAt: timestamp,
    };
    document.items.push(item);
    await atomicWrite(filePath, document);
    return publicRecord(item);
  }

  async function get(profileId) {
    const item = (await load()).items.find((candidate) => candidate.profileId === ensureProfileId(profileId));
    return item ? publicRecord(item) : null;
  }

  async function reveal(profileId) {
    const item = (await load()).items.find((candidate) => candidate.profileId === ensureProfileId(profileId));
    if (!item) throw new Error('Remote desktop credentials were not found.');
    return Object.freeze({ ...publicRecord(item), password: protector.decryptString(Buffer.from(item.passwordProtected, 'base64')) });
  }

  async function remove(profileId) {
    const boundProfileId = ensureProfileId(profileId);
    const document = await load();
    const index = document.items.findIndex((item) => item.profileId === boundProfileId);
    if (index < 0) return false;
    document.items.splice(index, 1);
    await atomicWrite(filePath, document);
    return true;
  }

  return Object.freeze({ create, get, reveal, remove });
}
