import { randomUUID } from 'node:crypto';
import { digestOperationSnapshot } from './verified-operation-context.mjs';

const PLAN_TTL_MS = 5 * 60 * 1000;
const MAX_OPERATIONS = 50;

function text(value, field, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`Invalid ${field}.`);
  return value;
}

function nowIso(now) {
  return now().toISOString();
}

function publicPlan(plan) {
  return Object.freeze({ id: plan.id, serviceId: plan.service.id, serviceName: plan.service.displayName, action: plan.action, risk: plan.risk, requiresIdle: plan.requiresIdle, summary: plan.summary, createdAt: plan.createdAt, expiresAt: plan.expiresAt, status: plan.status });
}

function publicOperation(operation) {
  return Object.freeze({ id: operation.id, planId: operation.planId, serviceId: operation.service.id, serviceName: operation.service.displayName, action: operation.action, status: operation.status, phase: operation.phase, message: operation.message, startedAt: operation.startedAt, completedAt: operation.completedAt });
}

function requireLegacyAdapter(adapter) {
  const required = ['getService', 'validateAction', 'assertPreconditions', 'describePlan', 'buildRemoteAction', 'verifyPostcondition'];
  const manifest = adapter?.manifest;
  if (!adapter || required.some((name) => typeof adapter[name] !== 'function') || !manifest || !/^[a-z0-9][a-z0-9-]{0,95}$/.test(manifest.id) || !/^\d+\.\d+\.\d+$/.test(manifest.version) || !/^[a-f0-9]{64}$/.test(manifest.integrity)) throw new Error('A registered legacy service adapter is required.');
  return adapter;
}

function requireOperationLedger(ledger) {
  if (!ledger || typeof ledger.start !== 'function' || typeof ledger.transition !== 'function') throw new Error('A durable operation ledger is required.');
  return ledger;
}

function asFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function assertCapacityPrecondition({ snapshot, service, action }) {
  // Only an unloaded service that may allocate a model is subject to this
  // guard. Stop actions do not allocate, and a missing measurement must not
  // be presented as a false capacity conclusion.
  if (action !== 'warmup' && action !== 'restart') return;
  const liveService = snapshot?.services?.find((item) => item?.id === service.id);
  if (!liveService || liveService.status === 'running') return;
  const estimatedMiB = asFiniteNumber(liveService.estimatedMemoryMiB);
  const allocatableMiB = asFiniteNumber(snapshot?.system?.modelMemoryBudget?.allocatableMiB);
  if (estimatedMiB === null || allocatableMiB === null || estimatedMiB <= allocatableMiB) return;
  const deficitMiB = estimatedMiB - allocatableMiB;
  throw new Error(`内存安全前检已阻止 ${service.displayName}：配置预留 ${(estimatedMiB / 1024).toFixed(1)} GiB，超过可安全分配 ${(allocatableMiB / 1024).toFixed(1)} GiB，预计缺口 ${(deficitMiB / 1024).toFixed(1)} GiB。`);
}

/**
 * Generic plan/confirm/observe state machine. Deployment-specific service
 * names, ports, scripts and request policies must be provided by a legacy
 * adapter; this module deliberately owns none of that knowledge.
 */
