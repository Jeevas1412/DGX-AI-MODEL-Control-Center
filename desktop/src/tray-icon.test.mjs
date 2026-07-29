import assert from 'node:assert/strict';
import test from 'node:test';
import { TRAY_ICON_DATA_URL, createTrayIcon } from './tray-icon.mjs';

test('tray icon is a non-empty PNG data URL and rejects decoder failures', () => {
  assert.match(TRAY_ICON_DATA_URL, /^data:image\/png;base64,/);
  const encoded = TRAY_ICON_DATA_URL.split(',', 2)[1];
  assert.deepEqual([...Buffer.from(encoded, 'base64').subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const image = { isEmpty: () => false };
  assert.equal(createTrayIcon({ createFromDataURL: () => image }), image);
  assert.throws(() => createTrayIcon({ createFromDataURL: () => ({ isEmpty: () => true }) }), /could not be decoded/);
});
