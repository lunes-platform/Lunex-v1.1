/**
 * Bridge exposed by the Electron preload script of the Lunex desktop app
 * (`lunes-dex-desktop/src/lunexDesktop.d.ts` is the source of truth — keep
 * this in sync). Absent in regular browsers.
 */
type LunexUpdateState =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  /** Update exists but must be installed manually (unsigned macOS build). */
  | 'manual'
  | 'error'

type LunexUpdateStatus = {
  state: LunexUpdateState
  version?: string
  /** 0-100 while downloading */
  percent?: number
  /** Release page (always set for `manual`) */
  releaseUrl?: string
  message?: string
}

interface LunexDesktopBridge {
  readonly isDesktop: true
  readonly platform: string
  readonly version: string
  openExternal(url: string): Promise<void>
  /** Replays the last status immediately; returns an unsubscribe fn. */
  onUpdateStatus(cb: (status: LunexUpdateStatus) => void): () => void
  /** Quits and installs a downloaded update; false if none is ready. */
  installUpdate(): Promise<boolean>
}

interface Window {
  lunexDesktop?: LunexDesktopBridge
}
