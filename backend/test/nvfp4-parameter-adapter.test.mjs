import assert from 'node:assert/strict';
import test from 'node:test';
import { createNvfp4ParameterAdapter, NVFP4_PARAMETER_ADAPTER_ID, NVFP4_PARAMETER_ADAPTER_INTEGRITY, NVFP4_PARAMETER_ADAPTER_VERSION } from '../src/nvfp4-parameter-adapter.mjs';

test('NVFP4 parameter adapter deploys only fixed versioned assets and verifies their digest', async () => {
  const calls = [];
  const adapter = createNvfp4ParameterAdapter({
    sshTargetProvider: async () => 'dgx',
    execute: async (input) => {
      calls.push(input);
      if (calls.length === 1) return JSON.stringify({ status: 'deployed', id: NVFP4_PARAMETER_ADAPTER_ID, version: NVFP4_PARAMETER_ADAPTER_VERSION, integritySha256: NVFP4_PARAMETER_ADAPTER_INTEGRITY });
      return JSON.stringify({ present: true, manifest: { id: NVFP4_PARAMETER_ADAPTER_ID, version: NVFP4_PARAMETER_ADAPTER_VERSION, integritySha256: NVFP4_PARAMETER_ADAPTER_INTEGRITY }, observedIntegritySha256: NVFP4_PARAMETER_ADAPTER_INTEGRITY });
    },
  });
  const status = await adapter.deploy();
  assert.equal(status.installed, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].script, /parameter-adapters\/nvfp4-startup-parameters/);
  assert.doesNotMatch(calls[0].script, /docker|systemctl|serve_vlm|serve_img/);
});

test('NVFP4 parameter adapter marks malformed or mismatched discovery as unavailable', async () => {
  const adapter = createNvfp4ParameterAdapter({ sshTargetProvider: async () => 'dgx', execute: async () => JSON.stringify({ present: true, manifest: { id: NVFP4_PARAMETER_ADAPTER_ID, version: '9.9.9', integritySha256: NVFP4_PARAMETER_ADAPTER_INTEGRITY }, observedIntegritySha256: NVFP4_PARAMETER_ADAPTER_INTEGRITY }) });
  assert.equal((await adapter.status()).installed, false);
});
