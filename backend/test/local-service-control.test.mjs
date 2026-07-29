import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalServiceController } from '../src/local-service-control.mjs';
import { createLegacyCurrentDgxServiceAdapter } from '../src/legacy-adapters/current-dgx-service-adapter.mjs';

const idleSnapshot = () => ({
  metrics: { nvfp4: { runningRequests: 0, queuedRequests: 0 } },
  services: [
    { id: 'nvfp4', status: 'running' }, { id: 'vlm', status: 'running' }, { id: 'image', status: 'running' }, { id: 'proxy-8093', status: 'running' },
  ],
});
const adapter = createLegacyCurrentDgxServiceAdapter();
const operationLedger = Object.freeze({ start: async () => {}, transition: async () => {} });
const operationContextProvider = async ({ adapter: manifest, planSnapshotDigest }) => Object.freeze({ profileId: 'profile-1', profileFingerprint: null, targetMachineSha256: `sha256:${'a'.repeat(64)}`, capabilitySnapshotSha256: `sha256:${'b'.repeat(64)}`, adapterId: manifest.id, adapterVersion: manifest.version, adapterIntegrity: manifest.integrity, planSnapshotDigest });
const controlDependencies = Object.freeze({ adapter, operationLedger, operationContextProvider });
const compatibleOutput = (value) => value?.script?.includes('dgx-spark-current-services-v1') ? '{"compatible":true,"topology":"dgx-spark-current-services-v1"}' : '{}';

test('local service control accepts only fixed service/action pairs and produces a confirmation plan', async () => {
  const controller = createLocalServiceController({ snapshotProvider: idleSnapshot, executeRemote: async (value) => compatibleOutput(value), sshTarget: 'gdx', ...controlDependencies });
  const plan = await controller.createPlan({ serviceId: 'vlm', action: 'restart' });
  assert.equal(plan.serviceId, 'vlm');
  assert.equal(plan.action, 'restart');
  assert.equal(plan.status, 'awaiting-confirmation');
  assert.equal(plan.requiresIdle, true);
  await assert.rejects(controller.createPlan({ serviceId: 'vlm; reboot', action: 'restart' }), /Invalid serviceId/);
  await assert.rejects(controller.createPlan({ serviceId: 'vlm', action: 'shell' }), /Invalid action/);
});

test('NVFP4 stop and restart are blocked while real request metrics report activity', async () => {
  const controller = createLocalServiceController({ snapshotProvider: async () => ({ metrics: { nvfp4: { runningRequests: 1, queuedRequests: 2 } } }), executeRemote: async (value) => compatibleOutput(value), sshTarget: 'gdx', ...controlDependencies });
  await assert.rejects(controller.createPlan({ serviceId: 'nvfp4', action: 'stop' }), /3 active or queued/);
  const warmup = await controller.createPlan({ serviceId: 'nvfp4', action: 'warmup' });
  assert.equal(warmup.action, 'warmup');
});

test('unloaded model warmup and restart are blocked when the verified capacity budget has a deficit', async () => {
  const constrainedSnapshot = () => ({
    metrics: { nvfp4: { runningRequests: 0, queuedRequests: 0 } },
    system: { modelMemoryBudget: { allocatableMiB: 12126 } },
    services: [{ id: 'vlm', status: 'offline', estimatedMemoryMiB: 43590 }],
  });
  const controller = createLocalServiceController({ snapshotProvider: constrainedSnapshot, executeRemote: async (value) => compatibleOutput(value), sshTarget: 'gdx', ...controlDependencies });
  await assert.rejects(controller.createPlan({ serviceId: 'vlm', action: 'warmup' }), /内存安全前检已阻止 VLM.*30\.7 GiB/);
  await assert.rejects(controller.createPlan({ serviceId: 'vlm', action: 'restart' }), /内存安全前检已阻止 VLM/);
});

test('capacity preflight does not block an unloaded service when the budget is absent or sufficient', async () => {
  const sufficientSnapshot = () => ({
    metrics: { nvfp4: { runningRequests: 0, queuedRequests: 0 } },
    system: { modelMemoryBudget: { allocatableMiB: 50000 } },
    services: [{ id: 'vlm', status: 'offline', estimatedMemoryMiB: 43590 }],
  });
  const controller = createLocalServiceController({ snapshotProvider: sufficientSnapshot, executeRemote: async (value) => compatibleOutput(value), sshTarget: 'gdx', ...controlDependencies });
  assert.equal((await controller.createPlan({ serviceId: 'vlm', action: 'warmup' })).status, 'awaiting-confirmation');
});

