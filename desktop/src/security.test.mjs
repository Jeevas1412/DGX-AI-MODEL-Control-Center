import assert from 'node:assert/strict';
import test from 'node:test';
import { installDenyAllPermissionHandlers, installDesktopWebContentsGuards, isTrustedDesktopSender } from './security.mjs';

test('desktop security accepts only the current local renderer as an IPC sender', () => {
  const contents = {};
  const trustedUrl = 'file:///app/frontend/dist/index.html';
  assert.equal(isTrustedDesktopSender({ sender: contents, senderFrame: { url: trustedUrl } }, { webContents: contents, trustedUrl }), true);
  assert.equal(isTrustedDesktopSender({ sender: contents, senderFrame: { url: `${trustedUrl}#/setup` } }, { webContents: contents, trustedUrl }), true);
  assert.equal(isTrustedDesktopSender({ sender: contents, senderFrame: { url: `${trustedUrl}?redirect=https://example.invalid` } }, { webContents: contents, trustedUrl }), false);
  assert.equal(isTrustedDesktopSender({ sender: {}, senderFrame: { url: trustedUrl } }, { webContents: contents, trustedUrl }), false);
  assert.equal(isTrustedDesktopSender({ sender: contents, senderFrame: { url: 'https://example.invalid' } }, { webContents: contents, trustedUrl }), false);
});

test('desktop security blocks popups, foreign navigation, webviews and all permissions', () => {
  const handlers = new Map();
  let windowOpenHandler = null;
  const contents = {
    setWindowOpenHandler(handler) { windowOpenHandler = handler; },
    on(name, handler) { handlers.set(name, handler); },
  };
  installDesktopWebContentsGuards(contents, { trustedUrl: 'file:///app/frontend/dist/index.html' });
  assert.deepEqual(windowOpenHandler(), { action: 'deny' });
  let prevented = false;
  handlers.get('will-navigate')({ preventDefault() { prevented = true; } }, 'https://example.invalid');
  assert.equal(prevented, true);
  prevented = false;
  handlers.get('will-navigate')({ preventDefault() { prevented = true; } }, 'file:///app/frontend/dist/index.html#/setup');
  assert.equal(prevented, false);
  handlers.get('will-attach-webview')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);

  let checkHandler = null;
  let requestHandler = null;
  installDenyAllPermissionHandlers({
    setPermissionCheckHandler(handler) { checkHandler = handler; },
    setPermissionRequestHandler(handler) { requestHandler = handler; },
  });
  assert.equal(checkHandler(), false);
  let permissionResult = true;
  requestHandler(null, 'notifications', (result) => { permissionResult = result; });
  assert.equal(permissionResult, false);
});

test('production desktop security closes DevTools', () => {
  const handlers = new Map();
  let closes = 0;
  const contents = {
    setWindowOpenHandler() {},
    on(name, handler) { handlers.set(name, handler); },
    closeDevTools() { closes += 1; },
  };
  installDesktopWebContentsGuards(contents, { trustedUrl: 'file:///app/frontend/dist/index.html', production: true });
  handlers.get('devtools-opened')();
  assert.equal(closes, 1);
});
