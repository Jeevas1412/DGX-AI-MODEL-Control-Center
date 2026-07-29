import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRuntimeChannel, resolveUserDataDirectory } from './environment.mjs';

test('runtime channel defaults to development in source and production in packaged builds', () => {
  assert.equal(resolveRuntimeChannel({ environment: {}, packaged: false }), 'development');
  assert.equal(resolveRuntimeChannel({ environment: {}, packaged: true }), 'production');
  assert.equal(resolveRuntimeChannel({ environment: { DGX_CONTROL_CENTER_CHANNEL: 'test' }, packaged: true }), 'test');
  assert.throws(() => resolveRuntimeChannel({ environment: { DGX_CONTROL_CENTER_CHANNEL: 'preview' } }), /DGX_CONTROL_CENTER_CHANNEL/);
});

test('each environment receives a physically distinct user-data directory', () => {
  const appDataDirectory = 'C:\\Users\\example\\AppData\\Roaming';
  assert.notEqual(
    resolveUserDataDirectory({ appDataDirectory, channel: 'development' }),
    resolveUserDataDirectory({ appDataDirectory, channel: 'production' }),
  );
  assert.match(resolveUserDataDirectory({ appDataDirectory, channel: 'production' }), /DGX AI Control Center-production$/);
});
