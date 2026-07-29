import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelServiceRegistry } from '../src/model-service-registry.mjs';

test('guided onboarding may correct a local draft template but never mutates a registered binding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-model-service-registry-'));
  try {
    let tick = 0;
    const registry = createModelServiceRegistry({ filePath: join(directory, 'services.json'), now: () => new Date(`2026-07-27T00:00:0${tick++}.000Z`) });
    const common = { catalogEntryId: '123e4567-e89b-12d3-a456-426614174001', targetMachineSha256: `sha256:${'a'.repeat(64)}`, displayName: 'Portable model' };
    const draft = await registry.addDraft({ ...common, templateId: 'openai-compatible-text' });
    const corrected = await registry.addDraft({ ...common, templateId: 'openai-compatible-vision' });
    assert.equal(corrected.id, draft.id);
    assert.equal(corrected.templateId, 'openai-compatible-vision');
    const registered = await registry.markRegistered({ id: draft.id, adapterId: 'adapter-vision', adapterVersion: '1.0.0', adapterIntegritySha256: `sha256:${'b'.repeat(64)}`, remoteRegistrationId: '123e4567-e89b-12d3-a456-426614174002' });
    const immutable = await registry.addDraft({ ...common, templateId: 'image-workflow' });
    assert.equal(immutable.status, 'registered');
    assert.equal(immutable.templateId, registered.templateId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('rebinds same-version registered services after a fixed adapter digest correction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-model-service-registry-rebind-'));
  try {
    const registry = createModelServiceRegistry({ filePath: join(directory, 'services.json'), now: () => new Date('2026-07-28T00:00:00.000Z') });
    const target = `sha256:${'a'.repeat(64)}`;
    const draft = await registry.addDraft({ catalogEntryId: '123e4567-e89b-12d3-a456-426614174001', targetMachineSha256: target, templateId: 'openai-compatible-text', displayName: 'Qwen' });
    await registry.markRegistered({ id: draft.id, adapterId: 'adapter-example-text', adapterVersion: '1.0.0', adapterIntegritySha256: `sha256:${'b'.repeat(64)}`, remoteRegistrationId: '123e4567-e89b-12d3-a456-426614174002' });
    const rebound = await registry.rebindRegisteredAdapter({ targetMachineSha256: target, adapterId: 'adapter-example-text', adapterVersion: '1.0.0', adapterIntegritySha256: `sha256:${'c'.repeat(64)}` });
    assert.equal(rebound.length, 1);
    assert.equal(rebound[0].adapterIntegritySha256, `sha256:${'c'.repeat(64)}`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
