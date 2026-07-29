import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const SCHEMA_VERSION = 1;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 60_480; // 7 days at 10-second granularity
const MAX_BYTES = 8 * 1024 * 1024;
const MIN_CAPTURE_INTERVAL_MS = 10_000;
export const HARDWARE_HISTORY_METRICS = Object.freeze(['gpuUtilizationPercent', 'cpuPercent', 'memoryUsedPercent', 'rootUsedPercent']);
export const HARDWARE_HISTORY_RANGES = Object.freeze(['15m', '1h', '6h', '24h', '7d']);
const ranges = Object.freeze({ '15m': 15 * 60_000, '1h': 60 * 60_000, '6h': 6 * 60 * 60_000, '24h': 24 * 60 * 60_000, '7d': RETENTION_MS });

function number(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null; }
function timestamp(value) { if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error('Hardware history timestamp is invalid.'); return value; }
function state(value) { if (!['fresh', 'unavailable', 'stale'].includes(value)) throw new Error('Hardware history state is invalid.'); return value; }

export function validateHardwareHistoryRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['schemaVersion', 'timestamp', 'state', ...HARDWARE_HISTORY_METRICS].includes(key))) throw new Error('Hardware history record is invalid.');
  if (value.schemaVersion !== SCHEMA_VERSION) throw new Error('Hardware history schema is invalid.');
  const record = { schemaVersion: SCHEMA_VERSION, timestamp: timestamp(value.timestamp), state: state(value.state) };
  for (const metric of HARDWARE_HISTORY_METRICS) record[metric] = number(value[metric]);
  return Object.freeze(record);
}

function asPercent(used, total) {
  return typeof used === 'number' && Number.isFinite(used) && typeof total === 'number' && Number.isFinite(total) && total > 0 ? Math.max(0, Math.min(100, used / total * 100)) : null;
}

export function recordFromHardwareSummary(summary) {
  if (!summary || typeof summary !== 'object') throw new Error('Hardware summary is invalid.');
  const fresh = summary.freshness?.state === 'fresh' && summary.status === 'healthy';
  return validateHardwareHistoryRecord({
    schemaVersion: SCHEMA_VERSION, timestamp: summary.collectedAt, state: fresh ? 'fresh' : 'unavailable',
    gpuUtilizationPercent: fresh ? summary.gpu?.utilizationPercent : null,
    cpuPercent: fresh ? summary.system?.cpuPercent : null,
    memoryUsedPercent: fresh ? summary.memory?.usedPercent ?? asPercent(summary.memory?.usedBytes, summary.memory?.totalBytes) : null,
    rootUsedPercent: fresh ? summary.storage?.rootUsedPercent : null,
  });
}

async function readRecords(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    return content.split(/\r?\n/).filter(Boolean).map((line) => validateHardwareHistoryRecord(JSON.parse(line)));
  } catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
}

async function atomicWrite(filePath, records) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, records.map((item) => JSON.stringify(item)).join('\n') + (records.length ? '\n' : ''), { encoding: 'utf8', mode: 0o600 }); await rename(temporary, filePath); }
  finally { await rm(temporary, { force: true }); }
}

/**
 * Local numeric-only history. It has no SSH, no remote path, no raw command
 * output, no credentials and no user-controlled query language.
 */
export function createHardwareHistoryStore({ filePath, now = () => Date.now(), retentionMs = RETENTION_MS, maxRecords = MAX_RECORDS, maxBytes = MAX_BYTES, minCaptureIntervalMs = MIN_CAPTURE_INTERVAL_MS } = {}) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('Hardware history file path is required.');
  if (![retentionMs, maxRecords, maxBytes, minCaptureIntervalMs].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error('Hardware history retention limits are invalid.');
  const activeRanges = Object.freeze({ '15m': Math.min(ranges['15m'], retentionMs), '1h': Math.min(ranges['1h'], retentionMs), '6h': Math.min(ranges['6h'], retentionMs), '24h': Math.min(ranges['24h'], retentionMs), '7d': retentionMs });
  const compactForStore = (records) => {
    const cutoff = now() - retentionMs;
    const recent = records.filter((item) => Date.parse(item.timestamp) >= cutoff).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)).slice(-maxRecords);
    while (Buffer.byteLength(recent.map((item) => JSON.stringify(item)).join('\n'), 'utf8') > maxBytes && recent.length) recent.shift();
    return recent;
  };
  let queue = Promise.resolve();
  function mutate(change) { const pending = queue.then(change); queue = pending.catch(() => {}); return pending; }
  return Object.freeze({
    capture(summary) {
      const record = recordFromHardwareSummary(summary);
      return mutate(async () => {
        const records = compactForStore(await readRecords(filePath));
        const last = records.at(-1);
        if (last && Date.parse(record.timestamp) - Date.parse(last.timestamp) < minCaptureIntervalMs && record.state === last.state) return false;
        records.push(record);
        await atomicWrite(filePath, compactForStore(records));
        return true;
      });
    },
    list({ metric, range }) {
      if (!HARDWARE_HISTORY_METRICS.includes(metric) || !HARDWARE_HISTORY_RANGES.includes(range)) throw new Error('Hardware history query is invalid.');
      return readRecords(filePath).then((records) => Object.freeze(records.filter((item) => Date.parse(item.timestamp) >= now() - activeRanges[range]).map((item) => Object.freeze({ timestamp: item.timestamp, state: item.state, value: item[metric] }))));
    },
  });
}
