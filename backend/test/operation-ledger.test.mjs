import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOperationLedger } from '../src/operation-ledger.mjs';

const operationId = '11111111-1111-4111-8111-111111111111';
const planId = '22222222-2222-4222-8222-222222222222';
const context = Object.freeze({
  profileId: 'profile-1', profileFingerprint: null, adapterId: 'legacy-dgx-service', adapterVersion: '1.0.0',
  targetMachineSha256: `sha256:${'a'.repeat(64)}`, capabilitySnapshotSha256: `sha256:${'b'.repeat(64)}`,
  adapterIntegrity: 'a'.repeat(64), planSnapshotDigest: 'b'.repeat(64),
});

test('operation ledger atomically persists a leased operation without commands or paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-operation-ledger-'));
  try {
    const filePath = join(directory, 'ledger.json');
    const ledger = createOperationLedger({ filePath });
    assert.equal(await ledger.hasBlockingOperation(), false);
    const started = await ledger.start({ id: operationId, kind: 'service-control', action: 'warmup', planId, context });
    assert.equal(started.status, 'running');
    assert.equal(await ledger.hasBlockingOperation(), true);
    const persisted = await readFile(filePath, 'utf8');
    assert.match(persisted, /"operationId"/);
    assert.doesNotMatch(persisted, /ssh|command|path/i);
    await ledger.transition(operationId, { status: 'succeeded', phase: 'completed', completed: true });
    assert.equal(await ledger.hasBlockingOperation(), false);
    assert.equal((await ledger.recover()).hasRecoveryBlock, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('operation ledger turns an in-flight lease into a durable manual recovery block after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-operation-ledger-'));
  try {
    const filePath = join(directory, 'ledger.json');
    await createOperationLedger({ filePath }).start({ id: operationId, kind: 'service-control', action: 'warmup', planId, context });
    const restarted = createOperationLedger({ filePath });
    const recovery = await restarted.recover();
    assert.equal(recovery.recovered.status, 'manual-required');
    assert.equal(recovery.recovered.phase, 'recovery-required');
    await assert.rejects(restarted.start({ id: '33333333-3333-4333-8333-333333333333', kind: 'service-control', action: 'warmup', planId, context }), /requires recovery/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('two ledger instances cannot both acquire a lease through a read-modify-write race', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-operation-ledger-race-'));
  try {
    const filePath = join(directory, 'ledger.json');
    const first = createOperationLedger({ filePath });
    const second = createOperationLedger({ filePath });
    const results = await Promise.allSettled([
      first.start({ id: operationId, kind: 'service-control', action: 'warmup', planId, context }),
      second.start({ id: '33333333-3333-4333-8333-333333333333', kind: 'service-control', action: 'warmup', planId, context }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    const document = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(document.operations.length, 1);
    const winningResult = results.find((result) => result.status === 'fulfilled');
    assert.equal(document.lease.operationId, winningResult.value.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('manual recovery validates its expected kind before mutating the durable ledger', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-operation-ledger-kind-'));
  try {
    const filePath = join(directory, 'ledger.json');
    const ledger = createOperationLedger({ filePath });
    await ledger.start({ id: operationId, kind: 'service-control', action: 'warmup', planId, context });
    await ledger.recover();
    await assert.rejects(ledger.resolveManual(operationId, 'managed-service'), /kind does not match/);
    assert.equal((await ledger.get(operationId)).status, 'manual-required');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('stale local lock fails closed instead of deleting a potentially replaced owner lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-operation-ledger-stale-'));
  try {
    const filePath = join(directory, 'ledger.json');
    const lockPath = `${filePath}.lock`;
    await writeFile(lockPath, 'manual recovery required\n', 'utf8');
    const old = new Date(Date.now() - 31_000);
    await utimes(lockPath, old, old);
    const ledger = createOperationLedger({ filePath });
    await assert.rejects(ledger.start({ id: operationId, kind: 'service-control', action: 'warmup', planId, context }), /stale local lock/);
    assert.equal(await readFile(lockPath, 'utf8'), 'manual recovery required\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
