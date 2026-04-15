import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

test.describe('Deep AI Worker settings logs panel', () => {
  test('shows visible log policy controls plus searchable app and audit logs', async ({ launchElectronApp, userDataDir }) => {
    const logsDir = join(userDataDir, 'logs');
    await mkdir(logsDir, { recursive: true });

    await writeFile(
      join(logsDir, 'clawx-2026-04-15.log'),
      '[2026-04-15T09:30:45.123+08:00] [ERROR] Seeded application failure\n',
      'utf8',
    );

    await writeFile(
      join(logsDir, 'audit-2026-04-15.ndjson'),
      `${JSON.stringify({
        ts: '2026-04-15T10:11:12.000+08:00',
        tsEpochMs: Date.parse('2026-04-15T10:11:12.000+08:00'),
        eventId: 'audit-seeded',
        action: 'settings.update',
        resourceType: 'settings',
        result: 'success',
        requestId: 'req-seeded',
        changedKeys: ['logLevel'],
        metadata: { value: 'warn' },
      })}\n`,
      'utf8',
    );

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('settings-logs-panel')).toBeVisible();
      await expect(page.getByTestId('settings-app-log-retention-input')).toHaveValue('14');
      await expect(page.getByTestId('settings-audit-log-retention-input')).toHaveValue('30');
      await expect(page.getByTestId('settings-log-file-max-size-input')).toHaveValue('64');
      await expect(page.getByTestId('settings-visible-audit-enabled-switch')).toBeVisible();

      await page.getByTestId('settings-logs-toggle').click();

      await page.getByTestId('settings-logs-search-input').fill('Seeded application failure');
      await expect(page.getByTestId('settings-logs-results')).toContainText('Seeded application failure');

      await page.getByTestId('settings-logs-tab-audit').click();
      await page.getByTestId('settings-logs-search-input-audit').fill('settings.update');
      await expect(page.getByTestId('settings-logs-results')).toContainText('settings.update');
      await expect(page.getByTestId('settings-logs-results')).toContainText('req-seeded');
    } finally {
      await closeElectronApp(app);
    }
  });
});
