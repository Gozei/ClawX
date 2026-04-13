import { BrowserWindow, Menu, type WebContents } from 'electron';

function hasSelection(selectionText?: string): boolean {
  return Boolean(selectionText && selectionText.trim().length > 0);
}

export function attachContextMenu(webContents: WebContents): void {
  webContents.on('context-menu', (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    const selectionExists = hasSelection(params.selectionText);
    const canEdit = params.isEditable;

    if (canEdit) {
      template.push(
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', enabled: params.editFlags.canUndo, click: () => webContents.undo() },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', enabled: params.editFlags.canRedo, click: () => webContents.redo() },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', enabled: params.editFlags.canCut, click: () => webContents.cut() },
        { label: '复制', accelerator: 'CmdOrCtrl+C', enabled: params.editFlags.canCopy || selectionExists, click: () => webContents.copy() },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', enabled: params.editFlags.canPaste, click: () => webContents.paste() },
        { label: '全选', accelerator: 'CmdOrCtrl+A', click: () => webContents.selectAll() },
      );
    } else if (selectionExists) {
      template.push(
        { label: '复制', accelerator: 'CmdOrCtrl+C', click: () => webContents.copy() },
        { type: 'separator' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', click: () => webContents.selectAll() },
      );
    }

    if (template.length === 0) {
      return;
    }

    Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(webContents) ?? undefined });
  });
}
