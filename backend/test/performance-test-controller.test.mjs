import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createChangeAuditStore } from '../src/change-audit-store.mjs';
import { createPerformanceTestDryRunController, validatePerformanceTestPlan } from '../src/performance-test-controller.mjs';

function plan(overrides = {}) {
  return {
    planId: 'p3-dryrun-20260719',
    tier: 'P3',
    templateId: 'p3-short-concurrency',
    targetServices: ['nvfp4'],
    concurrency: 10,
    durationSeconds: 60,
    windowStart: '2026-07-20T10:00:00.000+08:00',
    windowEnd: '2026-07-20T10:05:00.000+08:00',
    approvalId: 'approval-20260719',
    actor: 'operator-a',
    approver: 'approver-b',
    snapshotId: 'snapshot-20260719',
    scriptHash: 'script-hash-20260719',
    ...overrides,
  };
}

test('dry-run validates a bounded plan and writes only a non-executable local audit record', async () => {
  const records = [];
  const controller = createPerformanceTestDryRunController({
    auditStore: { append: async (record) => records.push(record) },
    now: () => '2026-07-19T11:30:00.000Z',
  });
  const result = await controller.dryRun(plan());
  assert.equal(result.executionAllowed, false);
  assert.equal(result.executionResult, 'not-executed');
  assert.equal(typeof controller.execute, 'undefined');
  assert.equal(records.length, 1);
  assert.equal(records[0].executionAllowed, false);
  assert.equal(records[0].review.plan.concurrency, 10);
  assert.deepEqual(result.resultContract.prohibitedFields, ['prompt', 'response', 'userId', 'ip', 'token', 'password', 'secret', 'rawLog']);
});

test('plan validator rejects unsupported fields and unsafe tier combinations', () => {
  assert.throws(() => validatePerformanceTestPlan(plan({ prompt: 'must never be accepted' })), /unsupported field/);
  assert.throws(() => validatePerformanceTestPlan(plan({ concurrency: 51 })), /Concurrency is not allowed/);
  assert.throws(() => validatePerformanceTestPlan(plan({ targetServices: ['nvfp4', 'vlm'] })), /Target services are not allowed/);
  assert.throws(() => validatePerformanceTestPlan(plan({ durationSeconds: 301 })), /Duration is not allowed/);
  assert.throws(() => validatePerformanceTestPlan(plan({ windowEnd: '2026-07-20T09:59:00.000+08:00' })), /ascending test window/);
});

test('P4 only accepts its fixed two-service minimal-joint contract', () => {
  const accepted = validatePerformanceTestPlan(plan({
    planId: 'p4-dryrun-20260719',
    tier: 'P4',
    templateId: 'p4-minimal-joint',
    targetServices: ['nvfp4', 'vlm'],
    concurrency: 1,
    durationSeconds: 120,
  }));
  assert.equal(accepted.tier, 'P4');
  assert.throws(() => validatePerformanceTestPlan({ ...accepted, targetServices: ['vlm', 'nvfp4'] }), /Target services are not allowed/);
});

test('dry-run can append its non-executable audit record to a local JSONL store', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-performance-dryrun-'));
  try {
    const auditStore = createChangeAuditStore({ filePath: join(directory, 'audit.jsonl') });
    const controller = createPerformanceTestDryRunController({ auditStore });
    await controller.dryRun(plan({ planId: 'p3-local-audit-20260719' }));
    const records = await auditStore.list();
    assert.equal(records.length, 1);
    assert.equal(records[0].executionResult, 'not-executed');
    assert.equal(records[0].review.kind, 'performance-test-dry-run');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
