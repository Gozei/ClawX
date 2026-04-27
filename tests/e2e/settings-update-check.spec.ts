import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

type Rgba = {
  r: number;
  g: number;
  b: number;
  a: number;
};

function channelAverage(color: Rgba): number {
  return (color.r + color.g + color.b) / 3;
}

function relativeLuminance(color: Rgba): number {
  const normalize = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * normalize(color.r) + 0.7152 * normalize(color.g) + 0.0722 * normalize(color.b);
}

function contrastRatio(left: Rgba, right: Rgba): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function compositeOver(color: Rgba, background: Rgba): Rgba {
  const alpha = color.a;
  return {
    r: Math.round(color.r * alpha + background.r * (1 - alpha)),
    g: Math.round(color.g * alpha + background.g * (1 - alpha)),
    b: Math.round(color.b * alpha + background.b * (1 - alpha)),
    a: 1,
  };
}

test.describe('Settings update check', () => {
  test('shows global update dialogs and download/install overlays', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await app.evaluate(({ ipcMain }, mockVersion) => {
        const state = globalThis as typeof globalThis & { __e2eUpdateCalls?: string[] };
        state.__e2eUpdateCalls = [];

        ipcMain.removeHandler('app:request');
        ipcMain.handle('app:request', async (event, request: { module?: string; action?: string }) => {
          if (request?.module !== 'update') {
            return {
              ok: false,
              error: { message: `Unexpected app request: ${String(request?.module)}.${String(request?.action)}` },
            };
          }

          const action = String(request.action || '');
          state.__e2eUpdateCalls?.push(action);

          if (action === 'check') {
            return {
              ok: true,
              data: {
                success: true,
                status: {
                  status: 'available',
                  info: { version: mockVersion },
                },
              },
            };
          }

          if (action === 'download') {
            const sender = event.sender;
            setTimeout(() => {
              sender.send('update:status-changed', {
                status: 'downloading',
                info: { version: mockVersion },
                progress: {
                  total: 10_000_000,
                  delta: 1_000_000,
                  transferred: 1_000_000,
                  percent: 10,
                  bytesPerSecond: 1_024_000,
                },
              });
              setTimeout(() => {
                sender.send('update:status-changed', {
                  status: 'downloaded',
                  info: { version: mockVersion },
                });
              }, 1200);
            }, 20);
            return { ok: true, data: { success: true } };
          }

          if (action === 'install') {
            return { ok: true, data: { success: true } };
          }

          return {
            ok: false,
            error: { message: `Unexpected update action: ${String(request.action)}` },
          };
        });
      }, '9.9.9');

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-check-updates').click();

      const availableDialog = page.getByTestId('app-update-available-dialog');
      await expect(availableDialog).toBeVisible();
      await availableDialog.getByRole('button').nth(1).click({ force: true });

      const progressOverlay = page.getByTestId('app-update-progress-overlay');
      await expect(progressOverlay).toBeVisible();
      await expect(page.getByTestId('app-update-download-progress')).toBeVisible();

      const readProgressOverlayColors = async (theme: 'light' | 'dark') => {
        await page.evaluate((nextTheme) => {
          document.documentElement.classList.remove('light', 'dark');
          document.documentElement.classList.add(nextTheme);
        }, theme);

        return await page.evaluate(() => {
          const parseColor = (value: string) => {
            const match = value.match(/rgba?\(([^)]+)\)/);
            if (!match) throw new Error(`Unexpected CSS color: ${value}`);
            const parts = match[1].split(',').map((part) => Number(part.trim()));
            return {
              r: parts[0],
              g: parts[1],
              b: parts[2],
              a: parts[3] ?? 1,
            };
          };
          const getStyle = (testId: string) => {
            const element = document.querySelector(`[data-testid="${testId}"]`);
            if (!(element instanceof HTMLElement)) {
              throw new Error(`Missing element: ${testId}`);
            }
            return window.getComputedStyle(element);
          };

          return {
            card: parseColor(getStyle('app-update-progress-card').backgroundColor),
            title: parseColor(getStyle('app-update-progress-title').color),
            description: parseColor(getStyle('app-update-progress-description').color),
          };
        });
      };

      const lightColors = await readProgressOverlayColors('light');
      const lightCard = compositeOver(lightColors.card, { r: 255, g: 255, b: 255, a: 1 });
      expect(channelAverage(lightCard)).toBeGreaterThan(210);
      expect(contrastRatio(lightColors.title, lightCard)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(lightColors.description, lightCard)).toBeGreaterThanOrEqual(4.5);

      const darkColors = await readProgressOverlayColors('dark');
      const darkCard = compositeOver(darkColors.card, { r: 15, g: 23, b: 42, a: 1 });
      expect(channelAverage(darkCard)).toBeLessThan(90);
      expect(contrastRatio(darkColors.title, darkCard)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(darkColors.description, darkCard)).toBeGreaterThanOrEqual(4.5);

      const installDialog = page.getByTestId('app-update-install-dialog');
      await expect(installDialog).toBeVisible();
      await expect(installDialog.getByRole('button').nth(1)).toBeVisible();
      await installDialog.getByRole('button').nth(1).click({ force: true });

      await expect(progressOverlay).toBeVisible();
      const calls = await app.evaluate(() => {
        const state = globalThis as typeof globalThis & { __e2eUpdateCalls?: string[] };
        return state.__e2eUpdateCalls ?? [];
      });
      expect(calls).toEqual(expect.arrayContaining(['check', 'download', 'install']));
      expect(calls.filter((action) => action === 'check')).toHaveLength(1);
    } finally {
      await closeElectronApp(app);
    }
  });
});
