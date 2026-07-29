import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createKnownHostFingerprintLookup, fingerprintFromPublicKeyBlob, fingerprintsFromKnownHosts } from '../src/ssh-host-key.mjs';

const keyBlob = Buffer.from('fixture SSH public key blob').toString('base64');
const expectedFingerprint = `SHA256:${createHash('sha256').update(Buffer.from(keyBlob, 'base64')).digest('base64').replace(/=+$/, '')}`;

test('derives OpenSSH SHA256 fingerprints from known_hosts public key blobs', () => {
  assert.equal(fingerprintFromPublicKeyBlob(keyBlob), expectedFingerprint);
  assert.deepEqual(fingerprintsFromKnownHosts(`# Host lab-dgx\nlab-dgx ssh-ed25519 ${keyBlob}\n`), [expectedFingerprint]);
});

test('known-host lookup uses a resolved alias and local known_hosts only', async () => {
  const calls = [];
  const lookup = createKnownHostFingerprintLookup({
    execute: async (request) => {
      calls.push(request);
      if (request.program === 'ssh') return 'hostname lab-dgx\nport 22\nuserknownhostsfile C:/Users/example/.ssh/known_hosts\n';
      if (request.program === 'ssh-keygen') return `lab-dgx ssh-ed25519 ${keyBlob}\n`;
      throw new Error('unexpected utility');
    },
  });
  assert.deepEqual(await lookup('lab-dgx'), [expectedFingerprint]);
  assert.deepEqual(calls, [
    { program: 'ssh', args: ['-G', 'lab-dgx'] },
    { program: 'ssh-keygen', args: ['-F', 'lab-dgx', '-f', 'C:/Users/example/.ssh/known_hosts'] },
  ]);
});

test('known-host lookup refuses absent keys and preserves multiple trusted algorithms', async () => {
  const missing = createKnownHostFingerprintLookup({
    execute: async (request) => request.program === 'ssh'
      ? 'hostname lab-dgx\nport 22\nuserknownhostsfile C:/Users/example/.ssh/known_hosts\n'
      : '',
  });
  await assert.rejects(missing('lab-dgx'), /No trusted SSH host key/);

  const otherKey = Buffer.from('another fixture SSH public key blob').toString('base64');
  const ambiguous = createKnownHostFingerprintLookup({
    execute: async (request) => request.program === 'ssh'
      ? 'hostname lab-dgx\nport 22\nuserknownhostsfile C:/Users/example/.ssh/known_hosts\n'
      : `lab-dgx ssh-ed25519 ${keyBlob}\nlab-dgx ecdsa-sha2-nistp256 ${otherKey}\n`,
  });
  assert.deepEqual(await ambiguous('lab-dgx'), [expectedFingerprint, fingerprintFromPublicKeyBlob(otherKey)]);
});
