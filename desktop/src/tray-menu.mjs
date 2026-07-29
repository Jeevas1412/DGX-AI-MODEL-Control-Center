const TRAY_LABELS = Object.freeze({
  'zh-CN': Object.freeze({ open: '打开 DGX AI Control Center', quit: '退出' }),
  'en-US': Object.freeze({ open: 'Open DGX AI Control Center', quit: 'Quit' }),
});

/** Builds the small native tray menu from the same two supported desktop locales. */
export function createTrayMenuTemplate({ language, onOpen, onQuit }) {
  const labels = TRAY_LABELS[language] ?? TRAY_LABELS['zh-CN'];
  if (typeof onOpen !== 'function' || typeof onQuit !== 'function') throw new Error('Tray menu actions are required.');
  return [
    { label: labels.open, click: onOpen },
    { type: 'separator' },
    { label: labels.quit, click: onQuit },
  ];
}