test('confirmed operations execute only an internally generated fixed script and expose progress', async () => {
  let input;
  let resolveExecution;
  const execution = new Promise((resolve) => { resolveExecution = resolve; });
  const controller = createLocalServiceController({
    snapshotProvider: idleSnapshot,
    executeRemote: async (value) => { if (value.script.includes('dgx-spark-current-services-v1')) return compatibleOutput(value); input = value; await execution; return '{"ok":true}'; },
    sshTarget: 'gdx',
    ...controlDependencies,
  });
  const plan = await controller.createPlan({ serviceId: 'image', action: 'restart' });
  const operation = await controller.confirmPlan(plan.id);
  assert.equal(operation.status, 'running');
  assert.match(input.script, /serve_img\.sh/);
  assert.match(input.script, /assert_no_connections 8188/);
  assert.equal(input.sshTarget, 'gdx');
  resolveExecution();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.getOperation(operation.id).status, 'succeeded');
});

test('controller resolves the SSH target only from its injected verified-profile provider at confirmation time', async () => {
  let captured;
  const controller = createLocalServiceController({
    snapshotProvider: idleSnapshot,
    executeRemote: async (value) => { if (value.script.includes('dgx-spark-current-services-v1')) return compatibleOutput(value); captured = value; return '{"ok":true}'; },
    sshTargetProvider: async () => 'verified-profile-alias',
    ...controlDependencies,
  });
  const plan = await controller.createPlan({ serviceId: 'image', action: 'warmup' });
  const operation = await controller.confirmPlan(plan.id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(captured.sshTarget, 'verified-profile-alias');
  assert.equal(controller.getOperation(operation.id).status, 'succeeded');
});

test('only one fixed local service operation can run at a time', async () => {
  let resolveExecution;
  const execution = new Promise((resolve) => { resolveExecution = resolve; });
  const controller = createLocalServiceController({ snapshotProvider: idleSnapshot, executeRemote: async (value) => value.script.includes('dgx-spark-current-services-v1') ? compatibleOutput(value) : execution, sshTarget: 'gdx', ...controlDependencies });
  const first = await controller.createPlan({ serviceId: 'proxy-8093', action: 'restart' });
  await controller.confirmPlan(first.id);
  const second = await controller.createPlan({ serviceId: 'vlm', action: 'stop' });
  await assert.rejects(controller.confirmPlan(second.id), /already running/);
  resolveExecution('{}');
});

test('operation is marked failed when the adapter postcondition does not match the re-read snapshot', async () => {
  const failedSnapshot = () => ({ metrics: { nvfp4: { runningRequests: 0, queuedRequests: 0 } }, services: [{ id: 'image', status: 'offline' }] });
  const controller = createLocalServiceController({ snapshotProvider: failedSnapshot, executeRemote: async (value) => value.script.includes('dgx-spark-current-services-v1') ? compatibleOutput(value) : '{"ok":true}', sshTarget: 'gdx', ...controlDependencies });
  const plan = await controller.createPlan({ serviceId: 'image', action: 'restart' });
  const operation = await controller.confirmPlan(plan.id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.getOperation(operation.id).status, 'failed');
});

test('controller rejects a context that does not match its re-read plan snapshot or registered adapter', async () => {
  const mismatchedContext = async ({ adapter: manifest, planSnapshotDigest }) => ({ profileId: 'profile-1', profileFingerprint: null, targetMachineSha256: `sha256:${'a'.repeat(64)}`, capabilitySnapshotSha256: `sha256:${'b'.repeat(64)}`, adapterId: manifest.id, adapterVersion: manifest.version, adapterIntegrity: 'a'.repeat(64), planSnapshotDigest });
  const controller = createLocalServiceController({ snapshotProvider: idleSnapshot, executeRemote: async (value) => compatibleOutput(value), sshTarget: 'gdx', adapter, operationLedger, operationContextProvider: mismatchedContext });
  const plan = await controller.createPlan({ serviceId: 'image', action: 'warmup' });
  await assert.rejects(controller.confirmPlan(plan.id), /does not match the active plan/);
});

test('controller refuses any control path without durable ledger and verified operation context dependencies', () => {
  assert.throws(() => createLocalServiceController({ snapshotProvider: idleSnapshot, executeRemote: async () => '{}', sshTarget: 'gdx', adapter }), /verified operation context/);
  assert.throws(() => createLocalServiceController({ snapshotProvider: idleSnapshot, executeRemote: async () => '{}', sshTarget: 'gdx', adapter, operationContextProvider }), /durable operation ledger/);
});
