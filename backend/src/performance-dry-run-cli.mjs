import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createChangeAuditStore } from './change-audit-store.mjs';
import { createPerformanceTestDryRunController } from './performance-test-controller.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const inputPath = argument('--plan');
const auditPath = argument('--audit');
if (!inputPath || !auditPath || !basename(inputPath).endsWith('.json')) {
  throw new Error('Usage: node performance-dry-run-cli.mjs --plan <local-plan.json> --audit <local-audit.jsonl>');
}

// This CLI has only local filesystem capability and invokes dryRun() only.
const plan = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
const controller = createPerformanceTestDryRunController({
  auditStore: createChangeAuditStore({ filePath: resolve(auditPath) }),
});
const result = await controller.dryRun(plan);
console.log(JSON.stringify({ status: result.executionResult, planId: result.plan.planId, auditChangeId: result.auditRecord.changeId }));
