import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

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
      await expect(page.getByText('This is the full skill document.')).toBeVisible();
      const detailTestIds = await page.getByTestId('skills-marketplace-detail-content').evaluate((node) => {
        return Array.from(node.querySelectorAll('[data-testid]'))
          .map((element) => element.getAttribute('data-testid'))
          .filter(Boolean);
      });
      expect(detailTestIds).toContain('skills-marketplace-detail-tab-docs');
      expect(detailTestIds).toContain('skills-marketplace-detail-tab-details');
      await expect(page.getByText('6ef2c135267c1173b6b065f73be4aad7fb51acabc500a4fe64b6df846125ecb6')).toHaveCount(0);
      await expect(page.getByText('Source')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Installed|已安装/ })).toBeDisabled();
      await page.getByTestId('skills-marketplace-detail-close').click();
      await expect(page.getByTestId('skills-marketplace-panel')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-search-input')).toBeVisible();

      const detailRequests = await app.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (globalThis as any).__clawxE2eSkillDetailRequests ?? [];
      });
      expect(detailRequests).toEqual([
        { slug: 'self-improving-agent', sourceId: 'deepaiworker' },
      ]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('blocks marketplace installation when the same skill already exists outside marketplace sources', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
          const method = request?.method ?? 'GET';
          const path = request?.path ?? '';

          if (path === '/api/gateway/status' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  state: 'running',
                  port: 18789,
                  pid: 12345,
                },
              },
            };
          }

          if (path === '/api/skills' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: [
                  {
                    id: 'self-improving-agent',
                    slug: 'self-improving-agent',
                    name: 'Self Improving Agent',
                    description: 'Bundled managed copy.',
                    enabled: true,
                    ready: true,
                    baseDir: 'C:/Users/test/.openclaw/skills/self-improving-agent',
                  },
                ],
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
                      label: 'DeepSkillHub',
                      enabled: true,
                      site: 'http://124.71.100.127:4000',
                      workdir: 'C:/Users/test/.openclaw/skill-sources/deepaiworker',
                    },
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
                json: {
                  success: true,
                  results: [],
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
                      slug: 'self-improving-agent',
                      name: 'Self Improving Agent',
                      description: 'Captures learnings and errors.',
                      version: '3.0.13',
                      author: 'deepaiworker',
                      sourceId: 'deepaiworker',
                      sourceLabel: 'DeepSkillHub',
                    },
                  ],
                  nextCursor: null,
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
      await page.reload();

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('gateway:status-changed', {
            state: 'running',
            port: 18789,
            pid: 12345,
          });
        });
      });

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-list-item-self-improving-agent')).toBeVisible();

      await page.getByTestId('skills-discover-button').click();
      await expect(page.getByTestId('skills-marketplace-panel')).toBeVisible();

      const marketplaceItem = page.getByTestId('skills-marketplace-item-deepaiworker-self-improving-agent');
      await expect(marketplaceItem).toBeVisible();

      const blockedButton = marketplaceItem.locator('button').first();
      await expect(blockedButton).toBeDisabled();
      await expect(marketplaceItem).toContainText(/Provided by another source|已由其他来源提供|他のソース/);
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

      await openSettingsHub(page);
      await page.getByTestId('settings-hub-menu-dashboard').click();
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

  test('opens the tutorial link from the skills page header', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(({ ipcMain }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__clawxE2eOpenExternalCalls = [];

        ipcMain.removeHandler('shell:openExternal');
        ipcMain.handle('shell:openExternal', async (_event, url: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxE2eOpenExternalCalls.push(url);
        });
      });

      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();

      await page.getByTestId('skills-tutorial-button').click();

      const openExternalCalls = await app.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (globalThis as any).__clawxE2eOpenExternalCalls ?? [];
      });

      expect(openExternalCalls).toEqual([
        'https://docs.qq.com/aio/p/scchzbdpjgz9ho4?p=UAoZoPrHjoUVZJKSBDhh62',
      ]);
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

          if (path === '/api/gateway/status' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  state: 'running',
                  port: 18789,
                  pid: 12345,
                },
              },
            };
          }

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
      await page.reload();

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('gateway:status-changed', {
            state: 'running',
            port: 18789,
            pid: 12345,
          });
        });
      });

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

  test('renders the redesigned configuration workspace and saves unified skill config from the detail page', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(({ ipcMain }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__clawxE2eSkillConfigSaveBody = null;

        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string; body?: string | null }) => {
          const method = request?.method ?? 'GET';
          const path = request?.path ?? '';
          const body = request?.body ? JSON.parse(request.body) : null;

          if (path === '/api/gateway/status' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: { state: 'running', port: 18789, pid: 12345 },
              },
            };
          }

          if (path === '/api/skills' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: [{
                  id: 'schedule-feishu',
                  slug: 'schedule-feishu',
                  name: 'schedule-feishu',
                  description: 'Feishu schedule helper.',
                  enabled: true,
                  ready: false,
                  version: '1.0.0',
                  missing: { env: ['FEISHU_APP_SECRET'], config: ['schedule_doc_url'] },
                  baseDir: 'C:/Users/test/.openclaw/skills/schedule-feishu',
                }],
              },
            };
          }

          if (path === '/api/skills/schedule-feishu' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  identity: {
                    id: 'schedule-feishu',
                    slug: 'schedule-feishu',
                    name: 'schedule-feishu',
                    description: 'Feishu schedule helper.',
                    version: '1.0.0',
                    baseDir: 'C:/Users/test/.openclaw/skills/schedule-feishu',
                  },
                  status: {
                    enabled: true,
                    ready: false,
                    missing: { env: ['FEISHU_APP_SECRET'], config: ['schedule_doc_url'] },
                  },
                  requirements: {
                    primaryEnv: 'FEISHU_APP_SECRET',
                    requires: {
                      env: ['FEISHU_APP_SECRET'],
                      config: ['schedule_doc_url'],
                    },
                    rawMarkdown: '# Schedule',
                  },
                  config: {
                    apiKey: '',
                    env: { FEISHU_APP_ID: 'cli_test' },
                    config: { schedule_doc_url: '' },
                    envFilePath: 'C:/Users/test/.openclaw/skills/schedule-feishu/config/.env',
                    configFilePath: 'C:/Users/test/.openclaw/skills/schedule-feishu/config.json',
                  },
                  configuration: {
                    credentials: [
                      {
                        key: 'FEISHU_APP_SECRET',
                        label: 'FEISHU_APP_SECRET',
                        type: 'secret',
                        required: true,
                        configured: false,
                        value: '',
                        source: 'apiKey',
                        storageTargets: [{ kind: 'managed-apiKey' }],
                      },
                    ],
                    optional: [
                      {
                        key: 'FEISHU_APP_ID',
                        label: 'FEISHU_APP_ID',
                        type: 'env',
                        required: false,
                        configured: true,
                        value: 'cli_test',
                        source: 'env',
                        storageTargets: [{ kind: 'managed-env', key: 'FEISHU_APP_ID' }],
                      },
                    ],
                    config: [
                      {
                        key: 'schedule_doc_url',
                        label: 'schedule_doc_url',
                        type: 'url',
                        required: true,
                        configured: false,
                        value: '',
                        source: 'config',
                        storageTargets: [{ kind: 'managed-config', key: 'schedule_doc_url' }],
                      },
                    ],
                    runtime: [
                      { key: 'env:FEISHU_APP_SECRET', label: 'FEISHU_APP_SECRET', category: 'env', status: 'missing' },
                      { key: 'config:schedule_doc_url', label: 'schedule_doc_url', category: 'config', status: 'missing' },
                    ],
                    mirrors: {
                      envFilePath: 'C:/Users/test/.openclaw/skills/schedule-feishu/config/.env',
                      configFilePath: 'C:/Users/test/.openclaw/skills/schedule-feishu/config.json',
                    },
                  },
                },
              },
            };
          }

          if (path === '/api/skills/schedule-feishu/config' && method === 'PUT') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).__clawxE2eSkillConfigSaveBody = body;
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
                  results: [],
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
                  results: [],
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
                  results: [],
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
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('gateway:status-changed', {
            state: 'running',
            port: 18789,
            pid: 12345,
          });
        });
      });

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('skills-list-item-schedule-feishu')).toBeVisible();
      await page.getByTestId('skills-list-item-schedule-feishu').click();
      await expect(page.getByTestId('skills-detail-page')).toBeVisible();
      await page.getByTestId('skills-detail-tab-config').click();

      await page.getByTestId('skills-config-overview').waitFor();
      await expect(page.getByTestId('skills-config-metric-credentials')).toContainText('0/1');
      await expect(page.getByTestId('skills-config-metric-config')).toContainText('1');
      await expect(page.getByTestId('skills-config-metric-runtime')).toContainText('2');
      await expect(page.getByTestId('skills-config-metric-missing')).toContainText('2');
      await expect(page.getByTestId('skills-config-card-credentials')).toBeVisible();
      await expect(page.getByTestId('skills-config-card-optional-env')).toBeVisible();
      await expect(page.getByTestId('skills-config-card-settings')).toBeVisible();
      await expect(page.getByTestId('skills-config-card-runtime')).toBeVisible();
      await expect(page.getByTestId('skills-config-card-storage')).toBeVisible();
      await expect(page.getByTestId('skills-runtime-missing-list')).toBeVisible();

      await page.getByTestId('skills-detail-primary-env-input').fill('secret-value');
      await page.getByText('Add variable').click();
      await page.getByPlaceholder(/KEY|键名/).last().fill('FEISHU_REGION');
      await page.getByPlaceholder(/VALUE|值/).last().fill('cn');
      await page.getByDisplayValue('').last().fill('https://docs.feishu.test/doc');
      await page.getByTestId('skills-detail-save-config').click();

      await expect.poll(async () => await app.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (globalThis as any).__clawxE2eSkillConfigSaveBody;
      })).toEqual({
        apiKey: 'secret-value',
        env: {
          FEISHU_APP_ID: 'cli_test',
          FEISHU_REGION: 'cn',
        },
        config: {
          schedule_doc_url: 'https://docs.feishu.test/doc',
        },
      });
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

  test('shows the disconnected gateway hint above new chat and keeps it visible on the skills page', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.waitForTimeout(500);

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('gateway:status-changed', {
            state: 'stopped',
            port: 18789,
          });
        });
      });

      const gatewayStatusHint = page.getByTestId('sidebar-gateway-status-hint');
      const newChatButton = page.getByTestId('sidebar-new-chat');

      await expect(gatewayStatusHint).toBeVisible();
      await expect(gatewayStatusHint).toContainText(/Gateway not connected|网关未连接/);
      await expect(page.getByTestId('sidebar-gateway-status-elapsed')).toHaveCount(0);
      await expect(page.getByTestId('sidebar-gateway-status-ellipsis')).toHaveCount(0);

      const hintBox = await gatewayStatusHint.boundingBox();
      const newChatBox = await newChatButton.boundingBox();
      expect(hintBox).not.toBeNull();
      expect(newChatBox).not.toBeNull();
      expect((hintBox?.y ?? 0) + (hintBox?.height ?? 0)).toBeLessThanOrEqual(newChatBox?.y ?? 0);

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();
      await expect(page.getByTestId('app-guide-overlay')).toHaveCount(0);
      await expect(gatewayStatusHint).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
