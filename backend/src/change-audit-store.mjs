import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function validateRecord(record) {
  if (!record || typeof record !== 'object' || record.executionAllowed !== false || record.executionResult !== 'not-executed') {
    throw new Error('Only non-executable audit records may be persisted.');
  }
}

/** Local append-only JSONL store. It has no network, DGX, or command capability. */
export function createChangeAuditStore({ filePath, fs = { appendFile, mkdir, readFile } } = {}) {
  if (!filePath || typeof filePath !== 'string') throw new Error('A local audit file path is required.');
  return Object.freeze({
    async append(record) {
      validateRecord(record);
      await fs.mkdir(dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
      return record;
    },
    async list() {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
      }
    },
  });
}
