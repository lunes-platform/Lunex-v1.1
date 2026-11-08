/**
 * Public surface exposed by the Lunex desktop preload script
 * (`lunes-dex-desktop/src/preload/preload.ts`) on `window.lunexDesktop`.
 *
 * The web app (`lunes-dex-main`) can copy this file (or declare the same
 * shape) and feature-detect with `window.lunexDesktop?.isDesktop`.
 * Nothing else from Electron/Node is reachable from the renderer.
 */

export type LunexUpdateState =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  /** Update exists but must be installed manually (e.g. unsigned macOS build). */
  | 'manual'
  | 'error';

export type LunexUpdateStatus = {
  state: LunexUpdateState;
  /** Version of the update being offered (when known). */
  version?: string;
  /** Download progress 0-100 while `state === 'downloading'`. */
  percent?: number;
  /** GitHub release page for the update (always set for `manual`). */
  releaseUrl?: string;
  /** Human-readable error (only for `state === 'error'`). */
  message?: string;
};

export type LunexDesktopApi = {
  readonly isDesktop: true;
  readonly platform: 'darwin' | 'win32' | 'linux' | string;
  /** Desktop app version (semver), not the web bundle version. */
  readonly version: string;
  /** Opens an http(s) URL in the user's default browser. Other schemes are rejected. */
  openExternal(url: string): Promise<void>;
  /**
   * Subscribe to auto-update status. The last known status is replayed
   * immediately after subscribing. Returns an unsubscribe function.
   */
  onUpdateStatus(cb: (status: LunexUpdateStatus) => void): () => void;
  /**
   * Quits and installs a downloaded update. Only acts when an update has
   * been downloaded (`state === 'downloaded'`); resolves `false` otherwise.
   */
  installUpdate(): Promise<boolean>;
};

declare global {
  interface Window {
    lunexDesktop?: LunexDesktopApi;
  }
}
