/**
 * Application Menu Configuration
 * Creates the native application menu for macOS/Windows/Linux
 */
import { Menu, app, shell, BrowserWindow } from 'electron';

/**
 * Create application menu
 */
export function createMenu(): void {
  const isMac = process.platform === 'darwin';
  const appDisplayName = 'Deep AI Worker';
  
  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: appDisplayName,
            submenu: [
              { role: 'about' as const, label: `关于 ${appDisplayName}` },
              { type: 'separator' as const },
              {
                label: '偏好设置...',
                accelerator: 'Cmd+,',
                click: () => {
                  const win = BrowserWindow.getFocusedWindow();
                  win?.webContents.send('navigate', '/settings');
                },
              },
              { type: 'separator' as const },
              { role: 'services' as const, label: '服务' },
              { type: 'separator' as const },
              { role: 'hide' as const, label: `隐藏 ${appDisplayName}` },
              { role: 'hideOthers' as const, label: '隐藏其他' },
              { role: 'unhide' as const, label: '显示全部' },
              { type: 'separator' as const },
              { role: 'quit' as const, label: `退出 ${appDisplayName}` },
            ],
          },
        ]
      : []),
    
    // File menu
    {
      label: '文件',
      submenu: [
        {
          label: '新建对话',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('navigate', '/chat');
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: `退出 ${appDisplayName}` },
      ],
    },
    
    // Edit menu
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const, label: '粘贴并匹配样式' },
              { role: 'delete' as const, label: '删除' },
              { role: 'selectAll' as const, label: '全选' },
            ]
          : [
              { role: 'delete' as const, label: '删除' },
              { type: 'separator' as const },
              { role: 'selectAll' as const, label: '全选' },
            ]),
      ],
    },
    
    // View menu
    {
      label: '显示',
      submenu: [
        { role: 'reload', label: '重新载入' },
        { role: 'forceReload', label: '强制重新载入' },
        { role: 'toggleDevTools', label: '切换开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    
    // Navigate menu
    {
      label: '导航',
      submenu: [
        {
          label: '总览',
          accelerator: 'CmdOrCtrl+1',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('navigate', '/');
          },
        },
        {
          label: '对话',
          accelerator: 'CmdOrCtrl+2',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('navigate', '/chat');
          },
        },
        {
          label: '渠道',
          accelerator: 'CmdOrCtrl+3',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('navigate', '/channels');
          },
        },
        {
          label: '技能',
          accelerator: 'CmdOrCtrl+4',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('navigate', '/skills');
          },
        },
        {
          label: '定时任务',
          accelerator: 'CmdOrCtrl+5',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('navigate', '/cron');
          },
        },
        {
          label: '设置',
          accelerator: isMac ? 'Cmd+,' : 'Ctrl+,',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('navigate', '/settings');
          },
        },
      ],
    },
    
    // Window menu
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: '前置全部窗口' },
              { type: 'separator' as const },
              { role: 'window' as const, label: '窗口' },
            ]
          : [{ role: 'close' as const, label: '关闭窗口' }]),
      ],
    },
    
    // Help menu
    {
      role: 'help',
      submenu: [
        {
          label: '官网',
          click: async () => {
            await shell.openExternal('https://claw-x.com');
          },
        },
        {
          label: '反馈问题',
          click: async () => {
            await shell.openExternal('https://github.com/ValueCell-ai');
          },
        },
        { type: 'separator' },
        {
          label: 'OpenClaw 文档',
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
