import { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, shell, Tray } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createDesktopPreferenceStore } from './preferences.mjs';
import { createDesktopDirectAdapter } from './api-bridge.mjs';
import { createTrayMenuTemplate } from './tray-menu.mjs';
import { createTrayIcon } from './tray-icon.mjs';
import { installDenyAllPermissionHandlers, installDesktopWebContentsGuards, isTrustedDesktopSender } from './security.mjs';
import { resolveRuntimeChannel, resolveUserDataDirectory } from './environment.mjs';
import { recoverCompatibleOperationLedger } from './operation-ledger-recovery.mjs';
import { createRemoteDesktopCredentialVault } from './remote-desktop-credential-vault.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDirectory, '../..');
const runtimeChannel = resolveRuntimeChannel({ packaged: app.isPackaged });
app.setPath('userData', resolveUserDataDirectory({ appDataDirectory: app.getPath('appData'), channel: runtimeChannel }));
// Production code and renderer bytes are loaded from app.asar. Runtime data
// remains in the per-user directory; no executable backend source is loaded
// from the mutable resources directory.
const applicationResources = app.isPackaged ? app.getAppPath() : projectRoot;
const frontendIndex = join(applicationResources, 'frontend', 'dist', 'index.html');
const trustedDesktopUrl = pathToFileURL(frontendIndex).href;
const backendModuleUrl = pathToFileURL(join(applicationResources, 'backend', 'src', 'server.mjs')).href;
const runtimePathsModuleUrl = pathToFileURL(join(applicationResources, 'backend', 'src', 'runtime-paths.mjs')).href;
const operationLedgerModuleUrl = pathToFileURL(join(applicationResources, 'backend', 'src', 'operation-ledger.mjs')).href;
let mainWindow = null;
let tray = null;
let isExplicitQuit = false;
let preferenceStore = null;
let currentPreferences = null;
let localApplicationCore = null;
let localBackendBridge = null;
let runtimePaths = null;
let isShuttingDown = false;
let remoteDesktopCredentialVault = null;

function trayIcon() {
  return createTrayIcon(nativeImage);
}

async function preferences() {
  return currentPreferences;
}

async function startLocalApplicationCore() {
  const { createConfiguredApplicationCore } = await import(backendModuleUrl);
  const { createRuntimePaths, migrateConnectionProfile, migrateLegacyRuntimeData } = await import(runtimePathsModuleUrl);
  const { createOperationLedger } = await import(operationLedgerModuleUrl);
  const config = {
    // Desktop default is deliberately local-only. A remote session is created
    // later only from an explicitly verified active profile.
    dgxReadOnlyEnabled: currentPreferences?.remoteReadOnlySessionEnabled === true,
    dgxSshTarget: '',
    dgxSnapshotCacheMs: 2500,
    corsOrigins: [],
    apiToken: '',
    localControlEnabled: currentPreferences?.remoteReadOnlySessionEnabled === true && currentPreferences?.remoteControlSessionEnabled === true,
  };
  runtimePaths = createRuntimePaths({ baseDirectory: app.getPath('userData'), appDirectory: '' });
  await migrateLegacyRuntimeData({ runtimePaths, legacyDirectory: join(applicationResources, 'backend', 'data') });
  // Electron does not expose a `localAppData` path key on every supported
  // runtime. The Windows environment variable is the canonical LocalAppData
  // location used by the prior local monitoring runtime.
  const previousRuntimePaths = createRuntimePaths({ baseDirectory: process.env.LOCALAPPDATA });
  await migrateConnectionProfile({ runtimePaths, sourcePath: previousRuntimePaths.connectionProfiles });
  await recoverCompatibleOperationLedger({ createLedger: createOperationLedger, filePath: runtimePaths.operationLedger });
  localApplicationCore = createConfiguredApplicationCore(config, { runtimePaths });
  localBackendBridge = createDesktopDirectAdapter({ dispatch: localApplicationCore.dispatch });
}

async function stopLocalApplicationCore() {
  localApplicationCore = null;
  localBackendBridge = null;
  runtimePaths = null;
}

async function restartLocalApplicationCore() {
  await stopLocalApplicationCore();
  await startLocalApplicationCore();
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

function quitFromTray() {
  isExplicitQuit = true;
  app.quit();
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(createTrayMenuTemplate({
    language: currentPreferences?.language,
    onOpen: showWindow,
    onQuit: quitFromTray,
  })));
}

