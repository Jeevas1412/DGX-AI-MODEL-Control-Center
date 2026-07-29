import assert from 'node:assert/strict';
import test from 'node:test';
import { createTargetSupportProfileProvider } from '../src/target-support-profile-provider.mjs';

const profile = {
  schemaVersion: 1,
  id: 'generic-linux-monitoring',
  version: '1.0.0',
  modelInventoryRoots: ['$HOME/models'],
  monitoring: { services: [] },
};

test('reads only the fixed target-local support profile and keeps its paths server-private', async () => {
  let request;
  const provider = createTargetSupportProfileProvider({
    sshTarget: 'dgx',
    execute: async (input) => {
      request = input;
      return JSON.stringify({ status: 'available', profile, observedIntegritySha256: `sha256:${'b'.repeat(64)}` });
    },
  });
  const item = await provider();
  assert.equal(item.public.id, 'generic-linux-monitoring');
  assert.equal(item.public.modelInventoryRoots, 1);
  assert.equal(item.modelInventoryRoots[0], '$HOME/models');
  assert.match(request.script, /\.dgx-ai-control-center/);
  assert.doesNotMatch(request.script, /jin_jeevas|\/home\//);
});

test('reports an absent target support profile without inventing a default target', async () => {
  const provider = createTargetSupportProfileProvider({ sshTarget: 'dgx', execute: async () => JSON.stringify({ status: 'not-configured' }) });
  assert.equal(await provider(), null);
});
