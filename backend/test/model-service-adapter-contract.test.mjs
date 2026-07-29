import assert from 'node:assert/strict';
import test from 'node:test';
import { compatibleAdapterForDraft, validateModelServiceAdapterManifest } from '../src/model-service-adapter-contract.mjs';

const integrity = `sha256:${'a'.repeat(64)}`;
const manifest = { schemaVersion: 1, id: 'adapter-openai-text', version: '1.0.0', templateId: 'openai-compatible-text', modelIds: ['example-text'], artifact: 'run.sh', integritySha256: integrity, actions: ['warmup', 'restart', 'stop'], healthCheck: { kind: 'service-health' }, resourceBudget: { estimatedMemoryMiB: 4096 }, rollback: { kind: 'restore-previous-registration' } };

test('generic model service adapter manifest accepts only fixed product fields', () => {
  assert.equal(validateModelServiceAdapterManifest(manifest).templateId, 'openai-compatible-text');
  assert.throws(() => validateModelServiceAdapterManifest({ ...manifest, artifact: 'other.sh' }), /Adapter artifact is invalid/);
  assert.throws(() => validateModelServiceAdapterManifest({ ...manifest, command: 'bash -c anything' }), /Invalid model service adapter manifest/);
  assert.throws(() => validateModelServiceAdapterManifest({ ...manifest, healthCheck: { kind: 'service-health', url: 'http://anything' } }), /Invalid adapter health check/);
});

test('measured resource profiles require an exact observed-plus-buffer budget', () => {
  const measured = validateModelServiceAdapterManifest({ ...manifest, resourceBudget: { estimatedMemoryMiB: 32768, basis: 'measured-profile', observedMemoryMiB: 27657, startupBufferMiB: 5111 } });
  assert.deepEqual(measured.resourceBudget, { estimatedMemoryMiB: 32768, basis: 'measured-profile', observedMemoryMiB: 27657, startupBufferMiB: 5111 });
  assert.throws(() => validateModelServiceAdapterManifest({ ...manifest, resourceBudget: { estimatedMemoryMiB: 32768, basis: 'measured-profile', observedMemoryMiB: 27657, startupBufferMiB: 4096 } }), /Measured adapter resource budget/);
  assert.throws(() => validateModelServiceAdapterManifest({ ...manifest, resourceBudget: { estimatedMemoryMiB: 4096, basis: 'configured-reservation', observedMemoryMiB: 2048, startupBufferMiB: 2048 } }), /Configured adapter resource budget/);
});

test('generic adapter compatibility binds both template and observed integrity', () => {
  const draft = { templateId: 'openai-compatible-text' };
  assert.equal(compatibleAdapterForDraft({ draft, modelId: 'example-text', manifest, observedIntegritySha256: integrity }).compatible, true);
  assert.equal(compatibleAdapterForDraft({ draft: { templateId: 'image-workflow' }, manifest, observedIntegritySha256: integrity }).reason, 'template-mismatch');
  assert.equal(compatibleAdapterForDraft({ draft, manifest, observedIntegritySha256: `sha256:${'b'.repeat(64)}` }).reason, 'integrity-mismatch');
  assert.equal(compatibleAdapterForDraft({ draft, modelId: 'another-model', manifest, observedIntegritySha256: integrity }).reason, 'model-mismatch');
});

test('exclusive service template permits only the fixed three-action control vocabulary', () => {
  const exclusive = validateModelServiceAdapterManifest({ ...manifest, id: 'adapter-exclusive-text', templateId: 'exclusive-text-inference', actions: ['warmup', 'restart', 'stop'] });
  assert.deepEqual(exclusive.actions, ['warmup', 'restart', 'stop']);
  assert.throws(() => validateModelServiceAdapterManifest({ ...exclusive, actions: ['warmup', 'shell'] }), /Adapter actions are invalid/);
});

test('adapter parameter declarations are bounded metadata, never commands or paths', () => {
  const parameterized = validateModelServiceAdapterManifest({ ...manifest, parameters: [
    { id: 'context-length', type: 'integer', minimum: 4096, maximum: 32768, step: 1024, risk: 'high' },
    { id: 'prefix-cache', type: 'boolean', minimum: null, maximum: null, step: null, risk: 'medium' },
  ] });
  assert.equal(parameterized.parameters.length, 2);
  assert.throws(() => validateModelServiceAdapterManifest({ ...manifest, parameters: [{ id: 'shell', type: 'integer', minimum: 1, maximum: 2, step: 1, risk: 'high', command: 'anything' }] }), /Invalid adapter parameter/);
  assert.throws(() => validateModelServiceAdapterManifest({ ...manifest, parameters: [{ id: 'context-length', type: 'integer', minimum: 4096, maximum: 4096, step: 1, risk: 'high' }] }), /Numeric adapter parameter range/);
});
