import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopApiBridge, createDesktopDirectAdapter, validateDesktopApiRequest } from './api-bridge.mjs';

test('desktop bridge accepts only registered local API routes and methods', () => {
  assert.deepEqual(validateDesktopApiRequest({ method: 'GET', path: '/api/services' }), { method: 'GET', path: '/api/services' });
  assert.deepEqual(validateDesktopApiRequest({ method: 'GET', path: '/api/model-catalog/search?q=Qwen3' }), { method: 'GET', path: '/api/model-catalog/search?q=Qwen3' });
  assert.deepEqual(validateDesktopApiRequest({ method: 'POST', path: '/api/setup/profiles/123e4567-e89b-12d3-a456-426614174000/verify', body: {} }), { method: 'POST', path: '/api/setup/profiles/123e4567-e89b-12d3-a456-426614174000/verify', body: {} });
  assert.throws(() => validateDesktopApiRequest({ method: 'GET', path: 'https://example.invalid/api/services' }), /Unsupported/);
  assert.throws(() => validateDesktopApiRequest({ method: 'POST', path: '/api/anything', body: { command: 'whoami' } }), /allowlisted/);
  assert.throws(() => validateDesktopApiRequest({ method: 'GET', path: '/api/logs?service=nvfp4&lines=999' }), /allowlisted/);
});

test('desktop bridge validates every write body before it reaches the local backend', () => {
  const profile = validateDesktopApiRequest({ method: 'POST', path: '/api/setup/profiles', body: { displayName: '  DGX test  ', sshAlias: 'dgx-test', hostKeyFingerprint: 'SHA256:abc_123' } });
  assert.deepEqual(profile.body, { displayName: 'DGX test', sshAlias: 'dgx-test', hostKeyFingerprint: 'SHA256:abc_123' });
  assert.deepEqual(validateDesktopApiRequest({ method: 'POST', path: '/api/local-control/plans', body: { serviceId: 'vlm', action: 'warmup' } }).body, { serviceId: 'vlm', action: 'warmup' });
  assert.deepEqual(validateDesktopApiRequest({ method: 'POST', path: '/api/managed-services/123e4567-e89b-12d3-a456-426614174000/plans', body: { action: 'restart' } }).body, { action: 'restart' });
  assert.deepEqual(validateDesktopApiRequest({ method: 'POST', path: '/api/models/nvfp4/parameter-review', body: { proposed: { maxNumSeqs: 4 } } }).body, { proposed: { maxNumSeqs: 4 } });
  assert.deepEqual(validateDesktopApiRequest({ method: 'POST', path: '/api/models/nvfp4/parameter-adapter/deployment-plans', body: {} }).body, {});
  assert.deepEqual(validateDesktopApiRequest({ method: 'POST', path: '/api/model-catalog', body: { resultId: '123e4567-e89b-12d3-a456-426614174000' } }).body, { resultId: '123e4567-e89b-12d3-a456-426614174000' });
  const planId = '123e4567-e89b-12d3-a456-426614174000';
  assert.deepEqual(validateDesktopApiRequest({ method: 'POST', path: `/api/local-control/plans/${planId}/confirm`, body: {} }).body, {});
  assert.throws(() => validateDesktopApiRequest({ method: 'POST', path: '/api/setup/profiles', body: { displayName: 'DGX', sshAlias: 'dgx', command: 'whoami' } }), /profile fields/);
  assert.throws(() => validateDesktopApiRequest({ method: 'POST', path: '/api/local-control/plans', body: { serviceId: 'vlm', action: 'shell' } }), /Unsupported local control plan/);
  assert.throws(() => validateDesktopApiRequest({ method: 'POST', path: '/api/managed-services/123e4567-e89b-12d3-a456-426614174000/plans', body: { action: 'shell' } }), /Managed service action/);
  assert.throws(() => validateDesktopApiRequest({ method: 'POST', path: '/api/models/nvfp4/parameter-review', body: { proposed: { command: 'restart' } } }), /parameter fields/);
  assert.throws(() => validateDesktopApiRequest({ method: 'POST', path: '/api/models/nvfp4/parameter-adapter/deployment-plans', body: { force: true } }), /deployment body/);
  assert.throws(() => validateDesktopApiRequest({ method: 'POST', path: `/api/local-control/plans/${planId}/confirm`, body: { force: true } }), /confirmation body/);
});