function buildTray() {
  if (!tray) {
    tray = new Tray(trayIcon());
    tray.setToolTip('DGX AI Control Center');
    tray.on('click', showWindow);
  }
  refreshTrayMenu();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    icon: trayIcon(),
    webPreferences: {
      preload: join(moduleDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  installDesktopWebContentsGuards(mainWindow.webContents, { trustedUrl: trustedDesktopUrl, production: app.isPackaged });
  installDenyAllPermissionHandlers(mainWindow.webContents.session);
  mainWindow.removeMenu();
  mainWindow.once('ready-to-show', showWindow);
  mainWindow.on('close', (event) => {
    if (isExplicitQuit || !currentPreferences.keepRunningWhenWindowClosed) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(frontendIndex);
}

function handleStartupFailure() {
  localApplicationCore = null;
  localBackendBridge = null;
  const window = new BrowserWindow({ width: 520, height: 300, resizable: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.removeMenu();
  window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><title>DGX AI Control Center</title><body style="font-family:Segoe UI;padding:28px"><h2>应用未能完成启动</h2><p>错误代码：DESKTOP_STARTUP_FAILED</p><p>请退出后重试；如问题持续，请通过应用支持渠道提交该错误代码。</p><button onclick="window.close()">退出</button></body>'));
}

function isTrustedApiSender(event) {
  return isTrustedDesktopSender(event, { webContents: mainWindow?.webContents, trustedUrl: trustedDesktopUrl });
}

function registerIpc() {
  ipcMain.handle('desktop:preferences:get', (event) => {
    if (!isTrustedApiSender(event)) throw new Error('Untrusted desktop IPC sender.');
    return preferences();
  });
  ipcMain.handle('desktop:preferences:update', async (event, patch) => {
    if (!isTrustedApiSender(event)) throw new Error('Untrusted desktop IPC sender.');
    const previousPreferences = currentPreferences;
    currentPreferences = await preferenceStore.update(patch);
    try {
      if (previousPreferences.remoteReadOnlySessionEnabled !== currentPreferences.remoteReadOnlySessionEnabled || previousPreferences.remoteControlSessionEnabled !== currentPreferences.remoteControlSessionEnabled) await restartLocalApplicationCore();
    } catch (error) {
      currentPreferences = await preferenceStore.save(previousPreferences);
      await restartLocalApplicationCore();
      throw error;
    }
    refreshTrayMenu();
    return currentPreferences;
  });
  ipcMain.handle('desktop:runtime:get', async (event) => {
    if (!isTrustedApiSender(event)) throw new Error('Untrusted desktop IPC sender.');
    return Object.freeze({
      channel: 'desktop',
      environment: runtimeChannel,
      platform: process.platform,
      keepRunningWhenWindowClosed: currentPreferences.keepRunningWhenWindowClosed,
      remoteReadOnlySessionEnabled: currentPreferences.remoteReadOnlySessionEnabled,
      remoteControlSessionEnabled: currentPreferences.remoteControlSessionEnabled,
      backend: localApplicationCore ? 'direct-ipc' : 'stopped',
      shortcutSupport: 'desktop-only',
      remoteDesktopCredentialStorage: remoteDesktopCredentialVault ? 'windows-protected' : 'unavailable',
    });
  });
  ipcMain.handle('desktop:shortcut:create', async (event) => {
    if (!isTrustedApiSender(event)) throw new Error('Untrusted desktop IPC sender.');
    if (!app.isPackaged) return { status: 'unsupported', message: '桌面快捷方式只能由已安装的应用创建。' };
    const shortcutPath = join(app.getPath('desktop'), 'DGX AI Control Center.lnk');
    const created = shell.writeShortcutLink(shortcutPath, 'create', {
      target: process.execPath,
      cwd: dirname(process.execPath),
      description: 'DGX AI Control Center',
      icon: process.execPath,
      iconIndex: 0,
    });
    if (!created) return { status: 'failed', message: 'Windows 未能创建桌面快捷方式。' };
    return { status: 'created', message: `已创建桌面快捷方式：${shortcutPath}` };
  });
  ipcMain.handle('desktop:api:request', async (event, request) => {
    if (!isTrustedApiSender(event)) throw new Error('Untrusted desktop API sender.');
    if (!localBackendBridge) throw new Error('Desktop backend is unavailable.');
    return localBackendBridge.request(request);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    preferenceStore = createDesktopPreferenceStore({ filePath: join(app.getPath('userData'), 'preferences.json') });
    currentPreferences = await preferenceStore.load();
    // Availability only: no credentials are generated, read, exposed or
    // written until a future confirmed RDP deployment flow requests it.
    try {
      remoteDesktopCredentialVault = createRemoteDesktopCredentialVault({ filePath: join(app.getPath('userData'), 'remote-desktop-credentials.json'), safeStorage });
    } catch {
      remoteDesktopCredentialVault = null;
    }
    await startLocalApplicationCore();
    registerIpc();
    buildTray();
    createMainWindow();
  }).catch(handleStartupFailure);
}

app.on('activate', () => { if (mainWindow) showWindow(); else createMainWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', (event) => {
  isExplicitQuit = true;
  if (isShuttingDown) return;
  isShuttingDown = true;
  event.preventDefault();
  stopLocalApplicationCore().finally(() => app.exit(0));
});
