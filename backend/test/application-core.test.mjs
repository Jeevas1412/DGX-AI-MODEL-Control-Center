import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplicationCore } from '../src/application-core.mjs';
import { createConnectionProfileStore } from '../src/connection-profile.mjs';
import { createModelCatalog } from '../src/model-catalog.mjs';
import { createModelServiceRegistry } from '../src/model-service-registry.mjs';

const verificationEvidence = Object.freeze({
  targetMachineSha256: `sha256:${'a'.repeat(64)}`,
  capabilitySnapshotSha256: `sha256:${'b'.repeat(64)}`,
});

test('application core handles local profile setup without an HTTP server or remote provider', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-application-core-'));
  try {
    const profileStore = createConnectionProfileStore({ filePath: join(directory, 'profiles.json') });
    const core = createApplicationCore({
      profileStore,
      profileVerifier: async (profile) => ({
        connection: 'reachable',
        checkedAt: '2026-07-21T00:00:00.000Z',
        capabilities: { monitoring: profile.sshAlias === 'lab-dgx' ? 'available' : 'unavailable' },
        verificationEvidence,
      }),
      snapshotProvider: async () => { throw new Error('remote snapshot must not run during local setup'); },
    });
    const capabilities = await core.dispatch({ method: 'GET', path: '/api/setup/capabilities' });
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.payload.connection, 'not-configured');

    const created = await core.dispatch({ method: 'POST', path: '/api/setup/profiles', body: { displayName: 'Local DGX', sshAlias: 'lab-dgx' } });
    assert.equal(created.status, 201);
    assert.equal(created.payload.profile.sshAlias, 'lab-dgx');

    const verified = await core.dispatch({ method: 'POST', path: `/api/setup/profiles/${created.payload.profile.id}/verify`, body: {} });
    assert.equal(verified.status, 200);
    assert.equal(verified.payload.result.connection, 'reachable');

    const activated = await core.dispatch({ method: 'POST', path: `/api/setup/profiles/${created.payload.profile.id}/activate`, body: {} });
    assert.equal(activated.status, 200);
    assert.equal(activated.payload.activeProfileId, created.payload.profile.id);

    const listed = await core.dispatch({ method: 'GET', path: '/api/setup/profiles' });
    assert.equal(listed.status, 200);
    assert.equal(listed.payload.profiles.length, 1);
    assert.equal(listed.payload.profiles[0].verification.status, 'verified');
    assert.equal('evidence' in listed.payload.profiles[0].verification, false);
    assert.equal((await core.dispatch({ method: 'GET', path: '/api/health' })).status, 503);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('application core exposes an isolated DGX connection probe without loading a monitoring snapshot', async () => {
  const core = createApplicationCore({
    connectionStatusProvider: async () => ({ status: 'connected', checkedAt: '2026-07-24T01:00:00.000Z' }),
    snapshotProvider: async () => { throw new Error('snapshot must not run for the connection status lamp'); },
  });
  const response = await core.dispatch({ method: 'GET', path: '/api/connection-status' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, { status: 'connected', checkedAt: '2026-07-24T01:00:00.000Z' });
});

test('application core exposes a fail-closed remote desktop status contract without loading a monitoring snapshot', async () => {
  const core = createApplicationCore({
    snapshotProvider: async () => { throw new Error('snapshot must not run for remote desktop status'); },
  });
  const response = await core.dispatch({ method: 'GET', path: '/api/remote-desktop/status' });
  assert.equal(response.status, 200);
  assert.equal(response.payload.state, 'not-configured');
  assert.equal(response.payload.management, 'not-configured');
  assert.equal(response.payload.service, 'unknown');

  const unavailable = createApplicationCore({
    remoteDesktopStatusProvider: async () => { throw new Error('DGX unavailable'); },
    snapshotProvider: async () => { throw new Error('snapshot must not run for remote desktop status'); },
  });
  const fallback = await unavailable.dispatch({ method: 'GET', path: '/api/remote-desktop/status' });
  assert.equal(fallback.status, 200);
  assert.equal(fallback.payload.state, 'unreachable');
  assert.equal(fallback.payload.management, 'unknown');
});

test('application core exposes hardware categories only through its injected fixed hardware provider', async () => {
  const summary = Object.freeze({ status: 'healthy', connection: 'connected', collectedAt: '2026-07-27T10:00:00.000Z', ageMs: 0, source: 'fixed-ssh-hardware-probe', system: { cpuPercent: 10 }, memory: {}, gpu: {}, storage: { rootUsedPercent: 20 }, network: {}, components: [], freshness: { state: 'fresh', cached: false } });
  const core = createApplicationCore({ hardwareSnapshotProvider: async () => summary });
  assert.deepEqual((await core.dispatch({ method: 'GET', path: '/api/hardware/summary' })).payload, summary);
  const storage = await core.dispatch({ method: 'GET', path: '/api/hardware/storage' });
  assert.equal(storage.status, 200);
  assert.deepEqual(storage.payload.storage, { rootUsedPercent: 20 });
  assert.equal((await core.dispatch({ method: 'GET', path: '/api/hardware/history?metric=cpu&range=15m' })).status, 400);
});

test('application core exposes only enum-bound hardware history and preserves local history failures', async () => {
  let captured = 0;
  const core = createApplicationCore({
    hardwareSnapshotProvider: async () => ({ status: 'healthy', connection: 'connected', collectedAt: '2026-07-27T10:00:00.000Z', ageMs: 0, source: 'fixed-ssh-hardware-probe', system: {}, memory: {}, gpu: {}, storage: {}, network: {}, components: [], freshness: { state: 'fresh', cached: false } }),
    hardwareHistoryStore: { capture: async () => { captured += 1; }, list: async ({ metric, range }) => [{ timestamp: '2026-07-27T10:00:00.000Z', state: 'fresh', value: metric === 'cpuPercent' && range === '15m' ? 7 : null }] },
  });
  assert.equal((await core.dispatch({ method: 'GET', path: '/api/hardware/summary' })).status, 200);
  assert.equal(captured, 1);
  const history = await core.dispatch({ method: 'GET', path: '/api/hardware/history?metric=cpuPercent&range=15m' });
  assert.equal(history.status, 200);
  assert.equal(history.payload.items[0].value, 7);
  assert.equal((await core.dispatch({ method: 'GET', path: '/api/hardware/history?metric=raw&range=15m' })).status, 400);
});

test('application core refuses a reachable verification result without bound target evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-application-core-'));
  try {
    const profileStore = createConnectionProfileStore({ filePath: join(directory, 'profiles.json') });
    const core = createApplicationCore({
      profileStore,
      profileVerifier: async () => ({ connection: 'reachable', capabilities: { monitoring: 'available' } }),
    });
    const created = await core.dispatch({ method: 'POST', path: '/api/setup/profiles', body: { displayName: 'Lab DGX', sshAlias: 'lab-dgx' } });
    const verification = await core.dispatch({ method: 'POST', path: `/api/setup/profiles/${created.payload.profile.id}/verify`, body: {} });
    assert.equal(verification.status, 503);
    assert.equal((await profileStore.load()).profiles[0].verification.status, 'unverified');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('application core keeps control disabled unless an adapter explicitly supplies it', async () => {
  const core = createApplicationCore();
  assert.deepEqual(await core.dispatch({ method: 'GET', path: '/api/local-control/capabilities' }), {
    status: 200,
    payload: { enabled: false, localOnly: true, services: [], actions: [] },
  });
  const disabled = await core.dispatch({ method: 'POST', path: '/api/local-control/plans', body: { serviceId: 'vlm', action: 'restart' } });
  assert.equal(disabled.status, 403);
  assert.equal(disabled.payload.error, 'Local service control is disabled.');
  assert.equal(disabled.payload.code, 'OPERATION_NOT_ENABLED');
});

test('NVFP4 parameter review creates a local non-executable audit record without an execution path', async () => {
  const records = [];
  const core = createApplicationCore({
    snapshotProvider: async () => ({
      generatedAt: '2026-07-22T00:00:00.000Z',
      metrics: {
        nvfp4: {
          config: {
            integritySha256: `sha256:${'c'.repeat(64)}`,
            maxModelLen: 65536,
            gpuMemoryUtilization: 0.55,
            maxNumSeqs: 2,
            maxNumBatchedTokens: 16384,
            kvCacheDtype: 'fp8',
            prefixCaching: true,
            mtpTokens: 3,
          },
        },
      },
    }),
    changeAuditStore: { append: async (record) => { records.push(record); return record; } },
  });
  const reviewed = await core.dispatch({ method: 'POST', path: '/api/models/nvfp4/parameter-review', body: { proposed: { maxNumSeqs: 4 } } });
  assert.equal(reviewed.status, 201);
  assert.equal(reviewed.payload.review.approvedForExecution, false);
  assert.equal(reviewed.payload.review.changes[0].from, 2);
  assert.equal(reviewed.payload.review.changes[0].to, 4);
  assert.equal(reviewed.payload.audit.executionAllowed, false);
  assert.equal(reviewed.payload.audit.executionResult, 'not-executed');
  assert.equal(records.length, 1);
  assert.equal(records[0].executionAllowed, false);
  assert.equal((await core.dispatch({ method: 'POST', path: '/api/models/nvfp4/parameter-review', body: { proposed: { command: 'restart' } } })).status, 400);
});

test('NVFP4 parameter adapter deployment requires a local plan and confirmation', async () => {
  let installed = false;
  let deployments = 0;
  const core = createApplicationCore({
    nvfp4ParameterAdapter: {
      status: async () => ({ installed, id: 'nvfp4-startup-parameters', version: '1.0.0' }),
      newDeploymentPlan: () => ({ id: '123e4567-e89b-12d3-a456-426614174000', expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'awaiting-confirmation' }),
      deploy: async () => { deployments += 1; installed = true; return { installed: true, id: 'nvfp4-startup-parameters', version: '1.0.0' }; },
    },
  });
  const plan = await core.dispatch({ method: 'POST', path: '/api/models/nvfp4/parameter-adapter/deployment-plans', body: {} });
  assert.equal(plan.status, 201);
  const confirmed = await core.dispatch({ method: 'POST', path: '/api/models/nvfp4/parameter-adapter/deployment-plans/123e4567-e89b-12d3-a456-426614174000/confirm', body: {} });
  assert.equal(confirmed.status, 201);
  assert.equal(confirmed.payload.status.installed, true);
  assert.equal(deployments, 1);
  assert.equal((await core.dispatch({ method: 'POST', path: '/api/models/nvfp4/parameter-adapter/deployment-plans', body: {} })).status, 409);
});

test('application core searches verified local inventory and keeps catalog writes local', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-model-catalog-core-'));
  try {
    const modelCatalog = createModelCatalog({ filePath: join(directory, 'model-catalog.json') });
    const core = createApplicationCore({
      modelCatalog,
      modelSearchProvider: {
        search: async (query) => [{ resultId: '123e4567-e89b-12d3-a456-426614174000', source: 'dgx-local', modelId: `mdl-${query}`, displayName: query }],
        consume: async (resultId) => resultId === '123e4567-e89b-12d3-a456-426614174000' ? { source: 'dgx-local', modelId: 'mdl-1234567890abcdef1234567890abcdef', displayName: 'Qwen3', targetMachineSha256: `sha256:${'a'.repeat(64)}` } : Promise.reject(new Error('expired')),
      },
    });
    const searched = await core.dispatch({ method: 'GET', path: '/api/model-catalog/search?q=Qwen3', body: undefined });
    assert.equal(searched.status, 200);
    assert.equal(searched.payload.items[0].modelId, 'mdl-Qwen3');
    const created = await core.dispatch({ method: 'POST', path: '/api/model-catalog', body: { resultId: '123e4567-e89b-12d3-a456-426614174000' } });
    assert.equal(created.status, 201);
    assert.equal(created.payload.entry.modelId, 'mdl-1234567890abcdef1234567890abcdef');
    const rejected = await core.dispatch({ method: 'POST', path: '/api/model-catalog', body: { resultId: '123e4567-e89b-12d3-a456-426614174001' } });
    assert.equal(rejected.status, 400);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('model service precheck blocks without a fixed adapter and passes only for a matching discovered template', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-model-service-core-'));
  try {
    const profileStore = createConnectionProfileStore({ filePath: join(directory, 'profiles.json') });
    const modelServiceRegistry = createModelServiceRegistry({ filePath: join(directory, 'model-service-registry.json') });
    const core = createApplicationCore({
      profileStore,
      modelServiceRegistry,
      profileVerifier: async () => ({ connection: 'reachable', capabilities: { monitoring: 'available' }, verificationEvidence }),
      modelServiceAdapterDiscovery: async () => [],
    });
    const created = await core.dispatch({ method: 'POST', path: '/api/setup/profiles', body: { displayName: 'Lab DGX', sshAlias: 'lab-dgx' } });
    await core.dispatch({ method: 'POST', path: `/api/setup/profiles/${created.payload.profile.id}/verify`, body: {} });
    await core.dispatch({ method: 'POST', path: `/api/setup/profiles/${created.payload.profile.id}/activate`, body: {} });
    const draft = await modelServiceRegistry.addDraft({
      catalogEntryId: '123e4567-e89b-12d3-a456-426614174001',
      templateId: 'openai-compatible-text',
      displayName: 'Text model',
      targetMachineSha256: verificationEvidence.targetMachineSha256,
    });
    const blocked = await core.dispatch({ method: 'GET', path: `/api/model-service-configurations/${draft.id}/precheck` });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.payload.eligible, false);

    const executedManagedActions = [];
    const eligibleCore = createApplicationCore({
      profileStore,
      modelServiceRegistry,
      modelCatalog: { loadForTarget: async () => ({ entries: [{ id: '123e4567-e89b-12d3-a456-426614174001', modelId: 'text-model' }] }) },
      modelServiceAdapterDiscovery: async () => [{ id: 'adapter-text', version: '1.0.0', integritySha256: `sha256:${'b'.repeat(64)}`, templateId: 'openai-compatible-text', modelIds: ['text-model'], actions: ['warmup', 'restart', 'stop'], healthCheck: { kind: 'service-health' }, resourceBudget: { estimatedMemoryMiB: 4096 } }],
      snapshotProvider: async () => ({ system: { modelMemoryBudget: { allocatableMiB: 8192 }, queueDepth: 0 } }),
      modelServiceRegistrar: { register: async () => ({ registrationId: '123e4567-e89b-12d3-a456-426614174002', status: 'registered' }) },
      modelServiceExecutor: async (input) => { executedManagedActions.push(input); },
    });
    const eligible = await eligibleCore.dispatch({ method: 'GET', path: `/api/model-service-configurations/${draft.id}/precheck` });
    assert.equal(eligible.status, 200);
    assert.equal(eligible.payload.eligible, true);
    const plan = await eligibleCore.dispatch({ method: 'POST', path: `/api/model-service-configurations/${draft.id}/registration-plans`, body: {} });
    assert.equal(plan.status, 201);
    assert.equal(plan.payload.plan.action, 'register-managed-service');
    assert.equal(plan.payload.plan.status, 'awaiting-confirmation');
    const confirmed = await eligibleCore.dispatch({ method: 'POST', path: `/api/model-service-registration-plans/${plan.payload.plan.id}/confirm`, body: {} });
    assert.equal(confirmed.status, 201);
    assert.equal(confirmed.payload.entry.status, 'registered');
    const warmupPlan = await eligibleCore.dispatch({ method: 'POST', path: `/api/managed-services/${draft.id}/plans`, body: { action: 'warmup' } });
    assert.equal(warmupPlan.status, 201);
    const warmed = await eligibleCore.dispatch({ method: 'POST', path: `/api/managed-service-plans/${warmupPlan.payload.plan.id}/confirm`, body: {} });
    assert.equal(warmed.status, 202);
    assert.ok(executedManagedActions.some((item) => item.adapterId === 'adapter-text' && item.action === 'warmup'));
    const restartPlan = await eligibleCore.dispatch({ method: 'POST', path: `/api/managed-services/${draft.id}/plans`, body: { action: 'restart' } });
    assert.equal(restartPlan.status, 201);
    assert.equal(restartPlan.payload.plan.action, 'restart');
    const restarted = await eligibleCore.dispatch({ method: 'POST', path: `/api/managed-service-plans/${restartPlan.payload.plan.id}/confirm`, body: {} });
    assert.equal(restarted.status, 202);
    assert.ok(executedManagedActions.some((item) => item.adapterId === 'adapter-text' && item.action === 'restart'));

    const insufficientCore = createApplicationCore({
      profileStore,
      modelServiceRegistry,
      modelCatalog: { loadForTarget: async () => ({ entries: [{ id: '123e4567-e89b-12d3-a456-426614174001', modelId: 'text-model' }] }) },
      modelServiceAdapterDiscovery: async () => [{ id: 'adapter-text', version: '1.0.0', integritySha256: `sha256:${'b'.repeat(64)}`, templateId: 'openai-compatible-text', modelIds: ['text-model'], actions: ['warmup', 'restart', 'stop'], healthCheck: { kind: 'service-health' }, resourceBudget: { estimatedMemoryMiB: 4096 } }],
      snapshotProvider: async () => ({ system: { modelMemoryBudget: { allocatableMiB: 2048 }, queueDepth: 0 } }),
      modelServiceExecutor: async (input) => { executedManagedActions.push(input); },
    });
    const insufficient = await insufficientCore.dispatch({ method: 'GET', path: `/api/model-service-configurations/${draft.id}/precheck` });
    assert.equal(insufficient.status, 200);
    assert.equal(insufficient.payload.eligible, false);
    assert.equal(insufficient.payload.registrationEligible, true);
    assert.equal(insufficient.payload.checks.find((check) => check.id === 'resources')?.status, 'blocked');
    const deferredStartPlan = await insufficientCore.dispatch({ method: 'POST', path: `/api/model-service-configurations/${draft.id}/registration-plans`, body: {} });
    assert.equal(deferredStartPlan.status, 201);
    const blockedWarmup = await insufficientCore.dispatch({ method: 'POST', path: `/api/managed-services/${draft.id}/plans`, body: { action: 'warmup' } });
    assert.equal(blockedWarmup.status, 409);
    assert.equal(blockedWarmup.payload.code, 'STARTUP_PRECHECK_BLOCKED');
    const restartDespiteCurrentUsage = await insufficientCore.dispatch({ method: 'POST', path: `/api/managed-services/${draft.id}/plans`, body: { action: 'restart' } });
    assert.equal(restartDespiteCurrentUsage.status, 201);
    const stoppedDespiteCurrentUsage = await insufficientCore.dispatch({ method: 'POST', path: `/api/managed-services/${draft.id}/plans`, body: { action: 'stop' } });
    assert.equal(stoppedDespiteCurrentUsage.status, 201);

    const currentProfileDocument = await profileStore.load();
    const staleProfiles = currentProfileDocument.profiles.map((profile) => ({
      ...profile,
      verification: { ...profile.verification, verifiedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() },
    }));
    await profileStore.save({ ...currentProfileDocument, profiles: staleProfiles });
    const staleCore = createApplicationCore({
      profileStore,
      modelServiceRegistry,
      modelCatalog: { loadForTarget: async () => ({ entries: [{ id: '123e4567-e89b-12d3-a456-426614174001', modelId: 'text-model' }] }) },
      modelServiceAdapterDiscovery: async () => [{ id: 'adapter-text', version: '1.0.0', integritySha256: `sha256:${'b'.repeat(64)}`, templateId: 'openai-compatible-text', modelIds: ['text-model'], actions: ['warmup', 'restart', 'stop'], healthCheck: { kind: 'service-health' }, resourceBudget: { estimatedMemoryMiB: 4096 } }],
      snapshotProvider: async () => ({ system: { modelMemoryBudget: { allocatableMiB: 8192 }, queueDepth: 0 } }),
      modelServiceExecutor: async () => { throw new Error('must not execute with stale verification'); },
    });
    const stalePlan = await staleCore.dispatch({ method: 'POST', path: `/api/managed-services/${draft.id}/plans`, body: { action: 'warmup' } });
    assert.equal(stalePlan.status, 409);
    assert.equal(stalePlan.payload.code, 'PROFILE_REVERIFY_REQUIRED');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('application core refuses to verify a profile when the trusted OpenSSH host key differs from the configured fingerprint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-application-core-'));
  try {
    const profileStore = createConnectionProfileStore({ filePath: join(directory, 'profiles.json') });
    const core = createApplicationCore({
      profileStore,
      profileVerifier: async () => ({
        connection: 'reachable',
        capabilities: { monitoring: 'available' },
        trustedHostKeyFingerprints: ['SHA256:DifferentTrustedHostKey'],
      }),
    });
    const created = await core.dispatch({
      method: 'POST',
      path: '/api/setup/profiles',
      body: { displayName: 'Lab DGX', sshAlias: 'lab-dgx', hostKeyFingerprint: 'SHA256:ExpectedTrustedHostKey' },
    });
    const verification = await core.dispatch({ method: 'POST', path: `/api/setup/profiles/${created.payload.profile.id}/verify`, body: {} });
    assert.equal(verification.status, 409);
    assert.equal((await profileStore.load()).profiles[0].verification.status, 'unverified');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('service inventory includes registered generic services without inventing a port or a running state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-managed-service-inventory-'));
  try {
    const profileStore = createConnectionProfileStore({ filePath: join(directory, 'profiles.json') });
    const registry = createModelServiceRegistry({ filePath: join(directory, 'services.json') });
    const core = createApplicationCore({
      profileStore,
      modelServiceRegistry: registry,
      profileVerifier: async () => ({ connection: 'reachable', capabilities: { monitoring: 'available' }, verificationEvidence }),
      snapshotProvider: async () => ({ generatedAt: '2026-07-22T00:00:00.000Z', services: [{ id: 'image', name: 'Image service', status: 'running', port: 8188 }], system: {}, metrics: {} }),
      modelServiceAdapterDiscovery: async () => [{ id: 'adapter-text', version: '1.0.0', integritySha256: `sha256:${'c'.repeat(64)}`, templateId: 'openai-compatible-text', actions: ['warmup', 'restart', 'stop'], healthCheck: { kind: 'service-health' }, resourceBudget: { estimatedMemoryMiB: 4096 } }],
    });
    const profile = await core.dispatch({ method: 'POST', path: '/api/setup/profiles', body: { displayName: 'Lab DGX', sshAlias: 'lab-dgx' } });
    await core.dispatch({ method: 'POST', path: `/api/setup/profiles/${profile.payload.profile.id}/verify`, body: {} });
    await core.dispatch({ method: 'POST', path: `/api/setup/profiles/${profile.payload.profile.id}/activate`, body: {} });
    const draft = await registry.addDraft({ catalogEntryId: '123e4567-e89b-12d3-a456-426614174004', templateId: 'openai-compatible-text', displayName: 'Portable text service', targetMachineSha256: verificationEvidence.targetMachineSha256 });
    await registry.markRegistered({ id: draft.id, adapterId: 'adapter-text', adapterVersion: '1.0.0', adapterIntegritySha256: `sha256:${'c'.repeat(64)}`, remoteRegistrationId: '123e4567-e89b-12d3-a456-426614174005' });
    const response = await core.dispatch({ method: 'GET', path: '/api/services' });
    assert.equal(response.status, 200);
    const item = response.payload.items.find((value) => value.managedServiceId === draft.id);
    assert.equal(item.status, 'registered');
    assert.equal(item.port, null);
    assert.equal(item.control, 'managed');
    assert.deepEqual(item.managedActions, ['warmup', 'restart', 'stop']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
