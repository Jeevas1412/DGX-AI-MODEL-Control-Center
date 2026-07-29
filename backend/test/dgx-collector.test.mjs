import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createDgxLogProvider, createDgxSnapshotProvider, createSnapshotCache, executeRemoteScript, snapshotFromProbe } from '../src/dgx-collector.mjs';

const probe = {
  generatedAt: '2026-07-19T06:00:00.000Z',
  memory: { totalBytes: 128 * 1024 ** 3, availableBytes: 96 * 1024 ** 3 },
  gpu: { name: 'NVIDIA GB10', driverVersion: '580.159.03', utilizationPercent: 92, temperatureCelsius: 71, powerWatts: 70, unifiedTotalBytes: 128 * 1024 ** 3, unifiedFreeBytes: 24 * 1024 ** 3, computeApps: [{ pid: 1208567, processName: 'VLLM::EngineCore', usedMiB: 34853 }, { pid: 1036214, processName: 'python', usedMiB: 170 }] },
  nvfp4: {
    backendRunning: true,
    idleForSeconds: 3,
    idleThresholdSeconds: 0,
    ttftMs: 520,
    tokensPerSecond: 33.8,
    prefixCacheHitRate: 0.88,
    mtpAcceptanceRate: 0.85,
    runningRequests: 1,
    queuedRequests: 0,
    kvCacheUsagePercent: 19,
    config: { maxModelLen: 65536, gpuMemoryUtilization: 0.55, maxNumSeqs: 2, maxNumBatchedTokens: 16384, kvCacheDtype: 'fp8', prefixCaching: true, mtpTokens: 3 },
  },
  vlm: { backendRunning: true, idleForSeconds: 5, idleThresholdSeconds: 86400, config: { memFractionStatic: 0.35 } },
  image: { available: true },
  compatibilityProxyHealthy: true,
};

test('maps a fixed DGX probe into the public monitoring contract', () => {
  const snapshot = snapshotFromProbe(probe);
  assert.equal(snapshot.source, 'dgx-ssh-read-only');
  assert.equal(snapshot.health.status, 'ok');
  assert.equal(snapshot.services.find((service) => service.id === 'nvfp4').port, 8091);
  assert.equal(snapshot.services.find((service) => service.id === 'vlm').port, 8003);
  assert.equal(snapshot.metrics.nvfp4.tokensPerSecond, 33.8);
  assert.equal(snapshot.metrics.nvfp4.config.mtpTokens, 3);
  assert.equal(snapshot.system.gpuName, 'NVIDIA GB10');
  assert.equal(snapshot.services.find((service) => service.id === 'nvfp4').observedMemoryMiB, 34853);
  assert.equal(snapshot.system.modelMemoryBudget.source, 'linux-memavailable');
  assert.equal(snapshot.system.modelMemoryBudget.allocatableMiB, 85196.8);
});

test('reports a conservative configured reservation for an unloaded model without treating it as observed use', () => {
  const snapshot = snapshotFromProbe({ ...probe, vlm: { ...probe.vlm, backendRunning: false } });
  const vlm = snapshot.services.find((service) => service.id === 'vlm');
  assert.equal(vlm.observedMemoryMiB, null);
  assert.equal(vlm.estimatedMemoryMiB, 45875.2);
  assert.equal(vlm.estimateSource, 'configured-reservation');
});

test('uses a fixed remote probe script and rejects malformed probe output', async () => {
  let received;
  const provider = createDgxSnapshotProvider({
    sshTarget: 'gdx',
    execute: async (input) => {
      received = input;
      return JSON.stringify(probe);
    },
  });
  const snapshot = await provider();
  assert.equal(snapshot.health.status, 'ok');
  assert.equal(received.sshTarget, 'gdx');
  assert.match(received.script, /127\.0\.0\.1:8092\/metrics/);
  assert.doesNotMatch(received.script, /8094|specific-model-status/i);
  assert.doesNotMatch(received.script, /rm\s+-rf|docker\s+(?:rm|stop|restart)|systemctl\s+(?:stop|restart)/);

  const broken = createDgxSnapshotProvider({ sshTarget: 'gdx', execute: async () => 'not-json' });
  await assert.rejects(broken(), /invalid JSON/);
});

test('bounds SSH stderr diagnostics before reporting a probe failure', async () => {
  const child = new EventEmitter();
  child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
  child.stdin = Object.assign(new EventEmitter(), { end() {} });
  let killed = 0;
  child.kill = () => { killed += 1; };

  const pending = executeRemoteScript({
    sshTarget: 'gdx',
    script: 'echo fixed-probe',
    spawnProcess: () => child,
  });
  child.stderr.emit('data', 'x'.repeat((2 * 1024 * 1024) + 1));
  child.emit('close', 1);

  await assert.rejects(pending, /exceeded the output limit/);
  assert.equal(killed, 1);
});

test('coalesces concurrent polls and caches the last successful snapshot', async () => {
  let calls = 0;
  let now = 100;
  const cached = createSnapshotCache(async () => {
    calls += 1;
    return { id: calls };
  }, { ttlMs: 1000, now: () => now });
  const [first, second] = await Promise.all([cached(), cached()]);
  assert.deepEqual(first, { id: 1 });
  assert.deepEqual(second, { id: 1 });
  assert.equal(calls, 1);
  now += 1001;
  assert.deepEqual(await cached(), { id: 2 });
  assert.equal(calls, 2);
});

test('reads only an allowlisted log and redacts a common credential form', async () => {
  let received;
  const syntheticToken = ['secret', 'value', 'should', 'not', 'leak'].join('-');
  const provider = createDgxLogProvider({
    sshTarget: 'gdx',
    execute: async (input) => {
      received = input;
      return `2026-07-19 14:00:00 ERROR Authorization: Bearer ${syntheticToken}`;
    },
  });
  const items = await provider('8093', 10);
  assert.equal(items.length, 1);
  assert.match(items[0].message, /\[REDACTED\]/);
  assert.doesNotMatch(items[0].message, new RegExp(syntheticToken));
  assert.match(received.script, /nvfp4_http_compat_proxy\.log/);
  assert.doesNotMatch(received.script, new RegExp(syntheticToken));
});
