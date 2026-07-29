import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelServiceAdapterDiscovery } from '../src/model-service-adapter-discovery.mjs';

const integrity = `sha256:${'c'.repeat(64)}`;
const manifest = {
  schemaVersion: 1,
  id: 'adapter-image-workflow',
  version: '1.0.0',
  templateId: 'image-workflow',
  modelIds: ['comfyui-workflow'],
  artifact: 'run.sh',
  integritySha256: integrity,
  actions: ['warmup', 'restart', 'stop'],
  healthCheck: { kind: 'workflow-ready' },
  resourceBudget: { estimatedMemoryMiB: 8192 },
  rollback: { kind: 'restore-previous-registration' },
};

test('adapter discovery exposes only fixed manifests bound to a verified artifact digest', async () => {
  const discover = createModelServiceAdapterDiscovery({
    sshTarget: 'dgx',
    execute: async () => JSON.stringify({ items: [
      { manifest, observedIntegritySha256: integrity },
      { manifest: { ...manifest, id: 'adapter-bad-digest' }, observedIntegritySha256: `sha256:${'d'.repeat(64)}` },
      { manifest: { ...manifest, command: 'unsafe' }, observedIntegritySha256: integrity },
    ] }),
  });
  const items = await discover();
  assert.deepEqual(items, [{
    id: 'adapter-image-workflow',
    version: '1.0.0',
    templateId: 'image-workflow',
    modelIds: ['comfyui-workflow'],
    integritySha256: integrity,
    actions: ['warmup', 'restart', 'stop'],
    healthCheck: { kind: 'workflow-ready' },
    resourceBudget: { estimatedMemoryMiB: 8192 },
  }]);
});
