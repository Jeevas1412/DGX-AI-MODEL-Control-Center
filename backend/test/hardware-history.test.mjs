import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHardwareHistoryStore, recordFromHardwareSummary, validateHardwareHistoryRecord } from '../src/hardware-history.mjs';

function summary(timestamp, state = 'fresh') {
  return { status: state === 'fresh' ? 'healthy' : 'unavailable', collectedAt: timestamp, freshness: { state }, system: { cpuPercent: 20 }, memory: { usedPercent: 40 }, gpu: { utilizationPercent: 60 }, storage: { rootUsedPercent: 80 } };
}

test('hardware history keeps numeric state only, suppresses dense duplicates, and returns explicit unavailable gaps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-hardware-history-'));
  try {
    const filePath = join(directory, 'history.jsonl');
    let clock = Date.parse('2026-07-27T10:00:00.000Z');
    const store = createHardwareHistoryStore({ filePath, now: () => clock });
    assert.equal(await store.capture(summary('2026-07-27T10:00:00.000Z')), true);
    clock += 5_000;
    assert.equal(await store.capture(summary('2026-07-27T10:00:05.000Z')), false);
    clock += 10_000;
    assert.equal(await store.capture(summary('2026-07-27T10:00:15.000Z', 'unavailable')), true);
    const points = await store.list({ metric: 'gpuUtilizationPercent', range: '15m' });
    assert.deepEqual(points.map((item) => item.value), [60, null]);
    assert.deepEqual(points.map((item) => item.state), ['fresh', 'unavailable']);
    const content = await readFile(filePath, 'utf8');
    assert.doesNotMatch(content, /ssh|command|path|token|ip/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('hardware history rejects unbounded fields and malformed persisted entries', async () => {
  assert.throws(() => validateHardwareHistoryRecord({ schemaVersion: 1, timestamp: '2026-07-27T10:00:00.000Z', state: 'fresh', gpuUtilizationPercent: 1, cpuPercent: 2, memoryUsedPercent: 3, rootUsedPercent: 4, raw: 'forbidden' }), /invalid/);
  assert.equal(recordFromHardwareSummary(summary('2026-07-27T10:00:00.000Z')).memoryUsedPercent, 40);
  const directory = await mkdtemp(join(tmpdir(), 'dgx-hardware-history-'));
  try {
    const filePath = join(directory, 'history.jsonl');
    await writeFile(filePath, '{bad}\n', 'utf8');
    await assert.rejects(() => createHardwareHistoryStore({ filePath }).list({ metric: 'cpuPercent', range: '15m' }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('hardware history compacts by time, record count, and byte budget without retaining old data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-hardware-history-'));
  try {
    const filePath = join(directory, 'history.jsonl');
    let clock = Date.parse('2026-07-27T10:00:00.000Z');
    const store = createHardwareHistoryStore({ filePath, now: () => clock, retentionMs: 30_000, maxRecords: 2, maxBytes: 1_000, minCaptureIntervalMs: 1 });
    await store.capture(summary('2026-07-27T09:59:00.000Z'));
    await store.capture(summary('2026-07-27T10:00:01.000Z'));
    await store.capture(summary('2026-07-27T10:00:02.000Z'));
    await store.capture(summary('2026-07-27T10:00:03.000Z'));
    const recent = await store.list({ metric: 'cpuPercent', range: '7d' });
    assert.deepEqual(recent.map((item) => item.timestamp), ['2026-07-27T10:00:02.000Z', '2026-07-27T10:00:03.000Z']);
    clock += 35_000;
    await store.capture(summary('2026-07-27T10:00:35.000Z'));
    const afterExpiry = await store.list({ metric: 'cpuPercent', range: '7d' });
    assert.deepEqual(afterExpiry.map((item) => item.timestamp), ['2026-07-27T10:00:35.000Z']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
