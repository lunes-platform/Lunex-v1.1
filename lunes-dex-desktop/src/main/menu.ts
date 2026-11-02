import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import { checkForUpdates, installUpdate, isUpdateReady } from './updater';

/**
 * Application menu. The Edit menu is required on macOS for Cmd+C / Cmd+V
 * to work in inputs (wallet addresses, amounts, etc.).
 * Developer tools are only offered in development builds.
 */
export function buildMenu(devToolsEnabled: boolean): void {
  const isMac = process.platform === 'darwin';

  const updateItems: MenuItemConstructorOptions[] = app.isPackaged
    ? [
        {
          label: 'Check for Updates…',
          click: () => void checkForUpdates(true),
        },
        {
          label: 'Restart to Update',
          click: () => {
            if (isUpdateReady()) installUpdate();
          },
        },
      ]
    : [];

  const viewSubmenu: MenuItemConstructorOptions[] = [
    { role: 'reload' },
    ...(devToolsEnabled
      ? ([{ role: 'forceReload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
      : []),
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ];

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              ...updateItems,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } as MenuItemConstructorOptions,
        ]
      : [
          {
            label: 'File',
            submenu: [...updateItems, { type: 'separator' }, { role: 'quit' }],
          } as MenuItemConstructorOptions,
        ]),
    { role: 'editMenu' },
    { label: 'View', submenu: viewSubmenu },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
