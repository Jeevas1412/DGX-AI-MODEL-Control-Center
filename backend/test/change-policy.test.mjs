import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewNvfp4Change } from '../src/change-policy.mjs';

const baseline = {
  service: 'nvfp4',
  snapshotId: '20260719-135254',
  scriptHash: 'verified-hash-placeholder',
  current: { maxModelLen: 65536, gpuMemoryUtilization: 0.55, maxNumSeqs: 2, maxNumBatchedTokens: 16384, kvCacheDtype: 'fp8', prefixCaching: true, mtpTokens: 3 },
};

test('produces a high-risk review without granting execution authority', () => {
  const review = reviewNvfp4Change({ ...baseline, proposed: { maxNumSeqs: 3 } });
  assert.equal(review.approvedForExecution, false);
  assert.deepEqual(review.errors, []);
  assert.equal(review.changes.length, 1);
  assert.equal(review.changes[0].field, 'maxNumSeqs');
  assert.equal(review.changes[0].risk, 'high');
  assert.equal(review.changes[0].requiresRestart, true);
  assert.match(review.requiredGates.join(','), /independent-approval/);
});

test('rejects unallowlisted and command-like input', () => {
  const review = reviewNvfp4Change({ ...baseline, proposed: { port: 9000, maxNumSeqs: '3; reboot' } });
  assert.equal(review.approvedForExecution, false);
  assert.deepEqual(review.changes, []);
  assert.match(review.errors.join(' '), /not allowlisted/);
  assert.match(review.errors.join(' '), /Invalid value/);
});

test('rejects a service outside the candidate policy', () => {
  const review = reviewNvfp4Change({ ...baseline, service: 'vlm', proposed: { maxNumSeqs: 3 } });
  assert.equal(review.approvedForExecution, false);
  assert.match(review.errors.join(' '), /Only the nvfp4/);
});
