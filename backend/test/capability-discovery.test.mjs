import assert from 'node:assert/strict';
import test from 'node:test';
import { createCapabilityDiscovery, unavailableCapabilities } from '../src/capability-discovery.mjs';

test('capability discovery exposes only target identity and general monitoring', async () => {
  let input = null;
  const discover = createCapabilityDiscovery({
    sshTarget: 'dgx-home',
    now: () => new Date('2026-07-28T08:00:00.000Z'),
    execute: async (value) => { input = value; return JSON.stringify({ monitoring: true, machineIdentitySha256: `sha256:${'a'.repeat(64)}` }); },
  });
  const discovered = await discover();
  assert.deepEqual(discovered.capabilities, { monitoring: 'available' });
  assert.equal(discovered.verificationEvidence.targetMachineSha256, `sha256:${'a'.repeat(64)}`);
  assert.match(discovered.verificationEvidence.capabilitySnapshotSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(input.sshTarget, 'dgx-home');
  assert.match(input.script, /target-support-profile\.json/);
  assert.doesNotMatch(input.script, /127\.0\.0\.1|809[0-9]|docker|systemctl|start|stop|restart/i);
});

test('unavailable capabilities remain target-neutral', () => {
  assert.deepEqual(unavailableCapabilities('2026-07-28T08:00:00.000Z'), {
    schemaVersion: 1,
    checkedAt: '2026-07-28T08:00:00.000Z',
    connection: 'not-configured',
    capabilities: { monitoring: 'unknown' },
  });
});
