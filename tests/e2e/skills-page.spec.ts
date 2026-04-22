import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Skills page baseline', () => {
  test('shows the current empty state and marketplace entry points', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-skills').click({ force: true });
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-page-title')).toBeVisible();
      await expect(page.getByTestId('skills-search-input')).toBeVisible();
      await expect(page.getByTestId('skills-source-tabs')).toBeVisible();
      await expect(page.getByTestId('skills-filter-button')).toBeVisible();
      await expect(page.getByTestId('skills-tutorial-button')).toBeVisible();
      await expect(page.getByTestId('skills-discover-button')).toBeVisible();

      await page.getByTestId('skills-search-input').fill('demo');
      await expect(page.getByTestId('skills-search-input')).toHaveValue('demo');
      await expect(page.getByTestId('skills-empty-state')).toBeVisible();

      await page.getByTestId('skills-discover-button').click({ force: true });
      await expect(page.getByTestId('skills-marketplace-panel')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-search-input')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-source-tabs')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows marketplace source totals when source counts are available', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
          const method = request?.method ?? 'GET';
          const path = request?.path ?? '';

          if (path === '/api/skills' && method === 'GET') {
            return { ok: true, data: { status: 200, ok: true, json: [] } };
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
                    { id: 'clawhub', label: 'ClawHub', enabled: true, site: 'https://clawhub.ai', workdir: '/tmp/clawhub' },
                    { id: 'deepaiworker', label: 'DeepSkillHub', enabled: true, site: 'http://127.0.0.1:4000', workdir: '/tmp/deepaiworker' },
                  ],
                },
              },
            };
          }

          if (path === '/api/clawhub/source-counts' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  success: true,
                  results: [
                    { sourceId: 'clawhub', sourceLabel: 'ClawHub', total: 55550 },
                    { sourceId: 'deepaiworker', sourceLabel: 'DeepSkillHub', total: 10638 },
                  ],
                },
              },
            };
          }

          if (path === '/api/clawhub/list' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: { success: true, results: [] },
              },
            };
          }

          if (path === '/api/clawhub/search' && method === 'POST') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: { success: true, results: [], nextCursor: null },
              },
            };
          }

          return { ok: false, error: { message: `Unexpected hostapi:fetch request: ${method} ${path}` } };
        });
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-skills').click({ force: true });
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await page.getByTestId('skills-discover-button').click({ force: true });
      await expect(page.getByTestId('skills-marketplace-panel')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-source-tab-clawhub')).toContainText('55,550');
      await expect(page.getByTestId('skills-marketplace-source-tab-deepaiworker')).toContainText('10,638');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('opens marketplace detail when a marketplace card is selected', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string; body?: string | null }) => {
          const method = request?.method ?? 'GET';
          const path = request?.path ?? '';

          if (path === '/api/skills' && method === 'GET') {
            return { ok: true, data: { status: 200, ok: true, json: [] } };
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
                    { id: 'deepaiworker', label: 'DeepSkillHub', enabled: true, site: 'http://127.0.0.1:4000', workdir: '/tmp/deepaiworker' },
                  ],
                },
              },
            };
          }

          if (path === '/api/clawhub/source-counts' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  success: true,
                  results: [{ sourceId: 'deepaiworker', sourceLabel: 'DeepSkillHub', total: 1 }],
                },
              },
            };
          }

          if (path === '/api/clawhub/list' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  success: true,
                  results: [
                    {
                      sourceId: 'deepaiworker',
                      slug: 'self-improving-agent',
                      displayName: 'Self Improving Agent',
                      summary: 'Iterates on its own behavior.',
                    },
                  ],
                },
              },
            };
          }

          if (path === '/api/clawhub/search' && method === 'POST') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  success: true,
                  results: [
                    {
                      sourceId: 'deepaiworker',
                      slug: 'self-improving-agent',
                      displayName: 'Self Improving Agent',
                      summary: 'Iterates on its own behavior.',
                    },
                  ],
                  nextCursor: null,
                },
              },
            };
          }

          if (path === '/api/clawhub/skill-detail' && method === 'POST') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  success: true,
                  detail: {
                    sourceId: 'deepaiworker',
                    requestedSlug: 'self-improving-agent',
                    resolvedSlug: 'self-improving-agent',
                    owner: { displayName: 'DeepSkillHub' },
                    skill: {
                      slug: 'self-improving-agent',
                      displayName: 'Self Improving Agent',
                      description: 'Iterates on its own behavior.',
                      summary: 'Iterates on its own behavior.',
                    },
                    latestVersion: {
                      version: '1.0.0',
                      rawMarkdown: '# Self Improving Agent\n\nIterates on its own behavior.',
                      files: [],
                    },
                  },
                },
              },
            };
          }

          return { ok: false, error: { message: `Unexpected hostapi:fetch request: ${method} ${path}` } };
        });
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-skills').click({ force: true });
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await page.getByTestId('skills-discover-button').click({ force: true });
      await expect(page.getByTestId('skills-marketplace-panel')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-item-deepaiworker-self-improving-agent')).toBeVisible();

      await page.getByTestId('skills-marketplace-item-deepaiworker-self-improving-agent').click({ force: true });
      await expect(page.getByTestId('skills-marketplace-detail-page')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-detail-title')).toHaveText('Self Improving Agent');
      await expect(page.getByTestId('skills-marketplace-detail-content')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-detail-docs')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
