import path from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { APP_ORIGIN, buildCsp, loadRuntimeConfig } from './config';
import { IPC } from './ipc';
import { buildMenu } from './menu';
import { handleAppProtocol, registerAppScheme } from './protocol';
import { getUpdateStatus, initAutoUpdater, installUpdate } from './updater';
import { loadWindowState, trackWindowState } from './windowState';

// dist/main/main.js -> dist/ and package root
const DIST_DIR = path.join(__dirname, '..');
const APP_ROOT = path.join(DIST_DIR, '..');
const WEB_ROOT = path.join(APP_ROOT, 'web');
const PRELOAD = path.join(DIST_DIR, 'preload', 'preload.js');

/** Origin string for any URL, including non-special schemes like app://. */
function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Dev server is honoured only in unpackaged runs and only on loopback, so
 * an environment variable can never redirect a shipped app elsewhere.
 */
function resolveDevServerUrl(): string | null {
  const raw = process.env.LUNEX_DEV_SERVER_URL;
  if (app.isPackaged || !raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:') return null;
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return null;
    return u.toString();
  } catch {
    return null;
  }
}

const devServerUrl = resolveDevServerUrl();
const startUrl = devServerUrl ?? `${APP_ORIGIN}/`;
const trustedOrigin = originOf(startUrl) as string;
const devToolsEnabled = !app.isPackaged;

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
  } catch {
    return false;
  }
}

function openExternalSafe(url: string): void {
  if (isHttpUrl(url)) void shell.openExternal(url);
}

let mainWindow: BrowserWindow | null = null;

/** IPC is accepted only from the main window's top frame on our origin. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return (
    mainWindow !== null &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    frame !== null &&
    frame === event.sender.mainFrame &&
    originOf(frame.url) === trustedOrigin
  );
}

function createWindow(): BrowserWindow {
  const state = loadWindowState();
  const win = new BrowserWindow({
    ...state.bounds,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'Lunex',
    backgroundColor: '#1A1A1A',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      spellcheck: false,
      devTools: devToolsEnabled,
      additionalArguments: [`--lunex-version=${app.getVersion()}`],
    },
  });
  if (state.maximized) win.maximize();
  trackWindowState(win);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  void win.loadURL(startUrl);
  return win;
}

function hardenWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());

    // Same-origin navigations only; http(s) links go to the default browser.
    const guard = (e: Electron.Event, url: string): void => {
      if (originOf(url) === trustedOrigin) return;
      e.preventDefault();
      openExternalSafe(url);
    };
    contents.on('will-navigate', guard);
    contents.on('will-redirect', (e, url, _inPlace, isMainFrame) => {
      if (isMainFrame) guard(e, url);
    });

    contents.setWindowOpenHandler(({ url }) => {
      openExternalSafe(url);
      return { action: 'deny' };
    });
  });
}

function hardenSession(): void {
  const ses = session.defaultSession;
  const allowed = new Set(['clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = originOf(details.requestingUrl ?? wc.getURL());
    callback(allowed.has(permission) && origin === trustedOrigin);
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return allowed.has(permission) && originOf(requestingOrigin) === trustedOrigin;
  });
  ses.setDevicePermissionHandler(() => false);
}

function registerIpc(): void {
  ipcMain.handle(IPC.openExternal, async (event, url: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender');
    if (!isHttpUrl(url)) throw new Error('Only http(s) URLs can be opened');
    await shell.openExternal(url);
  });
  ipcMain.handle(IPC.getUpdateStatus, (event) => {
    if (!isTrustedSender(event)) return null;
    return getUpdateStatus();
  });
  ipcMain.handle(IPC.installUpdate, (event) => {
    if (!isTrustedSender(event)) return false;
    return installUpdate();
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

app.enableSandbox();
registerAppScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  hardenWebContents();

  void app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('io.lunes.lunex');
    app.setAboutPanelOptions({
      applicationName: 'Lunex',
      applicationVersion: app.getVersion(),
      copyright: 'Lunes Platform',
    });

    const config = loadRuntimeConfig(DIST_DIR);
    handleAppProtocol(WEB_ROOT, buildCsp(config));
    hardenSession();
    registerIpc();
    buildMenu(devToolsEnabled);

    mainWindow = createWindow();
    initAutoUpdater(config, () => mainWindow);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
