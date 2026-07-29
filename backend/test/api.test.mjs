import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiServer } from '../src/server.mjs';
import { createConnectionProfileStore } from '../src/connection-profile.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const verificationEvidence = Object.freeze({
  targetMachineSha256: `sha256:${'a'.repeat(64)}`,
  capabilitySnapshotSha256: `sha256:${'b'.repeat(64)}`,
});

async function withServer(run, options = {}) {
  const server = createApiServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('each documented monitoring endpoint responds with JSON', async () => {
  await withServer(async (baseUrl) => {
    const paths = [
      '/api/health',
      '/api/connection-status',
      '/api/hardware/summary',
      '/api/services',
      '/api/system',
      '/api/models/nvfp4/metrics',
      '/api/models/nvfp4/config',
      '/api/models/vlm/metrics',
      '/api/requests',
      '/api/logs?service=nvfp4&lines=10',
      '/api/benchmarks',
    ];
    for (const path of paths) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type'), /application\/json/);
    }
  });
});

test('hardware monitoring endpoints are GET-only and preserve unavailable hardware status without a remote probe', async () => {
  await withServer(async (baseUrl) => {
    const summary = await fetch(`${baseUrl}/api/hardware/summary`);
    assert.equal(summary.status, 200);
    assert.equal((await summary.json()).status, 'not-configured');
    const write = await fetch(`${baseUrl}/api/hardware/summary`, { method: 'POST' });
    assert.equal(write.status, 405);
  });
});

