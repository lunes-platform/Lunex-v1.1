/**
 * DesktopUpdateNotifier — only inside the Electron desktop app.
 *
 * Listens to the preload's auto-update status and surfaces it as toasts:
 *  - downloaded → sticky "Update ready" with "Restart to update" (the app
 *    never installs without this click);
 *  - manual (unsigned macOS) → "Update available" linking to the release;
 *  - errors are silent (the next scheduled check retries).
 * Renders nothing; no-op in browsers.
 */
import { useEffect } from 'react'
import { useToast } from './ToastProvider'

export const DesktopUpdateNotifier: React.FC = () => {
  const { toast } = useToast()

  useEffect(() => {
    const desktop = window.lunexDesktop
    if (!desktop?.isDesktop) return
    const shown = new Set<string>()
    return desktop.onUpdateStatus(status => {
      const key = `${status.state}:${status.version ?? ''}`
      if (shown.has(key)) return
      if (status.state === 'downloaded') {
        shown.add(key)
        toast(
          'info',
          'Update ready',
          `Lunex ${status.version ?? ''} has been downloaded.`.replace(
            '  ',
            ' '
          ),
          {
            id: 'desktop-update',
            sticky: true,
            cat: 'system',
            action: {
              label: 'Restart to update',
              onClick: () => {
                void desktop.installUpdate()
              }
            }
          }
        )
      } else if (status.state === 'manual' && status.releaseUrl) {
        shown.add(key)
        const url = status.releaseUrl
        toast(
          'info',
          'Update available',
          `Lunex ${status.version ?? ''} is available — download the new installer.`,
          {
            id: 'desktop-update',
            sticky: true,
            cat: 'system',
            action: {
              label: 'Open release page',
              onClick: () => {
                void desktop.openExternal(url)
              }
            }
          }
        )
      }
    })
  }, [toast])

  return null
}

export default DesktopUpdateNotifier
