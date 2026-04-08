/**
 * Application Menu Configuration
 * Creates the native application menu for macOS/Windows/Linux
 */
import { Menu, shell, BrowserWindow } from 'electron';
import { getResolvedBranding } from '../utils/branding';
import { getCurrentNativeMenuLanguage, getNativeMenuMessages } from './native-localization';

/**
 * Create application menu
 */
export async function createMenu(): Promise<void> {
  const isMac = process.platform === 'darwin';
  const branding = await getResolvedBranding();
  const labels = getNativeMenuMessages(await getCurrentNativeMenuLanguage()).appMenu;
  const appDisplayName = branding.productName;

  const navigate = (path: string) => {
    const win = BrowserWindow.getFocusedWindow();
    win?.webContents.send('navigate', path);
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: appDisplayName,
            submenu: [
              { role: 'about' as const, label: labels.aboutProduct(appDisplayName) },
              { type: 'separator' as const },
              {
                label: labels.preferences,
                accelerator: 'Cmd+,',
                click: () => navigate('/settings'),
              },
              { type: 'separator' as const },
              { role: 'services' as const, label: labels.services },
              { type: 'separator' as const },
              { role: 'hide' as const, label: labels.hideProduct(appDisplayName) },
              { role: 'hideOthers' as const, label: labels.hideOthers },
              { role: 'unhide' as const, label: labels.showAll },
              { type: 'separator' as const },
              { role: 'quit' as const, label: labels.quitProduct(appDisplayName) },
            ],
          },
        ]
      : []),

    {
      label: labels.file,
      submenu: [
        {
          label: labels.newChat,
          accelerator: 'CmdOrCtrl+N',
          click: () => navigate('/chat'),
        },
        { type: 'separator' },
        isMac
          ? { role: 'close' as const, label: labels.closeWindow }
          : { role: 'quit' as const, label: labels.quitProduct(appDisplayName) },
      ],
    },

    {
      label: labels.edit,
      submenu: [
        { role: 'undo', label: labels.undo },
        { role: 'redo', label: labels.redo },
        { type: 'separator' },
        { role: 'cut', label: labels.cut },
        { role: 'copy', label: labels.copy },
        { role: 'paste', label: labels.paste },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const, label: labels.pasteAndMatchStyle },
              { role: 'delete' as const, label: labels.delete },
              { role: 'selectAll' as const, label: labels.selectAll },
            ]
          : [
              { role: 'delete' as const, label: labels.delete },
              { type: 'separator' as const },
              { role: 'selectAll' as const, label: labels.selectAll },
            ]),
      ],
    },

    {
      label: labels.view,
      submenu: [
        { role: 'reload', label: labels.reload },
        { role: 'forceReload', label: labels.forceReload },
        { role: 'toggleDevTools', label: labels.toggleDevTools },
        { type: 'separator' },
        { role: 'resetZoom', label: labels.actualSize },
        { role: 'zoomIn', label: labels.zoomIn },
        { role: 'zoomOut', label: labels.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: labels.toggleFullScreen },
      ],
    },

    {
      label: labels.navigate,
      submenu: [
        {
          label: labels.overview,
          accelerator: 'CmdOrCtrl+1',
          click: () => navigate('/'),
        },
        {
          label: labels.chat,
          accelerator: 'CmdOrCtrl+2',
          click: () => navigate('/chat'),
        },
        {
          label: labels.channels,
          accelerator: 'CmdOrCtrl+3',
          click: () => navigate('/channels'),
        },
        {
          label: labels.skills,
          accelerator: 'CmdOrCtrl+4',
          click: () => navigate('/skills'),
        },
        {
          label: labels.cron,
          accelerator: 'CmdOrCtrl+5',
          click: () => navigate('/cron'),
        },
        {
          label: labels.settings,
          accelerator: isMac ? 'Cmd+,' : 'Ctrl+,',
          click: () => navigate('/settings'),
        },
      ],
    },

    {
      label: labels.window,
      submenu: [
        { role: 'minimize', label: labels.minimize },
        { role: 'zoom', label: labels.zoom },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: labels.bringAllToFront },
              { type: 'separator' as const },
              { role: 'window' as const, label: labels.window },
            ]
          : [{ role: 'close' as const, label: labels.closeWindow }]),
      ],
    },

    {
      role: 'help',
      label: labels.help,
      submenu: [
        {
          label: labels.website,
          click: async () => {
            await shell.openExternal('https://claw-x.com');
          },
        },
        {
          label: labels.reportIssue,
          click: async () => {
            await shell.openExternal('https://github.com/ValueCell-ai');
          },
        },
        { type: 'separator' },
        {
          label: labels.openClawDocs,
          click: async () => {
            await shell.openExternal('https://docs.openclaw.ai');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
