import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelServiceRegistrar } from '../src/model-service-registration.mjs';

test('managed service registration writes only the fixed product registry through an injected transport', async () => {
  let request = null;
  const registrar = createModelServiceRegistrar({
    sshTargetProvider: async () => 'dgx',
    execute: async (input) => { request = input; return JSON.stringify({ status: 'registered', registrationId: '123e4567-e89b-12d3-a456-426614174000' }); },
    now: () => new Date('2026-07-22T00:00:00.000Z'),
  });
  const registered = await registrar.register({
    registrationId: '123e4567-e89b-12d3-a456-426614174000', configurationId: '123e4567-e89b-12d3-a456-426614174001', catalogEntryId: '123e4567-e89b-12d3-a456-426614174002', targetMachineSha256: `sha256:${'a'.repeat(64)}`, templateId: 'openai-compatible-text', displayName: 'Text model', adapter: { id: 'adapter-text', version: '1.0.0', integritySha256: `sha256:${'b'.repeat(64)}` },
  });
  assert.equal(registered.status, 'registered');
  assert.equal(request.sshTarget, 'dgx');
  assert.match(request.script, /\.dgx-ai-control-center\/registrations/);
  assert.doesNotMatch(request.script, /run\.sh|switch-from|systemctl/);
});
