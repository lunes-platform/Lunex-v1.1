/**
 * Sandboxed preload. It may only `require('electron')`, so it must not
 * import local runtime modules (type-only imports are erased by tsc).
 *
 * Exposes exactly `window.lunexDesktop` (see ../lunexDesktop.d.ts).
 * ipcRenderer itself is never exposed; each method maps to one fixed
 * channel and the main process re-validates the sender and arguments.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { LunexDesktopApi, LunexUpdateStatus } from '../lunexDesktop';

// Keep in sync with src/main/ipc.ts
const IPC = {
  openExternal: 'lunex:open-external',
  installUpdate: 'lunex:install-update',
  getUpdateStatus: 'lunex:get-update-status',
  updateStatus: 'lunex:update-status',
} as const;

function argValue(name: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

function sanitizeStatus(raw: unknown): LunexUpdateStatus | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.state !== 'string') return null;
  const out: LunexUpdateStatus = { state: r.state as LunexUpdateStatus['state'] };
  if (typeof r.version === 'string') out.version = r.version;
  if (typeof r.percent === 'number') out.percent = r.percent;
  if (typeof r.releaseUrl === 'string') out.releaseUrl = r.releaseUrl;
  if (typeof r.message === 'string') out.message = r.message;
  return out;
}

const api: LunexDesktopApi = {
  isDesktop: true,
  platform: process.platform,
  version: argValue('lunex-version'),

  async openExternal(url: string): Promise<void> {
    if (typeof url !== 'string') throw new TypeError('url must be a string');
    await ipcRenderer.invoke(IPC.openExternal, url);
  },

  onUpdateStatus(cb: (status: LunexUpdateStatus) => void): () => void {
    if (typeof cb !== 'function') throw new TypeError('callback must be a function');
    let active = true;
    const listener = (_e: IpcRendererEvent, raw: unknown): void => {
      const s = sanitizeStatus(raw);
      if (active && s) cb(s);
    };
    ipcRenderer.on(IPC.updateStatus, listener);
    // Replay the last known status so late subscribers see "downloaded".
    void ipcRenderer.invoke(IPC.getUpdateStatus).then((raw: unknown) => {
      const s = sanitizeStatus(raw);
      if (active && s) cb(s);
    });
    return () => {
      active = false;
      ipcRenderer.removeListener(IPC.updateStatus, listener);
    };
  },

  async installUpdate(): Promise<boolean> {
    return (await ipcRenderer.invoke(IPC.installUpdate)) === true;
  },
};

contextBridge.exposeInMainWorld('lunexDesktop', Object.freeze(api));
