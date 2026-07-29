import assert from 'node:assert/strict';
import test from 'node:test';
import { createHardwareSnapshotCache, createHardwareSnapshotProvider, hardwareProbeScript, hardwareSummaryFromProbe } from '../src/hardware-collector.mjs';

function probe(overrides = {}) {
  return {
    generatedAt: '2026-07-27T10:00:00.000Z', uptimeSeconds: 1000,
    cpu: { totalTicks: 1000, idleTicks: 600 }, load: { load1: 0.1, load5: 0.2, load15: 0.3 },
    memory: { totalBytes: 1000, availableBytes: 400, swapTotalBytes: 200, swapUsedBytes: 10 },
    gpu: { supported: true, utilizationPercent: 25, temperatureC: 50, powerWatts: 20, memoryUsedBytes: 100, memoryTotalBytes: 500, unsupportedFields: [] },
    storage: { rootTotalBytes: 1000, rootUsedBytes: 250, rootAvailableBytes: 700 },
    network: { receivedBytes: 1000, sentBytes: 500 },
    components: {
      'nvidia-persistenced.service': 'active', 'nvidia-dgx-dashboard.service': 'active', 'nvidia-dgx-telemetry.service': 'inactive',
      'smartd.service': 'active', 'sysstat.service': 'active', 'gnome-remote-desktop.service': 'inactive',
    }, ...overrides,
  };
}

test('hardware probe is fixed, read-only, and never references models or dashboard tokens', () => {
  const script = hardwareProbeScript();
  assert.match(script, /\/proc\/meminfo/);
  assert.match(script, /nvidia-smi/);
  assert.doesNotMatch(script, /curl|wget|token|8091|8003|8188|11000|sudo|systemctl\s+(?:start|stop|restart|enable|disable)/i);
});

test('hardware summary preserves unavailable fields as null and never turns them into zero', () => {
  const summary = hardwareSummaryFromProbe(probe({ gpu: { supported: true, utilizationPercent: null, temperatureC: null, powerWatts: null, memoryUsedBytes: null, memoryTotalBytes: null, unsupportedFields: ['utilizationPercent', 'temperatureC', 'powerWatts', 'memoryUsedBytes', 'memoryTotalBytes'] } }), { collectedAt: '2026-07-27T10:00:01.000Z' });
  assert.equal(summary.status, 'healthy');
  assert.equal(summary.memory.usedBytes, 600);
  assert.equal(summary.gpu.utilizationPercent, null);
  assert.equal(summary.storage.rootUsedPercent, 25);
  assert.equal(summary.system.cpuPercent, null);
  assert.equal('_cpu' in summary, true);
});

test('hardware provider uses only the verified alias, computes CPU after two samples, and cache coalesces requests', async () => {
  const responses = [probe(), probe({ cpu: { totalTicks: 1200, idleTicks: 700 }, generatedAt: '2026-07-27T10:00:03.000Z' })];
  let calls = 0;
  const provider = createHardwareSnapshotProvider({
    sshTarget: 'dgx-verified', now: () => new Date('2026-07-27T10:00:04.000Z'),
    execute: async (input) => { calls += 1; assert.equal(input.sshTarget, 'dgx-verified'); assert.equal(input.timeoutMs, 15_000); return JSON.stringify(responses.shift()); },
  });
  assert.equal((await provider()).system.cpuPercent, null);
  assert.equal(Math.round((await provider()).system.cpuPercent), 50);
  let clock = 0;
  const cache = createHardwareSnapshotCache(async () => ({ status: 'healthy', collectedAt: new Date(clock).toISOString(), freshness: { state: 'fresh', cached: false } }), { ttlMs: 3000, now: () => clock });
  const first = await cache();
  const second = await cache();
  assert.equal(first.freshness.cached, false);
  assert.equal(second.freshness.cached, true);
  assert.equal(calls, 2);
});
