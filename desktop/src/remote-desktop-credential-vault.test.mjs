import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteDesktopCredentialVault } from './remote-desktop-credential-vault.mjs';

const profileId = '123e4567-e89b-12d3-a456-426614174000';
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, 'utf8'),
  decryptString: (value) => value.toString('utf8').replace(/^protected:/, ''),
};

test('remote desktop credential vault stores only protected passwords and exposes public metadata separately', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-rdp-vault-'));
  try {
    const filePath = join(directory, 'rdp-vault.json');
    const vault = createRemoteDesktopCredentialVault({ filePath, safeStorage, now: () => new Date('2026-07-27T10:00:00.000Z') });
    const created = await vault.create(profileId);
    assert.match(created.username, /^dgxrdp-[a-z2-9]{10}$/);
    assert.equal('password' in created, false);
    assert.equal((await vault.get(profileId))?.id, created.id);
    const revealed = await vault.reveal(profileId);
    assert.equal(revealed.username, created.username);
    assert.equal(revealed.password.length, 24);
    const persisted = await readFile(filePath, 'utf8');
    assert.doesNotMatch(persisted, new RegExp(revealed.password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(persisted, /passwordProtected/);
    assert.equal(await vault.remove(profileId), true);
    assert.equal(await vault.get(profileId), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('remote desktop credential vault fails closed when protected storage is unavailable', () => {
  assert.throws(() => createRemoteDesktopCredentialVault({ filePath: 'vault.json', safeStorage: { isEncryptionAvailable: () => false } }), /protected credential storage/);
});
