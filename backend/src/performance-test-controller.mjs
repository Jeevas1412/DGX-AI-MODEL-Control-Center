import { createChangeAuditRecord } from './change-audit.mjs';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,95}$/u;
const ACTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/u;
const PLAN_FIELDS = new Set([
  'planId', 'tier', 'templateId', 'targetServices', 'concurrency', 'durationSeconds',
  'windowStart', 'windowEnd', 'approvalId', 'actor', 'approver', 'snapshotId', 'scriptHash',
]);

const TIER_RULES = Object.freeze({
  P0: Object.freeze({ templates: new Set(['p0-short-prompt']), concurrencies: new Set([1]), maxDurationSeconds: 60, services: ['nvfp4'] }),
  P1: Object.freeze({ templates: new Set(['p1-tool-call']), concurrencies: new Set([1]), maxDurationSeconds: 90, services: ['nvfp4'] }),
  P2: Object.freeze({ templates: new Set(['p2-long-context-cold', 'p2-long-context-hot']), concurrencies: new Set([1]), maxDurationSeconds: 180, services: ['nvfp4'] }),
  P3: Object.freeze({ templates: new Set(['p3-short-concurrency']), concurrencies: new Set([10, 20, 50]), maxDurationSeconds: 300, services: ['nvfp4'] }),
  P4: Object.freeze({ templates: new Set(['p4-minimal-joint']), concurrencies: new Set([1]), maxDurationSeconds: 120, services: ['nvfp4', 'vlm'] }),
});

const RESULT_CONTRACT = Object.freeze({
  allowedFields: Object.freeze(['id', 'testName', 'timestamp', 'successRate', 'avgTTFT', 'avgThroughput', 'p50', 'p95', 'p99', 'peakMemory', 'errorCount', 'errors', 'source']),
  prohibitedFields: Object.freeze(['prompt', 'response', 'userId', 'ip', 'token', 'password', 'secret', 'rawLog']),
  source: 'dgx-real',
});

function assertId(value, field) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`${field} is invalid.`);
}

function assertActor(value, field) {
  if (typeof value !== 'string' || !ACTOR_PATTERN.test(value)) throw new Error(`${field} is invalid.`);
}

function assertTimeWindow(start, end) {
  if (typeof start !== 'string' || typeof end !== 'string' || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) || Date.parse(start) >= Date.parse(end)) {
    throw new Error('A valid ascending test window is required.');
  }
}

function sameMembers(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Validates metadata only. Prompts, endpoints, commands, and credentials are intentionally not accepted. */
export function validatePerformanceTestPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Performance test plan must be an object.');
  if (Object.keys(plan).some((field) => !PLAN_FIELDS.has(field))) throw new Error('Performance test plan contains an unsupported field.');
  for (const field of ['planId', 'templateId', 'approvalId', 'snapshotId', 'scriptHash']) assertId(plan[field], field);
  for (const field of ['actor', 'approver']) assertActor(plan[field], field);
  if (!Object.hasOwn(TIER_RULES, plan.tier)) throw new Error('Performance tier is not allowed.');
  const rule = TIER_RULES[plan.tier];
  if (!rule.templates.has(plan.templateId)) throw new Error('Template is not allowed for this tier.');
  if (!rule.concurrencies.has(plan.concurrency)) throw new Error('Concurrency is not allowed for this tier.');
  if (!Number.isInteger(plan.durationSeconds) || plan.durationSeconds < 1 || plan.durationSeconds > rule.maxDurationSeconds) {
    throw new Error('Duration is not allowed for this tier.');
  }
  if (!Array.isArray(plan.targetServices) || !sameMembers(plan.targetServices, rule.services)) throw new Error('Target services are not allowed for this tier.');
  assertTimeWindow(plan.windowStart, plan.windowEnd);
  return Object.freeze(structuredClone(plan));
}

/**
 * Local-only dry-run controller. It has no executor, network client, SSH client, or child-process capability.
 * Future execution must be designed as a separate, authenticated component.
 */
export function createPerformanceTestDryRunController({ auditStore, now = () => new Date().toISOString() } = {}) {
  if (auditStore && typeof auditStore.append !== 'function') throw new Error('auditStore must expose append().');
  return Object.freeze({
    async dryRun(plan) {
      const safePlan = validatePerformanceTestPlan(plan);
      const auditRecord = createChangeAuditRecord({
        changeId: `dryrun-${safePlan.planId}`,
        actor: safePlan.actor,
        approver: safePlan.approver,
        snapshotId: safePlan.snapshotId,
        scriptHash: safePlan.scriptHash,
        review: {
          kind: 'performance-test-dry-run',
          plan: safePlan,
          executionBoundary: 'No network, SSH, child process, model request, or DGX write is available in this controller.',
        },
        now,
      });
      if (auditStore) await auditStore.append(auditRecord);
      return Object.freeze({
        plan: safePlan,
        auditRecord,
        resultContract: RESULT_CONTRACT,
        executionAllowed: false,
        executionResult: 'not-executed',
      });
    },
  });
}
