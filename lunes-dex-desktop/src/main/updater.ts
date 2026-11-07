import { app, BrowserWindow, dialog, net, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { LunexUpdateStatus } from '../lunexDesktop';
import { UPDATE_OWNER, UPDATE_REPO, UPDATE_TAG_PREFIX, type RuntimeConfig } from './config';
import { IPC } from './ipc';

/**
 * Auto-update via GitHub Releases.
 *
 * The monorepo also publishes non-desktop releases (`v*.*.*` from
 * release.yml), so GitHub's "latest release" is not necessarily a desktop
 * build. We therefore resolve the newest published (non-draft,
 * non-prerelease) `desktop-v*` release through the REST API and point
 * electron-updater's generic provider at that release's download folder,
 * where electron-builder uploaded `latest*.yml` + installers. Downloads are
 * verified by electron-updater against the sha512 in `latest*.yml`.
 *
 * Installation NEVER happens without explicit user consent:
 * `autoInstallOnAppQuit` is disabled and `quitAndInstall` is only called
 * from the "Restart to update" dialog/menu or `lunexDesktop.installUpdate()`.
 */

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 10_000;
const TAG_RE = /^desktop-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const RELEASES_PAGE = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases`;

let status: LunexUpdateStatus | null = null;
let checking = false;
let latestTag: string | null = null;
let promptedVersion: string | null = null;
let canAutoInstall = false;
let getWindow: () => BrowserWindow | null = () => null;

export function getUpdateStatus(): LunexUpdateStatus | null {
  return status;
}

function setStatus(next: LunexUpdateStatus): void {
  status = next;
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send(IPC.updateStatus, next);
}

function releaseUrl(): string {
  return latestTag ? `${RELEASES_PAGE}/tag/${encodeURIComponent(latestTag)}` : RELEASES_PAGE;
}

type GhRelease = { tag_name?: unknown; draft?: unknown; prerelease?: unknown };

async function resolveLatestDesktopTag(): Promise<string | null> {
  const res = await net.fetch(
    `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases?per_page=50`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': `Lunex-Desktop/${app.getVersion()}`,
      },
    },
  );
  if (!res.ok) throw new Error(`GitHub releases request failed (${res.status})`);
  const list: unknown = await res.json();
  if (!Array.isArray(list)) return null;
  for (const r of list as GhRelease[]) {
    if (r.draft === true || r.prerelease === true) continue;
    if (typeof r.tag_name !== 'string') continue;
    if (r.tag_name.startsWith(UPDATE_TAG_PREFIX) && TAG_RE.test(r.tag_name)) {
      return r.tag_name;
    }
  }
  return null;
}

export async function checkForUpdates(interactive: boolean): Promise<void> {
  if (checking || status?.state === 'downloaded' || status?.state === 'downloading') {
    if (interactive && status?.state === 'downloaded') void promptRestart(true);
    return;
  }
  checking = true;
  try {
    setStatus({ state: 'checking' });
    const tag = await resolveLatestDesktopTag();
    if (!tag) {
      setStatus({ state: 'not-available' });
      if (interactive) await infoDialog('Lunex is up to date.');
      return;
    }
    latestTag = tag;
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: `${RELEASES_PAGE}/download/${encodeURIComponent(tag)}`,
    });
    const result = await autoUpdater.checkForUpdates();
    if (interactive && (!result || !result.isUpdateAvailable)) {
      await infoDialog('Lunex is up to date.');
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus({ state: 'error', message: message.slice(0, 300) });
    if (interactive) await infoDialog('Could not check for updates. Please try again later.');
  } finally {
    checking = false;
  }
}

async function infoDialog(message: string): Promise<void> {
  const win = getWindow();
  const opts = { type: 'info' as const, message, buttons: ['OK'] };
  if (win) await dialog.showMessageBox(win, opts);
  else await dialog.showMessageBox(opts);
}

async function promptRestart(force = false): Promise<void> {
  const version = status?.version ?? '';
  if (!force && promptedVersion === version) return;
  promptedVersion = version;
  const win = getWindow();
  const opts = {
    type: 'info' as const,
    title: 'Update ready',
    message: `Lunex ${version} has been downloaded.`,
    detail: 'Restart now to install it, or keep working and install later from the app menu.',
    buttons: ['Restart to update', 'Later'],
    defaultId: 0,
    cancelId: 1,
  };
  const { response } = win
    ? await dialog.showMessageBox(win, opts)
    : await dialog.showMessageBox(opts);
  if (response === 0) installUpdate();
}

async function promptManualDownload(version: string): Promise<void> {
  if (promptedVersion === version) return;
  promptedVersion = version;
  const win = getWindow();
  const opts = {
    type: 'info' as const,
    title: 'Update available',
    message: `Lunex ${version} is available.`,
    detail:
      'This build cannot update itself automatically. Open the release page to download the new version.',
    buttons: ['Open release page', 'Later'],
    defaultId: 0,
    cancelId: 1,
  };
  const { response } = win
    ? await dialog.showMessageBox(win, opts)
    : await dialog.showMessageBox(opts);
  if (response === 0) await shell.openExternal(releaseUrl());
}

/** Returns true when an update was downloaded and the install was started. */
export function installUpdate(): boolean {
  if (status?.state !== 'downloaded') return false;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}

export function isUpdateReady(): boolean {
  return status?.state === 'downloaded';
}

export function initAutoUpdater(
  config: RuntimeConfig,
  windowGetter: () => BrowserWindow | null,
): void {
  getWindow = windowGetter;
  if (!app.isPackaged || process.env.LUNEX_DISABLE_AUTO_UPDATE === '1') return;

  // Squirrel.Mac refuses to apply updates to unsigned apps: on unsigned
  // macOS builds we only notify and link to the release page.
  canAutoInstall = process.platform !== 'darwin' || config.macSigned;

  autoUpdater.autoDownload = canAutoInstall;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = {
    info: (m?: unknown) => console.info('[updater]', m),
    warn: (m?: unknown) => console.warn('[updater]', m),
    error: (m?: unknown) => console.error('[updater]', m),
    debug: () => undefined,
  };

  autoUpdater.on('update-available', (info) => {
    if (canAutoInstall) {
      setStatus({ state: 'available', version: info.version, releaseUrl: releaseUrl() });
    } else {
      setStatus({ state: 'manual', version: info.version, releaseUrl: releaseUrl() });
      void promptManualDownload(info.version);
    }
  });
  autoUpdater.on('update-not-available', () => setStatus({ state: 'not-available' }));
  autoUpdater.on('download-progress', (p) => {
    setStatus({
      state: 'downloading',
      version: status?.version,
      percent: Math.max(0, Math.min(100, Math.round(p.percent))),
      releaseUrl: releaseUrl(),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    setStatus({ state: 'downloaded', version: info.version, releaseUrl: releaseUrl() });
    void promptRestart();
  });
  autoUpdater.on('error', (err) => {
    setStatus({ state: 'error', message: (err?.message ?? 'Update error').slice(0, 300) });
  });

  setTimeout(() => void checkForUpdates(false), FIRST_CHECK_DELAY_MS);
  setInterval(() => void checkForUpdates(false), CHECK_INTERVAL_MS).unref();
}
