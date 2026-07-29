import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelCatalog } from '../src/model-catalog.mjs';

test('model catalog persists generic public model metadata locally', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-model-catalog-'));
  try {
    const catalog = createModelCatalog({ filePath: join(directory, 'model-catalog.json'), now: () => new Date('2026-07-21T00:00:00.000Z') });
    const targetMachineSha256 = `sha256:${'a'.repeat(64)}`;
    assert.deepEqual(await catalog.load(), { schemaVersion: 3, entries: [] });
    const entry = await catalog.add({ source: 'dgx-local', modelId: 'mdl-1234567890abcdef1234567890abcdef', displayName: 'Qwen3-8B', targetMachineSha256 });
    assert.equal(entry.source, 'dgx-local');
    assert.equal(entry.modelId, 'mdl-1234567890abcdef1234567890abcdef');
    assert.equal((await catalog.add({ source: 'dgx-local', modelId: 'mdl-1234567890abcdef1234567890abcdef', displayName: 'Different title', targetMachineSha256 })).id, entry.id);
    assert.equal((await catalog.load()).entries[0].displayName, 'Qwen3-8B');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('model catalog rejects untrusted sources, commands and malformed identifiers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-model-catalog-'));
  try {
    const catalog = createModelCatalog({ filePath: join(directory, 'model-catalog.json') });
    const targetMachineSha256 = `sha256:${'a'.repeat(64)}`;
    await assert.rejects(() => catalog.add({ source: 'shell', modelId: 'mdl-1234567890abcdef1234567890abcdef', displayName: 'x', targetMachineSha256 }), /Unsupported model source/);
    await assert.rejects(() => catalog.add({ source: 'dgx-local', modelId: 'Qwen;rm', displayName: 'x', targetMachineSha256 }), /Invalid model catalog modelId/);
    await assert.rejects(() => catalog.add({ source: 'dgx-local', modelId: 'mdl-1234567890abcdef1234567890abcdef', displayName: 'x\ncommand', targetMachineSha256 }), /Invalid model catalog displayName/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('model catalog preserves the pre-release fixed-model register and starts a portable empty catalog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dgx-model-catalog-'));
  const filePath = join(directory, 'model-catalog.json');
  try {
    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, entries: [] }), 'utf8');
    const catalog = createModelCatalog({ filePath });
    assert.deepEqual(await catalog.load(), { schemaVersion: 3, entries: [] });
    assert.equal((await readdir(directory)).some((name) => name.startsWith('model-catalog.json.legacy-v1-')), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
