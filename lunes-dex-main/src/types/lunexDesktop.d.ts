/**
 * Bridge exposed by the Electron preload script of the Lunex desktop app
 * (`lunes-dex-desktop`). Absent in regular browsers.
 */
type LunexDesktopUpdateStatus = {
  status: string
  version?: string
  progress?: number
  error?: string
}

interface LunexDesktopBridge {
  isDesktop: true
  platform: string
  version: string
  openExternal: (url: string) => Promise<void> | void
  onUpdateStatus: (
    callback: (status: LunexDesktopUpdateStatus) => void
  ) => (() => void) | void
  installUpdate: () => Promise<void> | void
}

interface Window {
  lunexDesktop?: LunexDesktopBridge
}