export function createLocalServiceController({ snapshotProvider, executeRemote, sshTarget, sshTargetProvider, adapter, operationLedger, operationContextProvider, now = () => new Date(), audit = async () => {} } = {}) {
  if (typeof snapshotProvider !== 'function' || typeof executeRemote !== 'function' || (typeof sshTarget !== 'string' && typeof sshTargetProvider !== 'function')) throw new Error('Local service controller requires a snapshot provider, remote executor and SSH target.');
  if (typeof operationContextProvider !== 'function') throw new Error('A verified operation context provider is required.');
  const legacyAdapter = requireLegacyAdapter(adapter);
  const ledger = requireOperationLedger(operationLedger);
  const plans = new Map();
  const operations = new Map();
  let runningOperationId = null;

  function trimOperations() {
    while (operations.size > MAX_OPERATIONS) operations.delete(operations.keys().next().value);
  }

  async function checkedSnapshot(service, action) {
    const snapshot = await snapshotProvider();
    await legacyAdapter.assertPreconditions({ snapshot, service, action });
    assertCapacityPrecondition({ snapshot, service, action });
    return Object.freeze({ snapshot, digest: digestOperationSnapshot(snapshot) });
  }

  async function assertAdapterCompatibility() {
    if (typeof legacyAdapter.assertCompatibility !== 'function') return;
    const resolvedSshTarget = typeof sshTargetProvider === 'function' ? await sshTargetProvider() : sshTarget;
    await legacyAdapter.assertCompatibility({ executeRemote, sshTarget: resolvedSshTarget });
  }

  function requireBoundContext(context, plan) {
    if (!context || typeof context !== 'object'
      || !/^sha256:[a-f0-9]{64}$/.test(context.targetMachineSha256 ?? '')
      || !/^sha256:[a-f0-9]{64}$/.test(context.capabilitySnapshotSha256 ?? '')
      || context.adapterId !== legacyAdapter.manifest.id || context.adapterVersion !== legacyAdapter.manifest.version || context.adapterIntegrity !== legacyAdapter.manifest.integrity || context.planSnapshotDigest !== plan.snapshotDigest) {
      throw new Error('Verified operation context does not match the active plan and registered adapter.');
    }
    return context;
  }

  async function createPlan({ serviceId, action }) {
    const service = legacyAdapter.getService(serviceId);
    const safeAction = legacyAdapter.validateAction(action);
    await assertAdapterCompatibility();
    const checked = await checkedSnapshot(service, safeAction);
    const createdAt = nowIso(now);
    const plan = {
      id: randomUUID(), service, action: safeAction, risk: safeAction === 'warmup' ? 'medium' : 'high', requiresIdle: safeAction !== 'warmup',
      summary: legacyAdapter.describePlan(service, safeAction), createdAt,
      expiresAt: new Date(now().getTime() + PLAN_TTL_MS).toISOString(), status: 'awaiting-confirmation', snapshotDigest: checked.digest,
    };
    plans.set(plan.id, plan);
    return publicPlan(plan);
  }

  async function runOperation(operation) {
    try {
      operation.phase = 'executing-fixed-adapter-action';
      operation.message = 'Executing the registered legacy adapter action.';
      await ledger.transition(operation.id, { status: operation.status, phase: operation.phase });
      const remoteAction = legacyAdapter.buildRemoteAction({ service: operation.service, action: operation.action });
      const resolvedSshTarget = typeof sshTargetProvider === 'function' ? await sshTargetProvider() : sshTarget;
      if (typeof resolvedSshTarget !== 'string' || !resolvedSshTarget.trim()) throw new Error('Verified active SSH target is unavailable.');
      await executeRemote({ sshTarget: resolvedSshTarget, script: remoteAction.script, timeoutMs: remoteAction.timeoutMs });
      operation.phase = 'verifying';
      operation.message = 'Re-reading registered health state.';
      await ledger.transition(operation.id, { status: operation.status, phase: operation.phase });
      const postSnapshot = await snapshotProvider();
      await legacyAdapter.verifyPostcondition({ snapshot: postSnapshot, service: operation.service, action: operation.action });
      operation.status = 'succeeded';
      operation.phase = 'completed';
      operation.message = 'Operation completed and the registered postcondition was verified.';
    } catch (error) {
      operation.status = 'failed';
      operation.phase = 'failed';
      operation.message = 'Operation did not complete. No unregistered recovery command was executed.';
      operation.errorCode = error instanceof Error ? error.message.slice(0, 160) : 'unknown';
    } finally {
      operation.completedAt = nowIso(now);
      runningOperationId = null;
      await ledger.transition(operation.id, { status: operation.status, phase: operation.phase, completed: true });
      await audit({ ...publicOperation(operation), errorCode: operation.errorCode ?? null });
    }
  }

  async function confirmPlan(planId) {
    const plan = plans.get(text(planId, 'planId', /^[a-f0-9-]{36}$/));
    if (!plan || plan.status !== 'awaiting-confirmation') throw new Error('Control plan is unavailable. Create a new plan.');
    if (new Date(plan.expiresAt).getTime() <= now().getTime()) {
      plan.status = 'expired';
      throw new Error('Control plan expired. Create a new plan.');
    }
    if (runningOperationId) throw new Error('Another local service operation is already running.');
    await assertAdapterCompatibility();
    const checked = await checkedSnapshot(plan.service, plan.action);
    plan.snapshotDigest = checked.digest;
    const context = requireBoundContext(await operationContextProvider({ plan: publicPlan(plan), adapter: legacyAdapter.manifest, planSnapshotDigest: plan.snapshotDigest }), plan);
    plan.status = 'confirmed';
    const operation = { id: randomUUID(), planId: plan.id, service: plan.service, action: plan.action, status: 'running', phase: 'queued', message: 'Confirmed and waiting for the fixed adapter action.', startedAt: nowIso(now), completedAt: null };
    await ledger.start({ id: operation.id, kind: 'service-control', action: operation.action, planId: operation.planId, context });
    operations.set(operation.id, operation);
    trimOperations();
    runningOperationId = operation.id;
    void runOperation(operation);
    return publicOperation(operation);
  }

  function getOperation(operationId) {
    const operation = operations.get(text(operationId, 'operationId', /^[a-f0-9-]{36}$/));
    if (!operation) throw new Error('Control operation was not found.');
    return publicOperation(operation);
  }

  async function listRecoveryRequired() {
    return ledger.listManualRequired('service-control');
  }

  async function resolveRecoveredOperation(operationId) {
    return ledger.resolveManual(operationId, 'service-control');
  }

  return Object.freeze({ createPlan, confirmPlan, getOperation, listRecoveryRequired, resolveRecoveredOperation });
}
