import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrayMenuTemplate } from './tray-menu.mjs';

test('tray menu uses only the selected desktop locale and safe fixed actions', () => {
  const onOpen = () => undefined;
  const onQuit = () => undefined;
  const english = createTrayMenuTemplate({ language: 'en-US', onOpen, onQuit });
  const chinese = createTrayMenuTemplate({ language: 'zh-CN', onOpen, onQuit });
  assert.deepEqual(english.map((item) => item.label ?? item.type), ['Open DGX AI Control Center', 'separator', 'Quit']);
  assert.deepEqual(chinese.map((item) => item.label ?? item.type), ['打开 DGX AI Control Center', 'separator', '退出']);
  assert.equal(english[0].click, onOpen);
  assert.equal(english[2].click, onQuit);
});

test('tray menu falls back to Chinese and rejects missing actions', () => {
  const template = createTrayMenuTemplate({ language: 'unsupported', onOpen: () => undefined, onQuit: () => undefined });
  assert.equal(template[0].label, '打开 DGX AI Control Center');
  assert.throws(() => createTrayMenuTemplate({ language: 'en-US', onOpen: null, onQuit: () => undefined }), /actions/);
});
