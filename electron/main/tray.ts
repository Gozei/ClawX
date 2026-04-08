/**
 * System Tray Management
 * Creates and manages the system tray icon and menu
 */
import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import { join } from 'path';
import type { GatewayLifecycleState } from '../gateway/process-policy';
import { getResolvedBranding } from '../utils/branding';
import {
  getCurrentNativeMenuLanguage,
  getNativeMenuMessages,
  getTrayTooltip,
} from './native-localization';

let tray: Tray | null = null;
let trayMainWindow: BrowserWindow | null = null;
let trayGatewayState: GatewayLifecycleState = 'stopped';
let trayHasGatewayState = false;

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'icons');
  }
  return join(__dirname, '../../resources/icons');
}

async function buildTrayContextMenu(mainWindow: BrowserWindow): Promise<Electron.Menu> {
  const branding = await getResolvedBranding();
  const language = await getCurrentNativeMenuLanguage();
  const labels = getNativeMenuMessages(language).tray;

  const showWindow = () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  };

  return Menu.buildFromTemplate([
    {
      label: labels.showProduct(branding.productName),
      click: showWindow,
    },
    {
      type: 'separator',
    },
    {
      label: labels.gatewayStatus,
      enabled: false,
    },
    {
      label: `  ${labels.gatewayStates[trayGatewayState]}`,
      type: 'checkbox',
      checked: trayGatewayState === 'running',
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: labels.quickActions,
      submenu: [
        {
          label: labels.openChat,
          click: () => {
            if (mainWindow.isDestroyed()) return;
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/');
          },
        },
        {
          label: labels.openSettings,
          click: () => {
            if (mainWindow.isDestroyed()) return;
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/settings');
          },
        },
      ],
    },
    {
      type: 'separator',
    },
    {
      label: labels.checkForUpdates,
      click: () => {
        if (mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('update:check');
      },
    },
    {
      type: 'separator',
    },
    {
      label: labels.quitProduct(branding.productName),
      click: () => {
        app.quit();
      },
    },
  ]);
}

async function syncTrayPresentation(): Promise<void> {
  if (!tray || !trayMainWindow || trayMainWindow.isDestroyed()) {
    return;
  }
  const branding = await getResolvedBranding();
  const language = await getCurrentNativeMenuLanguage();
  tray.setToolTip(getTrayTooltip(branding, language, trayHasGatewayState ? trayGatewayState : undefined));
  tray.setContextMenu(await buildTrayContextMenu(trayMainWindow));
}

/**
 * Create system tray icon and menu
 */
export async function createTray(mainWindow: BrowserWindow): Promise<Tray> {
  trayMainWindow = mainWindow;

  if (tray) {
    await syncTrayPresentation();
    return tray;
  }

  // Use platform-appropriate icon for system tray
  const iconsDir = getIconsDir();
  let iconPath: string;

  if (process.platform === 'win32') {
    // Windows: use .ico for best quality in system tray
    iconPath = join(iconsDir, 'icon.ico');
  } else if (process.platform === 'darwin') {
    // macOS: use tray-icon-Template.png.bak for proper status bar icon
    // The "Template" suffix tells macOS to treat it as a template image
    iconPath = join(iconsDir, 'tray-icon-Template.png');
  } else {
    // Linux: use 32x32 PNG
    iconPath = join(iconsDir, '32x32.png');
  }

  let icon = nativeImage.createFromPath(iconPath);

  // Fallback to icon.png if platform-specific icon not found
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(join(iconsDir, 'icon.png'));
    // Still try to set as template for macOS
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }
  }

  // Note: Using "Template" suffix in filename automatically marks it as template image
  // But we can also explicitly set it for safety
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  await syncTrayPresentation();

  // Click to show window (Windows/Linux)
  tray.on('click', () => {
    if (!trayMainWindow || trayMainWindow.isDestroyed()) return;
    if (trayMainWindow.isVisible()) {
      trayMainWindow.hide();
    } else {
      trayMainWindow.show();
      trayMainWindow.focus();
    }
  });

  // Double-click to show window (Windows)
  tray.on('double-click', () => {
    if (!trayMainWindow || trayMainWindow.isDestroyed()) return;
    trayMainWindow.show();
    trayMainWindow.focus();
  });

  return tray;
}

export async function refreshTray(mainWindow?: BrowserWindow | null): Promise<void> {
  if (mainWindow) {
    trayMainWindow = mainWindow;
  }
  if (trayMainWindow && !tray) {
    await createTray(trayMainWindow);
    return;
  }
  await syncTrayPresentation();
}

/**
 * Update tray tooltip with Gateway status
 */
export async function updateTrayStatus(status: GatewayLifecycleState): Promise<void> {
  trayGatewayState = status;
  trayHasGatewayState = true;
  await syncTrayPresentation();
}

/**
 * Destroy tray icon
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
    trayMainWindow = null;
    trayHasGatewayState = false;
  }
}
