function requireWebContents(value) {
  if (!value || typeof value.on !== 'function' || typeof value.setWindowOpenHandler !== 'function') {
    throw new Error('Desktop webContents is required.');
  }
  return value;
}

function isTrustedDocumentUrl(value, trustedUrl) {
  try {
    const candidate = new URL(value);
    const trusted = new URL(trustedUrl);
    // The renderer uses hash-based routes under the same local document. A
    // fragment is never sent to the file loader, so compare the document
    // identity while continuing to reject query strings and every other URL.
    return candidate.protocol === trusted.protocol
      && candidate.host === trusted.host
      && candidate.pathname === trusted.pathname
      && candidate.search === ''
      && trusted.search === '';
  } catch {
    return false;
  }
}

export function isTrustedDesktopSender(event, { webContents, trustedUrl } = {}) {
  return Boolean(
    event
    && webContents
    && typeof trustedUrl === 'string'
    && trustedUrl
    && event.sender === webContents
    && isTrustedDocumentUrl(event.senderFrame?.url, trustedUrl),
  );
}

/** Blocks popups, cross-document navigation and embedded guest content. */
export function installDesktopWebContentsGuards(webContents, { trustedUrl, production = false } = {}) {
  const target = requireWebContents(webContents);
  if (typeof trustedUrl !== 'string' || !trustedUrl) throw new Error('Trusted desktop URL is required.');
  target.setWindowOpenHandler(() => ({ action: 'deny' }));
  target.on('will-navigate', (event, destination) => {
    if (!isTrustedDocumentUrl(destination, trustedUrl)) event.preventDefault();
  });
  target.on('will-attach-webview', (event) => event.preventDefault());
  if (production) {
    target.on('devtools-opened', () => {
      if (typeof target.closeDevTools === 'function') target.closeDevTools();
    });
  }
}

/** The desktop shell does not require browser permissions; deny them all. */
export function installDenyAllPermissionHandlers(electronSession) {
  if (!electronSession || typeof electronSession.setPermissionCheckHandler !== 'function' || typeof electronSession.setPermissionRequestHandler !== 'function') {
    throw new Error('Electron session permission handlers are required.');
  }
  electronSession.setPermissionCheckHandler(() => false);
  electronSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}
