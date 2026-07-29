import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverCompatibleOperationLedger } from './operation-ledger-recovery.mjs';

test('quarantines an incompatible legacy ledger and recovers a fresh one', async () => {
  const moves = [];
  let created = 0;
  const result = await recoverCompatibleOperationLedger({
    filePath: 'C:/runtime/control-operation-ledger.json',
    now: () => new Date('2026-07-21T16:45:00.000Z'),
    createLedger: () => {
      created += 1;
      return { recover: async () => { if (created === 1) throw new Error('Invalid operation targetMachineSha256.'); return { recovered: null, hasRecoveryBlock: false }; } };
    },
    read: async () => JSON.stringify({ schemaVersion: 0, lease: null, operations: [{ status: 'succeeded' }] }),
    move: async (from, to) => { moves.push([from, to]); },
    report: () => {},
  });
  assert.equal(created, 2);
  assert.deepEqual(moves, [['C:/runtime/control-operation-ledger.json', 'C:/runtime/control-operation-ledger.json.incompatible-2026-07-21T16-45-00-000Z']]);
  assert.equal(result.recovery.hasRecoveryBlock, false);
  assert.match(result.quarantinedPath, /incompatible-/);
});

test('migrates an old active lease into a durable manual recovery block', async () => {
  let created = 0;
  let persisted = null;
  const result = await recoverCompatibleOperationLedger({
    filePath: 'C:/runtime/control-operation-ledger.json',
    createLedger: () => ({ recover: async () => { created += 1; if (created === 1) throw new Error('Invalid operation targetMachineSha256.'); return { recovered: null, hasRecoveryBlock: true }; } }),
    read: async () => JSON.stringify({ schemaVersion: 0, lease: { operationId: 'unknown' }, operations: [] }),
    move: async () => {}, write: async (_path, value) => { persisted = JSON.parse(value); }, report: () => {},
  });
  assert.equal(result.recovery.hasRecoveryBlock, true);
  assert.equal(persisted.operations[0].status, 'manual-required');
  assert.equal(persisted.operations[0].kind, 'ledger-migration');
});

test('does not bypass an active or stale ledger failure', async () => {
  await assert.rejects(recoverCompatibleOperationLedger({
    filePath: 'C:/runtime/control-operation-ledger.json',
    createLedger: () => ({ recover: async () => { throw new Error('Control operation ledger has a stale local lock and requires manual recovery.'); } }),
    move: async () => { throw new Error('must not move'); },
    report: () => {},
  }), /stale local lock/);
});
