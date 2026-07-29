import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopPreferenceStore, DEFAULT_DESKTOP_PREFERENCES, validateDesktopPreferences } from './preferences.mjs';

test('desktop preferences only accept Chinese, English, appearance, background-residency and explicit remote session booleans', () => {
  assert.deepEqual(validateDesktopPreferences({ language: 'en-US', theme: 'light', keepRunningWhenWindowClosed: true, remoteReadOnlySessionEnabled: true, remoteControlSessionEnabled: true }), {
    language: 'en-US', theme: 'light', keepRunningWhenWindowClosed: true, remoteReadOnlySessionEnabled: true, remoteControlSessionEnabled: true,
  });
  assert.throws(() => validateDesktopPreferences({ language: 'ja-JP' }), /language/);
  assert.throws(() => validateDesktopPreferences({ theme: 'system' }), /theme/);
  assert.throws(() => validateDesktopPreferences({ shell: 'cmd.exe' }), /Unsupported/);
});

test('desktop preferences default safely and persist atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-desktop-preferences-'));
  const store = createDesktopPreferenceStore({ filePath: join(directory, 'preferences.json') });
  assert.deepEqual(await store.load(), DEFAULT_DESKTOP_PREFERENCES);
  assert.deepEqual(await store.update({ language: 'en-US', keepRunningWhenWindowClosed: true, remoteReadOnlySessionEnabled: true, remoteControlSessionEnabled: true }), {
    language: 'en-US', theme: 'dark', keepRunningWhenWindowClosed: true, remoteReadOnlySessionEnabled: true, remoteControlSessionEnabled: true,
  });
  assert.deepEqual(await store.load(), { language: 'en-US', theme: 'dark', keepRunningWhenWindowClosed: true, remoteReadOnlySessionEnabled: true, remoteControlSessionEnabled: true });
});
