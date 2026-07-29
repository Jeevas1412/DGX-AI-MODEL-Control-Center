import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const archivedAt = '2026-07-19T16:26:00.000+08:00';
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]{1,240}$/u;
const OPTIONAL_NUMBERS = ['avgTTFT', 'avgThroughput', 'p50', 'p95', 'p99', 'peakMemory'];
const RECORD_FIELDS = new Set(['id', 'testName', 'timestamp', 'successRate', ...OPTIONAL_NUMBERS, 'errorCount', 'errors', 'source']);

// 只保留已经验收的最小摘要。null 表示该轮未采集该指标，不能解释为 0。
export const baselineBenchmarkHistory = Object.freeze([
  { id: 'p4-minimal-joint-20260719', testName: 'P4 NVFP4 + VLM 最小联合', timestamp: archivedAt, successRate: 100, avgTTFT: null, avgThroughput: null, p50: 510.5, p95: 555.2, p99: 555.2, peakMemory: null, errorCount: 0, errors: [], source: 'dgx-real' },
  { id: 'p3-50-20260719', testName: 'P3 50 并发短提示', timestamp: archivedAt, successRate: 100, avgTTFT: null, avgThroughput: 19.7, p50: 5543.0, p95: 9634.6, p99: 10001.2, peakMemory: null, errorCount: 0, errors: [], source: 'dgx-real' },
  { id: 'p3-20-20260719', testName: 'P3 20 并发短提示', timestamp: archivedAt, successRate: 100, avgTTFT: null, avgThroughput: 19.2, p50: 2438.0, p95: 4052.2, p99: 4138.0, peakMemory: null, errorCount: 0, errors: [], source: 'dgx-real' },
  { id: 'p3-10-20260719', testName: 'P3 10 并发短提示', timestamp: archivedAt, successRate: 100, avgTTFT: null, avgThroughput: 19.2, p50: 1300.2, p95: 2034.2, p99: 2074.2, peakMemory: null, errorCount: 0, errors: [], source: 'dgx-real' },
  { id: 'p2-hot-20260719', testName: 'P2 18K 上下文热缓存', timestamp: archivedAt, successRate: 100, avgTTFT: null, avgThroughput: null, p50: 2305.0, p95: 2305.0, p99: 2305.0, peakMemory: null, errorCount: 0, errors: [], source: 'dgx-real' },
  { id: 'p2-cold-20260719', testName: 'P2 18K 上下文冷基线', timestamp: archivedAt, successRate: 100, avgTTFT: null, avgThroughput: null, p50: 20084.7, p95: 20084.7, p99: 20084.7, peakMemory: null, errorCount: 0, errors: [], source: 'dgx-real' },
  { id: 'p1-tool-call-20260719', testName: 'P1 单并发工具调用', timestamp: archivedAt, successRate: 100, avgTTFT: null, avgThroughput: null, p50: 1953.6, p95: 1953.6, p99: 1953.6, peakMemory: null, errorCount: 0, errors: [], source: 'dgx-real' },
  { id: 'p0-short-prompt-20260719', testName: 'P0 单发短提示', timestamp: archivedAt, successRate: 100, avgTTFT: null, avgThroughput: null, p50: 361.7, p95: 361.7, p99: 361.7, peakMemory: null, errorCount: 0, errors: [], source: 'dgx-real' },
]);

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateOptionalNumbers(record) {
  for (const field of OPTIONAL_NUMBERS) {
    if (record[field] !== null && !isNonNegativeNumber(record[field])) {
      throw new Error(`${field} must be a non-negative number or null.`);
    }
  }
}

/** Validates the compact, non-sensitive record accepted by the local JSONL history. */
export function validateBenchmarkHistoryRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Benchmark record must be an object.');
  if (Object.keys(record).some((field) => !RECORD_FIELDS.has(field))) throw new Error('Benchmark record contains an unsupported field.');
  if (!/^[a-z0-9][a-z0-9-]{2,95}$/u.test(record.id || '')) throw new Error('Benchmark record id is invalid.');
  if (typeof record.testName !== 'string' || !SAFE_TEXT.test(record.testName)) throw new Error('Benchmark testName is invalid.');
  if (typeof record.timestamp !== 'string' || Number.isNaN(Date.parse(record.timestamp))) throw new Error('Benchmark timestamp is invalid.');
  if (!isNonNegativeNumber(record.successRate) || record.successRate > 100) throw new Error('Benchmark successRate must be between 0 and 100.');
  validateOptionalNumbers(record);
  if (!Number.isInteger(record.errorCount) || record.errorCount < 0) throw new Error('Benchmark errorCount must be a non-negative integer.');
  if (!Array.isArray(record.errors) || record.errors.length > 20 || record.errors.some((item) => typeof item !== 'string' || !SAFE_TEXT.test(item))) {
    throw new Error('Benchmark errors must be a small list of safe text summaries.');
  }
  if (record.source !== 'dgx-real') throw new Error('Benchmark source must be dgx-real.');
  return structuredClone(record);
}

async function readJsonLines(filePath, fs) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.split(/\r?\n/).filter(Boolean).map((line) => validateBenchmarkHistoryRecord(JSON.parse(line)));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

/** Local append-only JSONL store. It has no HTTP, SSH, DGX, shell, or command capability. */
export function createBenchmarkHistoryStore({ filePath, reservedIds = [], fs = { appendFile, mkdir, readFile } } = {}) {
  if (!filePath || typeof filePath !== 'string') throw new Error('A local benchmark history file path is required.');
  const reserved = new Set(reservedIds);
  return Object.freeze({
    async append(record) {
      const safeRecord = validateBenchmarkHistoryRecord(record);
      const current = await readJsonLines(filePath, fs);
      if (reserved.has(safeRecord.id) || current.some((item) => item.id === safeRecord.id)) {
        throw new Error(`Benchmark record id already exists: ${safeRecord.id}`);
      }
      await fs.mkdir(dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, `${JSON.stringify(safeRecord)}\n`, { encoding: 'utf8', flag: 'a' });
      return safeRecord;
    },
    async list() {
      return readJsonLines(filePath, fs);
    },
  });
}

/** Returns history for the GET-only API; persisted records are re-read on every request. */
export function createBenchmarkHistoryProvider({ filePath, baseline = baselineBenchmarkHistory, fs } = {}) {
  const baselineItems = structuredClone(baseline);
  if (!filePath) return async () => structuredClone(baselineItems);
  const store = createBenchmarkHistoryStore({ filePath, reservedIds: baselineItems.map((item) => item.id), fs });
  return async () => [...structuredClone(baselineItems), ...await store.list()];
}
