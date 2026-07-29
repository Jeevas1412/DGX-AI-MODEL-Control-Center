import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('NSIS installer creates the standard desktop shortcut without custom-page hooks that break silent or update installs', async () => {
  const packageConfig = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const include = await readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8');
  assert.equal(packageConfig.build.nsis.oneClick, false);
  assert.equal(packageConfig.build.nsis.createDesktopShortcut, true);
  assert.equal(packageConfig.build.nsis.include, 'build/installer.nsh');
  assert.doesNotMatch(include, /Page custom|CreateDesktopShortcutPage|nsDialogs\.nsh/);
  assert.match(include, /desktop shortcut by default/);
});

test('packaged Windows builds declare an Electron fuses hook for every currently supported fuse', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const hook = await readFile(new URL('../scripts/after-pack-fuses.mjs', import.meta.url), 'utf8');
  assert.equal(packageJson.build.afterPack, 'scripts/after-pack-fuses.mjs');
  assert.match(hook, /OnlyLoadAppFromAsar\]: true/);
  assert.match(hook, /EnableNodeOptionsEnvironmentVariable\]: false/);
  const backendMapping = packageJson.build.files.find((item) => item?.from === '../backend/src');
  assert.equal(backendMapping?.to, 'backend/src');
  assert.deepEqual(packageJson.build.extraResources, [
    { from: '../scripts/recover-operation-ledger-lock.ps1', to: 'tools/recover-operation-ledger-lock.ps1' },
  ]);
});
