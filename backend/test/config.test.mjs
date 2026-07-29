import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../src/config.mjs';

test('configuration defaults to loopback port 8501', () => {
  assert.deepEqual(readConfig({}), {
    host: '127.0.0.1',
    port: 8501,
    dgxReadOnlyEnabled: false,
    dgxSshTarget: '',
    dgxSnapshotCacheMs: 2500,
    corsOrigins: ['http://127.0.0.1:8501'],
    apiToken: '',
    localControlEnabled: false,
  });
});

test('configuration validates the listening port', () => {
  assert.throws(() => readConfig({ CONTROL_CENTER_PORT: '0' }), /between 1 and 65535/);
  assert.throws(() => readConfig({ CONTROL_CENTER_PORT: 'not-a-port' }), /between 1 and 65535/);
  assert.deepEqual(readConfig({
    CONTROL_CENTER_HOST: '0.0.0.0',
    CONTROL_CENTER_PORT: '9500',
    DGX_READ_ONLY_ENABLED: 'true',
    DGX_SSH_TARGET: 'dgx-prod',
    DGX_SNAPSHOT_CACHE_MS: '5000',
    CONTROL_CENTER_CORS_ORIGINS: 'http://127.0.0.1:8511,http://[::1]:5173',
    CONTROL_CENTER_API_TOKEN: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN_0123456789',
    DGX_LOCAL_CONTROL_ENABLED: 'true',
  }), {
    host: '0.0.0.0',
    port: 9500,
    dgxReadOnlyEnabled: true,
    dgxSshTarget: 'dgx-prod',
    dgxSnapshotCacheMs: 5000,
    corsOrigins: ['http://127.0.0.1:8511', 'http://[::1]:5173'],
    apiToken: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN_0123456789',
    localControlEnabled: true,
  });
  assert.throws(() => readConfig({ DGX_SSH_TARGET: 'gdx; reboot' }), /SSH config alias/);
  assert.throws(() => readConfig({ DGX_SNAPSHOT_CACHE_MS: '100' }), /between 500 and 30000/);
  assert.throws(() => readConfig({ CONTROL_CENTER_CORS_ORIGINS: 'https://example.com' }), /private or loopback HTTP origin/);
  assert.throws(() => readConfig({ CONTROL_CENTER_CORS_ORIGINS: 'http://127.0.0.1:8501/path' }), /private or loopback HTTP origin/);
  assert.throws(() => readConfig({ CONTROL_CENTER_HOST: '0.0.0.0' }), /API_TOKEN is required/);
  assert.throws(() => readConfig({ CONTROL_CENTER_API_TOKEN: 'short' }), /32-byte-or-stronger/);
});
