import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createChangeAuditStore } from '../src/change-audit-store.mjs';
import { createChangeAuditRecord } from '../src/change-audit.mjs';

test('appends and reads only non-executable local audit records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-audit-'));
  try {
    const store = createChangeAuditStore({ filePath: join(directory, 'audit.jsonl') });
    const record = createChangeAuditRecord({ changeId: 'chg-store-1', actor: 'operator', snapshotId: 'snap', scriptHash: 'hash' });
    await store.append(record);
    assert.deepEqual(await store.list(), [record]);
    await assert.rejects(store.append({ executionAllowed: true }), /non-executable/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
