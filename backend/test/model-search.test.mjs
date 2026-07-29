import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelSearchProvider } from '../src/model-search.mjs';

const profile = Object.freeze({ id: 'profile-1', verification: { status: 'verified', evidence: { targetMachineSha256: `sha256:${'a'.repeat(64)}`, capabilitySnapshotSha256: `sha256:${'b'.repeat(64)}` } } });

test('model search emits opaque discovery results and can consume only its verified binding', async () => {
  const provider = createModelSearchProvider({
    sshTargetProvider: async () => 'dgx', activeProfileProvider: async () => profile,
    targetSupportProfileProvider: async () => ({ modelInventoryRoots: ['$HOME/ai/models', '$HOME/.cache/huggingface/hub'] }),
    executeRemote: async () => ['/home/test/ai/models/vision/vision-model-8b-fp8', '/home/test/ai/models/text/translator-model-30b-fp8', '/home/test/.cache/huggingface/hub/models--Example--Text-8B'].join('\n'),
  });
  const items = await provider.search('');
  assert.equal(items.length, 3);
  assert.equal(items.some((item) => item.displayName === 'translator-model-30b-fp8'), true);
  assert.equal(items.every((item) => item.modelId.startsWith('mdl-') && !item.modelId.includes('/')), true);
  assert.equal(Object.keys(items[0]).includes('locator'), false);
  const added = await provider.consume(items[0].resultId);
  assert.equal(added.modelId, items[0].modelId);
  await assert.rejects(() => provider.consume(items[0].resultId), /expired/);
});

test('does not invent model roots when the verified target has no active support profile', async () => {
  const provider = createModelSearchProvider({
    sshTargetProvider: async () => 'dgx', activeProfileProvider: async () => profile,
    targetSupportProfileProvider: async () => null,
    executeRemote: async () => { throw new Error('must not execute inventory without support profile'); },
  });
  await assert.rejects(() => provider.search(''), /support profile is not configured/);
});
