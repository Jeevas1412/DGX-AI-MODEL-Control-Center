import assert from 'node:assert/strict';
import test from 'node:test';
import { createNodeProbe, createNodeSnapshotProvider, NODE_STATUS, nodeStatus } from '../src/node-probe.mjs';

const timestamp = '2026-08-05T00:00:00.000Z';

function profile(overrides = {}) {
  return {
    id: 'node-1',
    displayName: 'Node One',
    sshAlias: 'gdx',
    verification: { status: 'verified', verifiedAt: timestamp, evidence: { targetMachineSha256: `sha256:${'a'.repeat(64)}`, capabilitySnapshotSha256: `sha256:${'b'.repeat(64)}` } },
    ...overrides,
  };
}

function okSnapshot(overrides = {}) {
  return {
    generatedAt: timestamp,
    health: { status: 'ok', generatedAt: timestamp, detail: 'Read-only DGX probes succeeded.' },
    services: [
      { id: 'nvfp4', name: 'NVFP4', status: 'running', port: 8091 },
      { id: 'vlm', name: 'VLM', status: 'offline', port: 8003 },
    ],
    system: {
      generatedAt: timestamp,
      gpuName: 'NVIDIA GB10',
      gpuDriverVersion: '580.173.02',
      gpuMemoryTotalMiB: 128000,
      gpuMemoryUsedMiB: 44000,
      gpuUtilizationPercent: 12,
      gpuPowerWatts: 45,
      gpuTemperatureCelsius: 52,
      memoryTotalBytes: 263000000000,
      memoryAvailableBytes: 180000000000,
    },
    metrics: {},
    requests: [],
    logs: [],
    ...overrides,
  };
}

function sessionFactory(snapshot, error = null) {
  return async () => Object.freeze({
    snapshotProvider: error ? async () => { throw error; } : async () => snapshot,
    logProvider: async () => [],
  });
}

test('nodeStatus maps a healthy snapshot to healthy', () => {
  assert.equal(nodeStatus({ snapshot: okSnapshot() }), 'healthy');
});

test('nodeStatus maps a degraded snapshot to degraded', () => {
  assert.equal(nodeStatus({ snapshot: okSnapshot({ health: { status: 'degraded', generatedAt: timestamp, detail: 'one probe unavailable' } }) }), 'degraded');
});

test('nodeStatus maps an error to unreachable and unknown to unknown', () => {
  assert.equal(nodeStatus({ snapshot: null, error: new Error('boom') }), 'unreachable');
  assert.equal(nodeStatus({ snapshot: null, error: null }), 'unknown');
});

test('createNodeProbe returns a stable per-node snapshot with node metadata', async () => {
  const probe = createNodeProbe({ profile: profile(), createSession: sessionFactory(okSnapshot()) });
  const node = await probe.probe();
  assert.equal(node.profileId, 'node-1');
  assert.equal(node.sshAlias, 'gdx');
  assert.equal(node.reachable, true);
  assert.equal(node.status, 'healthy');
  assert.deepEqual(node.errors, []);
  assert.equal(node.gpu.gpuName, 'NVIDIA GB10');
  assert.equal(node.services.length, 2);
});

test('createNodeProbe classifies a failing target as unreachable with a typed error', async () => {
  const probe = createNodeProbe({ profile: profile(), createSession: sessionFactory(null, new Error('DGX read-only probe timed out.')) });
  const node = await probe.probe();
  assert.equal(node.reachable, false);
  assert.equal(node.status, 'unreachable');
  assert.equal(node.errors.length, 1);
  assert.equal(node.errors[0].kind, 'timeout');
});

test('aggregation keeps partial success when one node fails', async () => {
  const profiles = [profile({ id: 'node-1', sshAlias: 'gdx' }), profile({ id: 'node-2', sshAlias: 'gdx2', displayName: 'Node Two' })];
  const store = { load: async () => ({ schemaVersion: 4, activeProfileId: 'node-1', monitoredProfileIds: [], profiles }) };
  const createSession = async (p) => Object.freeze({
    snapshotProvider: p.id === 'node-1' ? async () => okSnapshot() : async () => { throw new Error('DGX read-only probe timed out.'); },
    logProvider: async () => [],
  });
  const provider = createNodeSnapshotProvider({ profileStore: store, createSession, now: () => new Date(timestamp) });
  const result = await provider();
  assert.equal(result.summary.configured, 2);
  assert.equal(result.summary.reachable, 1);
  assert.equal(result.summary.unreachable, 1);
  assert.equal(result.nodes.length, 2);
  const ok = result.nodes.find((n) => n.profileId === 'node-1');
  const bad = result.nodes.find((n) => n.profileId === 'node-2');
  assert.equal(ok.status, 'healthy');
  assert.equal(bad.status, 'unreachable');
  assert.equal(bad.errors[0].kind, 'timeout');
});

test('aggregation with no verified profiles returns an empty summary', async () => {
  const store = { load: async () => ({ schemaVersion: 4, activeProfileId: null, monitoredProfileIds: [], profiles: [] }) };
  const provider = createNodeSnapshotProvider({ profileStore: store, createSession: async () => ({}), now: () => new Date(timestamp) });
  const result = await provider();
  assert.deepEqual(result.summary, { configured: 0, reachable: 0, healthy: 0, degraded: 0, unreachable: 0 });
  assert.deepEqual(result.nodes, []);
});
