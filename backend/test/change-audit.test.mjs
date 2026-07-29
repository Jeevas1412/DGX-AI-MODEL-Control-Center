import assert from 'node:assert/strict';
import test from 'node:test';
import { createChangeAuditRecord } from '../src/change-audit.mjs';

test('creates a non-executable audit record and redacts sensitive fields', () => {
  const record = createChangeAuditRecord({
    changeId: 'chg-001', actor: 'operator-a', approver: 'reviewer-b', snapshotId: '20260719-135254', scriptHash: 'verified',
    review: { changes: [{ field: 'maxNumSeqs', from: 2, to: 3 }], apiKey: 'must-not-appear' },
    now: () => '2026-07-19T08:00:00.000Z',
  });
  assert.equal(record.executionAllowed, false);
  assert.equal(record.executionResult, 'not-executed');
  assert.equal(record.recordedAt, '2026-07-19T08:00:00.000Z');
  assert.equal(record.review.apiKey, '[REDACTED]');
  assert.equal(Object.isFrozen(record), true);
});

test('requires the identifiers needed to tie a change to a verified snapshot', () => {
  assert.throws(() => createChangeAuditRecord({ actor: 'operator-a' }), /Missing required audit fields/);
});