test('capability discovery is read-only and fails without exposing a remote error', async () => {
  await withServer(async (baseUrl) => {
    const available = await fetch(`${baseUrl}/api/setup/capabilities`);
    assert.equal(available.status, 200);
    assert.deepEqual((await available.json()).capabilities, { monitoring: 'available' });
  }, {
    capabilityProvider: async () => ({ schemaVersion: 1, checkedAt: '2026-07-20T08:00:00.000Z', connection: 'reachable', capabilities: { monitoring: 'available' } }),
  });
  await withServer(async (baseUrl) => {
    const unavailable = await fetch(`${baseUrl}/api/setup/capabilities`);
    assert.equal(unavailable.status, 503);
    const payload = await unavailable.json();
    assert.equal(payload.error, 'Capability discovery is unavailable.');
    assert.equal(payload.code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(typeof payload.requestId, 'string');
  }, { capabilityProvider: async () => { throw new Error('do not disclose remote host diagnostics'); } });
});

test('loopback setup stores only an OpenSSH alias profile', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-setup-profile-test-'));
  try {
    const profileStore = createConnectionProfileStore({ filePath: join(directory, 'profiles.json') });
    const verifiedAliases = [];
    await withServer(async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/setup/profiles`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'Lab DGX', sshAlias: 'lab-dgx', hostKeyFingerprint: null }),
      });
      assert.equal(created.status, 201);
      const profile = (await created.json()).profile;
      assert.equal(profile.displayName, 'Lab DGX');
      assert.equal(profile.sshAlias, 'lab-dgx');
      assert.equal(profile.transport, 'openssh-alias');
      const verification = await fetch(`${baseUrl}/api/setup/profiles/${profile.id}/verify`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      assert.equal(verification.status, 200);
      assert.equal((await verification.json()).result.connection, 'reachable');
      assert.deepEqual(verifiedAliases, ['lab-dgx']);
      const listed = await fetch(`${baseUrl}/api/setup/profiles`);
      assert.equal(listed.status, 200);
      const listedDocument = await listed.json();
      assert.equal(listedDocument.profiles.length, 1);
      assert.equal(listedDocument.profiles[0].verification.status, 'verified');
      const activation = await fetch(`${baseUrl}/api/setup/profiles/${profile.id}/activate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      assert.equal(activation.status, 200);
      assert.equal((await activation.json()).activeProfileId, profile.id);
      const unsafe = await fetch(`${baseUrl}/api/setup/profiles`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Unsafe', sshAlias: 'lab-dgx', password: 'forbidden' }),
      });
      assert.equal(unsafe.status, 400);
    }, {
      profileStore,
      profileVerifier: async (profile) => {
        verifiedAliases.push(profile.sshAlias);
        return { connection: 'reachable', capabilities: { monitoring: 'available' }, verificationEvidence };
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('benchmark history is served read-only without requiring a DGX snapshot', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/benchmarks`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(Array.isArray(payload.items));
    assert.ok(payload.items.some((item) => item.id === 'p3-50-20260719'));
    assert.equal(payload.items.find((item) => item.id === 'p3-50-20260719').avgTTFT, null);
    assert.equal(payload.items.find((item) => item.id === 'p3-50-20260719').source, 'dgx-real');
  }, { snapshotProvider: async () => { throw new Error('DGX must not be queried for history'); } });
});

test('the monitoring API rejects write methods', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/services`, { method: 'POST' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
    const payload = await response.json();
    assert.equal(payload.error, 'This API is read-only.');
    assert.equal(payload.code, 'REQUEST_REJECTED');
  });
});

test('local service control is a separate loopback-only plan and confirmation API', async () => {
  const calls = [];
  const controller = {
    createPlan: async (input) => { calls.push(['plan', input]); return { id: '00000000-0000-4000-8000-000000000001', status: 'awaiting-confirmation' }; },
    confirmPlan: async (id) => { calls.push(['confirm', id]); return { id: '00000000-0000-4000-8000-000000000002', status: 'running' }; },
    getOperation: (id) => ({ id, status: 'succeeded' }),
  };
  await withServer(async (baseUrl) => {
    const capabilities = await fetch(`${baseUrl}/api/local-control/capabilities`);
    assert.equal(capabilities.status, 200);
    assert.deepEqual((await capabilities.json()).services, ['nvfp4', 'vlm', 'image', 'proxy-8093']);

    const plan = await fetch(`${baseUrl}/api/local-control/plans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceId: 'vlm', action: 'restart' }) });
    assert.equal(plan.status, 201);
    assert.deepEqual(calls[0], ['plan', { serviceId: 'vlm', action: 'restart' }]);

    const confirmation = await fetch(`${baseUrl}/api/local-control/plans/00000000-0000-4000-8000-000000000001/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(confirmation.status, 202);
    assert.deepEqual(calls[1], ['confirm', '00000000-0000-4000-8000-000000000001']);
  }, { localControl: controller });
});

test('the monitoring API allows only configured browser origins', async () => {
  await withServer(async (baseUrl) => {
    const allowed = await fetch(`${baseUrl}/api/services`, { headers: { Origin: 'http://127.0.0.1:8511' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8511');
    const denied = await fetch(`${baseUrl}/api/services`, { headers: { Origin: 'http://127.0.0.1:8501' } });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  }, { corsOrigins: ['http://127.0.0.1:8511'] });
});

test('the monitoring API requires a bearer token when configured', async () => {
  const apiToken = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN_0123456789';
  await withServer(async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/api/services`);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('www-authenticate'), 'Bearer realm="DGX AI Control Center"');

    const allowed = await fetch(`${baseUrl}/api/services`, { headers: { Authorization: `Bearer ${apiToken}` } });
    assert.equal(allowed.status, 200);
  }, { apiToken });
});

test('protected LAN setup permits only token-authenticated profile creation, verification and activation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-lan-setup-'));
  const apiToken = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN_0123456789';
  const origin = 'http://127.0.0.1:5173';
  try {
    const profileStore = createConnectionProfileStore({ filePath: join(directory, 'profiles.json') });
    await withServer(async (baseUrl) => {
      const preflight = await fetch(`${baseUrl}/api/setup/profiles`, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, OPTIONS, POST');

      const unauthenticated = await fetch(`${baseUrl}/api/setup/profiles`, {
        method: 'POST', headers: { Origin: origin, 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'DGX', sshAlias: 'lab-dgx' }),
      });
      assert.equal(unauthenticated.status, 401);

      const created = await fetch(`${baseUrl}/api/setup/profiles`, {
        method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'DGX', sshAlias: 'lab-dgx' }),
      });
      assert.equal(created.status, 201);
      const { profile } = await created.json();

      const verified = await fetch(`${baseUrl}/api/setup/profiles/${profile.id}/verify`, {
        method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }, body: '{}',
      });
      assert.equal(verified.status, 200);
      const activated = await fetch(`${baseUrl}/api/setup/profiles/${profile.id}/activate`, {
        method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }, body: '{}',
      });
      assert.equal(activated.status, 200);

      const rejectedControl = await fetch(`${baseUrl}/api/local-control/plans`, {
        method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ serviceId: 'image', action: 'warmup' }),
      });
      assert.equal(rejectedControl.status, 403);
    }, {
      apiToken,
      corsOrigins: [origin],
      isLocalRequest: () => false,
      profileStore,
      profileVerifier: async () => ({ connection: 'reachable', capabilities: { monitoring: 'available' }, verificationEvidence }),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('LAN profile setup remains blocked when token protection is not configured', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/setup/profiles`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'DGX', sshAlias: 'lab-dgx' }),
    });
    assert.equal(response.status, 403);
  }, { isLocalRequest: () => false });
});

test('the monitoring API permits an allowed CORS preflight without allowing writes', async () => {
  await withServer(async (baseUrl) => {
    const preflight = await fetch(`${baseUrl}/api/services`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://[::1]:5173', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://[::1]:5173');
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, OPTIONS');

    const denied = await fetch(`${baseUrl}/api/services`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://[::1]:5174', 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(denied.status, 403);
  }, { corsOrigins: ['http://[::1]:5173'] });
});

test('loopback control preflight permits only the JSON POST header needed for a local confirmation flow', async () => {
  await withServer(async (baseUrl) => {
    const preflight = await fetch(`${baseUrl}/api/local-control/plans`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://127.0.0.1:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, OPTIONS, POST');
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'Accept, Authorization, Content-Type');
  }, { corsOrigins: ['http://127.0.0.1:5173'], localControl: { createPlan: async () => ({}), confirmPlan: async () => ({}), getOperation: () => ({}) } });
});

test('log query parameters are allowlisted and bounded', async () => {
  await withServer(async (baseUrl) => {
    const badService = await fetch(`${baseUrl}/api/logs?service=../../windows`);
    assert.equal(badService.status, 400);
    const badLines = await fetch(`${baseUrl}/api/logs?service=nvfp4&lines=1000`);
    assert.equal(badLines.status, 400);
  });
});
