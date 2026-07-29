import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { baselineBenchmarkHistory, createBenchmarkHistoryProvider, createBenchmarkHistoryStore } from '../src/benchmark-history.mjs';

function record(overrides = {}) {
  return {
    id: 'mtp1-10-concurrency-20260719',
    testName: 'MTP 1 十并发复验',
    timestamp: '2026-07-19T18:00:00.000+08:00',
    successRate: 100,
    avgTTFT: 120.4,
    avgThroughput: 18.1,
    p50: 900.1,
    p95: 1300.2,
    p99: 1400.3,
    peakMemory: null,
    errorCount: 0,
    errors: [],
    source: 'dgx-real',
    ...overrides,
  };
}

async function withHistoryDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-history-'));
  try {
    await run(join(directory, 'benchmark-history.jsonl'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('local benchmark history persists validated records and the provider merges them with the baseline', async () => {
  await withHistoryDirectory(async (filePath) => {
    const store = createBenchmarkHistoryStore({ filePath, reservedIds: baselineBenchmarkHistory.map((item) => item.id) });
    await store.append(record());
    const provider = createBenchmarkHistoryProvider({ filePath });
    const items = await provider();
    assert.equal(items.length, baselineBenchmarkHistory.length + 1);
    assert.deepEqual(items.at(-1), record());
  });
});

test('local benchmark history rejects duplicate ids, unsafe text, and non-real sources', async () => {
  await withHistoryDirectory(async (filePath) => {
    const store = createBenchmarkHistoryStore({ filePath, reservedIds: baselineBenchmarkHistory.map((item) => item.id) });
    await store.append(record());
    await assert.rejects(() => store.append(record()), /already exists/);
    await assert.rejects(() => store.append(record({ id: 'unsafe-record', testName: 'unsafe\ntext' })), /testName is invalid/);
    await assert.rejects(() => store.append(record({ id: 'mock-record', source: 'mock' })), /source must be dgx-real/);
    await assert.rejects(() => store.append(record({ id: 'extra-field-record', rawPrompt: 'must not persist' })), /unsupported field/);
  });
});

test('the GET provider fails closed when persisted JSONL is malformed', async () => {
  await withHistoryDirectory(async (filePath) => {
    await writeFile(filePath, '{not-json}\n', 'utf8');
    const provider = createBenchmarkHistoryProvider({ filePath });
    await assert.rejects(() => provider());
  });
});