test('desktop bridge covers the complete fixed renderer API contract', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const readPaths = [
    '/api/health',
    '/api/connection-status',
    '/api/remote-desktop/status',
    '/api/hardware/summary',
    '/api/hardware/gpu',
    '/api/hardware/storage',
    '/api/hardware/network',
    '/api/hardware/components',
    '/api/hardware/history?metric=cpuPercent&range=15m',
    '/api/services',
    '/api/system',
    '/api/models/nvfp4/metrics',
    '/api/models/vlm/metrics',
    '/api/models/nvfp4/config',
    '/api/requests',
    '/api/benchmarks',
    '/api/setup/capabilities',
    '/api/setup/profiles',
    '/api/local-control/capabilities',
    '/api/model-catalog/search?q=Qwen3',
    '/api/logs?service=nvfp4&lines=200',
    `/api/local-control/operations/${id}`,
  ];
  for (const path of readPaths) assert.equal(validateDesktopApiRequest({ method: 'GET', path }).path, path);

  const writes = [
    { path: '/api/setup/profiles', body: { displayName: 'DGX', sshAlias: 'dgx' } },
    { path: `/api/setup/profiles/${id}/verify`, body: {} },
    { path: `/api/setup/profiles/${id}/activate`, body: {} },
    { path: '/api/local-control/plans', body: { serviceId: 'image', action: 'restart' } },
    { path: `/api/local-control/plans/${id}/confirm`, body: {} },
    { path: '/api/models/nvfp4/parameter-review', body: { proposed: { gpuMemoryUtilization: 0.8 } } },
    { path: '/api/models/nvfp4/parameter-adapter/deployment-plans', body: {} },
    { path: '/api/model-catalog', body: { resultId: id } },
    { path: `/api/managed-services/${id}/plans`, body: { action: 'restart' } },
    { path: `/api/managed-service-plans/${id}/confirm`, body: {} },
  ];
  for (const { path, body } of writes) assert.equal(validateDesktopApiRequest({ method: 'POST', path, body }).path, path);
});

test('desktop bridge adds the session token only in the main-process request', async () => {
  let received;
  const bridge = createDesktopApiBridge({
    baseUrl: 'http://127.0.0.1:43123',
    apiToken: 'a'.repeat(43),
    fetcher: async (url, options) => {
      received = { url, options };
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.deepEqual(await bridge.request({ method: 'GET', path: '/api/health' }), { status: 200, payload: { status: 'ok' } });
  assert.equal(received.url, 'http://127.0.0.1:43123/api/health');
  assert.match(received.options.headers.Authorization, /^Bearer /);
  assert.equal(Object.prototype.hasOwnProperty.call(received, 'apiToken'), false);
});

test('direct desktop adapter validates the renderer request and calls the application core without fetch', async () => {
  let received;
  const adapter = createDesktopDirectAdapter({
    dispatch: async (request) => {
      received = request;
      return { status: 200, payload: { status: 'not-configured' } };
    },
  });
  assert.deepEqual(await adapter.request({ method: 'GET', path: '/api/health' }), { status: 200, payload: { status: 'not-configured' } });
  assert.deepEqual(received, { method: 'GET', path: '/api/health' });
  await assert.rejects(adapter.request({ method: 'GET', path: 'http://127.0.0.1:8501/api/health' }), /Unsupported/);
  assert.throws(() => createDesktopDirectAdapter({}), /application dispatcher/);
});
