import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Deep AI Worker skills page flows', () => {
  test('keeps the empty state and marketplace modal usable without runtime skills', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('app-guide-overlay')).toHaveCount(0);
      await expect(page.getByTestId('skills-page-title')).toBeVisible();
      await expect(page.getByTestId('skills-search-input')).toBeVisible();
      await expect(page.getByTestId('skills-refresh-button')).toHaveCount(0);
      await expect(page.getByTestId('skills-source-tabs')).toBeVisible();
      await expect(page.getByTestId('skills-filter-button')).toBeVisible();
      await expect(page.getByTestId('skills-guide-button')).toHaveCount(0);
      await expect(page.getByTestId('skills-create-button')).toBeVisible();
      await expect(page.getByTestId('skills-discover-button')).toBeVisible();
      await expect(page.getByTestId('skills-create-button')).toHaveClass(/rounded-lg/);
      await expect(page.getByTestId('skills-create-button')).toHaveClass(/px-4/);
      await expect(page.getByTestId('skills-discover-button')).toHaveClass(/rounded-lg/);
      await expect(page.getByTestId('skills-discover-button')).toHaveClass(/px-4/);

      await page.getByTestId('skills-search-input').fill('demo');
      await expect(page.getByTestId('skills-search-input')).toHaveValue('demo');
      await expect(page.getByTestId('skills-empty-state')).toBeVisible();

      await page.getByTestId('skills-filter-button').hover();
      await expect(page.getByTestId('skills-filter-menu')).toBeVisible();

      await page.getByTestId('skills-filter-status-enabled').click();
      await expect(page.getByTestId('skills-filter-status-enabled')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('skills-filter-button')).toContainText('1');

      await page.getByTestId('skills-filter-reset').click();
      await expect(page.getByTestId('skills-filter-status-all')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('skills-filter-missing-all')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('skills-filter-source-all')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('skills-filter-button')).not.toContainText('1');

      await page.getByTestId('skills-page-title').hover();
      await expect(page.getByTestId('skills-filter-menu')).toBeHidden();
      await page.getByTestId('skills-discover-button').click();
      await expect(page.getByTestId('skills-marketplace-modal')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-modal')).toHaveClass(/rounded-3xl/);
      await expect(page.getByTestId('skills-marketplace-search-input')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-search-input')).toHaveClass(/rounded-full/);
      await expect(page.getByTestId('skills-marketplace-source-chips')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-source-chips').locator('button[aria-pressed="true"]')).toHaveCount(1);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('preserves list search and filters after leaving the page and coming back', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();

      await page.getByTestId('skills-search-input').fill('demo');
      await page.getByTestId('skills-filter-button').hover();
      await expect(page.getByTestId('skills-filter-menu')).toBeVisible();
      await page.getByTestId('skills-filter-status-enabled').click();
      await expect(page.getByTestId('skills-filter-status-enabled')).toHaveAttribute('aria-pressed', 'true');

      await page.getByTestId('sidebar-nav-dashboard').click();
      await expect(page.getByTestId('dashboard-page')).toBeVisible();

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-search-input')).toHaveValue('demo');
      await expect(page.getByTestId('skills-filter-button')).toContainText('1');

      await page.getByTestId('skills-filter-button').hover();
      await expect(page.getByTestId('skills-filter-status-enabled')).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('opens a new chat with the create-skill prompt prefilled', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();

      await page.getByTestId('skills-create-button').click();

      const composerInput = page.getByTestId('chat-composer').getByRole('textbox');
      await expect(composerInput).toHaveValue(
        '请帮我创建一个新的 skill，优先使用内置的 skill 创建能力。我的要求是：',
      );
    } finally {
      await closeElectronApp(app);
    }
  });

  test('deletes a marketplace skill from the detail page when the skill id differs from the install slug', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(({ ipcMain }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__clawxE2eSkillDeleted = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__clawxE2eSkillDeleteRequests = [];

        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
          const method = request?.method ?? 'GET';
          const path = request?.path ?? '';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const deleted = Boolean((globalThis as any).__clawxE2eSkillDeleted);
          const skillBaseDir = 'C:/Users/test/.openclaw/skill-sources/deepaiworker/skills/self-improving-agent';

          if (path === '/api/skills' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: deleted
                  ? []
                  : [{
                    id: 'self-improvement',
                    slug: 'self-improving-agent',
                    name: 'self-improvement',
                    description: 'Captures learnings and errors.',
                    enabled: true,
                    ready: true,
                    version: '3.0.13',
                    baseDir: skillBaseDir,
                    sourceId: 'deepaiworker',
                    sourceLabel: 'DeepAI Worker',
                  }],
              },
            };
          }

          if (path === '/api/skills/self-improvement' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  identity: {
                    id: 'self-improvement',
                    slug: 'self-improving-agent',
                    name: 'self-improvement',
                    description: 'Captures learnings and errors.',
                    icon: '📦',
                    version: '3.0.13',
                    source: 'market',
                    baseDir: skillBaseDir,
                  },
                  status: {
                    enabled: true,
                    ready: true,
                  },
                  requirements: {
                    rawMarkdown: '# Self Improvement',
                  },
                  config: {
                    apiKey: '',
                    env: {},
                  },
                },
              },
            };
          }

          if (path === '/api/skills/self-improvement' && method === 'DELETE') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).__clawxE2eSkillDeleted = true;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).__clawxE2eSkillDeleteRequests.push({ method, path });
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: { success: true },
              },
            };
          }

          if (path === '/api/clawhub/sources' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  success: true,
                  results: [
                    {
                      id: 'deepaiworker',
                      label: 'DeepAI Worker',
                      enabled: true,
                      site: 'https://example.com',
                      workdir: 'C:/Users/test/.openclaw/skill-sources/deepaiworker',
                    },
                  ],
                },
              },
            };
          }

          return {
            ok: false,
            error: {
              message: `Unexpected hostapi:fetch request: ${method} ${path}`,
            },
          };
        });
      });

      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-list-item-self-improvement')).toBeVisible();

      await page.getByTestId('skills-list-item-self-improvement').click();
      await expect(page.getByTestId('skills-detail-page')).toBeVisible();

      await page.getByLabel(/Delete Skill|删除技能|スキルを削除/).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: /Delete Skill|删除技能|スキルを削除/ }).click();

      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-empty-state')).toBeVisible();

      const deleteRequests = await app.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (globalThis as any).__clawxE2eSkillDeleteRequests ?? [];
      });
      expect(deleteRequests).toEqual([{ method: 'DELETE', path: '/api/skills/self-improvement' }]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('does not re-surface the gateway restart hint after opening the skills page', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      const gatewayRestartHint = page.getByTestId('sidebar-gateway-restarting-hint');
      await expect(gatewayRestartHint).toHaveCount(0, { timeout: 60_000 });

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('app-guide-overlay')).toHaveCount(0);

      await page.waitForTimeout(2_000);
      await expect(gatewayRestartHint).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

});
