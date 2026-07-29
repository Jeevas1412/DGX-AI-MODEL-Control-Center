import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const DEFAULT_DESKTOP_PREFERENCES = Object.freeze({
  language: 'zh-CN',
  theme: 'dark',
  keepRunningWhenWindowClosed: false,
  remoteReadOnlySessionEnabled: false,
  remoteControlSessionEnabled: false,
});

const ALLOWED_KEYS = new Set(Object.keys(DEFAULT_DESKTOP_PREFERENCES));

function text(value, field, values) {
  if (typeof value !== 'string' || !values.has(value)) throw new Error(`Invalid desktop preference ${field}.`);
  return value;
}

function boolean(value, field) {
  if (typeof value !== 'boolean') throw new Error(`Invalid desktop preference ${field}.`);
  return value;
}

export function validateDesktopPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Desktop preferences must be an object.');
  if (Object.keys(value).some((key) => !ALLOWED_KEYS.has(key))) throw new Error('Unsupported desktop preference field.');
  return Object.freeze({
    language: text(value.language ?? DEFAULT_DESKTOP_PREFERENCES.language, 'language', new Set(['zh-CN', 'en-US'])),
    theme: text(value.theme ?? DEFAULT_DESKTOP_PREFERENCES.theme, 'theme', new Set(['dark', 'light'])),
    keepRunningWhenWindowClosed: boolean(value.keepRunningWhenWindowClosed ?? DEFAULT_DESKTOP_PREFERENCES.keepRunningWhenWindowClosed, 'keepRunningWhenWindowClosed'),
    remoteReadOnlySessionEnabled: boolean(value.remoteReadOnlySessionEnabled ?? DEFAULT_DESKTOP_PREFERENCES.remoteReadOnlySessionEnabled, 'remoteReadOnlySessionEnabled'),
    remoteControlSessionEnabled: boolean(value.remoteControlSessionEnabled ?? DEFAULT_DESKTOP_PREFERENCES.remoteControlSessionEnabled, 'remoteControlSessionEnabled'),
  });
}

export function createDesktopPreferenceStore({ filePath }) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('Desktop preference filePath is required.');

  async function load() {
    try {
      return validateDesktopPreferences(JSON.parse(await readFile(filePath, 'utf8')));
    } catch (error) {
      if (error?.code === 'ENOENT') return DEFAULT_DESKTOP_PREFERENCES;
      throw error;
    }
  }

  async function save(value) {
    const safe = validateDesktopPreferences(value);
    await mkdir(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(safe, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, filePath);
    } finally {
      await rm(temporary, { force: true });
    }
    return safe;
  }

  async function update(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some((key) => !ALLOWED_KEYS.has(key))) {
      throw new Error('Unsupported desktop preference update.');
    }
    return save({ ...(await load()), ...patch });
  }

  return Object.freeze({ load, save, update });
}
