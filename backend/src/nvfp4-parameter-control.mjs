import { randomUUID } from 'node:crypto';
import { reviewNvfp4Change } from './change-policy.mjs';

const EXPIRY_MS = 5 * 60 * 1000;
function ensureIdle(snapshot) {
  const active = Number(snapshot?.system?.activeRequests ?? snapshot?.metrics?.nvfp4?.activeRequests ?? 0);
  const queued = Number(snapshot?.system?.queuedRequests ?? snapshot?.metrics?.nvfp4?.queuedRequests ?? 0);
  if (active > 0 || queued > 0) throw new Error('NVFP4 has active or queued requests; parameter changes require an idle service.');
}
function sameValues(current, proposed) { return Object.entries(proposed).every(([key, value]) => current?.[key] === value); }

/** A two-confirmation controller. It only calls the closed adapter after plan creation. */
export function createNvfp4ParameterControl({ snapshotProvider, parameterAdapter, audit = async () => {} } = {}) {
  if (typeof snapshotProvider !== 'function' || !parameterAdapter) throw new Error('NVFP4 parameter control is unavailable.');
  const plans = new Map(); const rollbackPlans = new Map(); const operations = new Map();
  const requireReady = async () => { if (!(await parameterAdapter.status()).installed) throw new Error('The verified NVFP4 parameter adapter is not installed.'); };
  const createApplyPlan = async (proposed) => {
    await requireReady(); const snapshot = await snapshotProvider(); ensureIdle(snapshot); const remote = await parameterAdapter.snapshot();
    const review = reviewNvfp4Change({ service: 'nvfp4', current: remote.values, proposed, snapshotId: snapshot.generatedAt, scriptHash: remote.integritySha256 });
    if (review.errors.length) throw new Error('Parameter plan is invalid: ' + review.errors.join(' '));
    const plan = Object.freeze({ id: randomUUID(), action: 'apply', backupId: randomUUID(), proposed: Object.freeze({ ...proposed }), expectedIntegritySha256: remote.integritySha256, review, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + EXPIRY_MS).toISOString(), status: 'awaiting-second-confirmation', summary: '写入固定 NVFP4 启动参数并创建本地可回滚备份；不会启动、停止或重启模型。' }); plans.set(plan.id, plan); return plan;
  };
  const confirmApply = async (id) => {
    const plan = plans.get(id); if (!plan) throw new Error('Parameter application plan was not found.'); if (Date.now() >= Date.parse(plan.expiresAt)) { plans.delete(id); throw new Error('Parameter application plan has expired.'); }
    await requireReady(); ensureIdle(await snapshotProvider()); const current = await parameterAdapter.snapshot(); if (current.integritySha256 !== plan.expectedIntegritySha256) throw new Error('The fixed NVFP4 startup script changed after plan creation; create a new plan.');
    const applied = await parameterAdapter.apply({ expectedIntegritySha256: plan.expectedIntegritySha256, backupId: plan.backupId, proposed: plan.proposed }); const verified = await parameterAdapter.snapshot();
    if (verified.integritySha256 !== applied.afterIntegritySha256 || !sameValues(verified.values, plan.proposed)) throw new Error('Parameter write verification failed; do not restart the service.');
    const operation = Object.freeze({ id: randomUUID(), action: 'applied-pending-restart', backupId: plan.backupId, proposed: plan.proposed, beforeIntegritySha256: applied.beforeIntegritySha256, afterIntegritySha256: applied.afterIntegritySha256, createdAt: new Date().toISOString(), message: '启动参数已写入并经回读验证。模型没有被自动重启；请仅在需要生效时由客户端单独创建重启计划。' }); operations.set(operation.id, operation); plans.delete(id); await audit(operation); return operation;
  };
  const createRollbackPlan = async (operationId) => { const operation=operations.get(operationId); if (!operation) throw new Error('Parameter operation was not found.'); const plan=Object.freeze({id:randomUUID(),action:'rollback',operationId,backupId:operation.backupId,expectedIntegritySha256:operation.afterIntegritySha256,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+EXPIRY_MS).toISOString(),status:'awaiting-second-confirmation',summary:'恢复该次写入前的固定启动脚本备份；不会启动、停止或重启模型。'}); rollbackPlans.set(plan.id,plan); return plan; };
  const confirmRollback = async (id) => { const plan=rollbackPlans.get(id); if(!plan)throw new Error('Parameter rollback plan was not found.'); if(Date.now()>=Date.parse(plan.expiresAt)){rollbackPlans.delete(id);throw new Error('Parameter rollback plan has expired.');} await requireReady(); ensureIdle(await snapshotProvider()); const current=await parameterAdapter.snapshot(); if(current.integritySha256!==plan.expectedIntegritySha256)throw new Error('The startup script changed after this operation; rollback requires a new reviewed plan.'); const rolled=await parameterAdapter.rollback({backupId:plan.backupId}); const verified=await parameterAdapter.snapshot(); if(verified.integritySha256!==rolled.afterIntegritySha256)throw new Error('Rollback verification failed.'); const operation=Object.freeze({id:randomUUID(),action:'rolled-back',backupId:plan.backupId,beforeIntegritySha256:rolled.beforeIntegritySha256,afterIntegritySha256:rolled.afterIntegritySha256,createdAt:new Date().toISOString(),message:'启动参数已从固定备份恢复并经回读验证；模型没有被自动重启。'}); operations.set(operation.id,operation); rollbackPlans.delete(id); await audit(operation); return operation; };
  return Object.freeze({ createApplyPlan, confirmApply, createRollbackPlan, confirmRollback, listOperations: async () => [...operations.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)) });
}
