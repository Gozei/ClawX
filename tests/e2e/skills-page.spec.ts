import { closeElectronApp, expect, getStableWindow, openSettingsHub, test } from './fixtures/electron';

test.describe('Deep AI Worker skills page flows', () => {
  test('keeps the empty state and embedded marketplace usable without runtime skills', async ({ launchElectronApp }) => {
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
      await expect(page.getByTestId('skills-tutorial-button')).toBeVisible();
      await expect(page.getByTestId('skills-create-button')).toHaveCount(0);
      await expect(page.getByTestId('skills-discover-button')).toBeVisible();
      await expect(page.getByTestId('skills-tutorial-button')).toHaveClass(/rounded-lg/);
      await expect(page.getByTestId('skills-tutorial-button')).toHaveClass(/px-4/);
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
      await expect(page.getByTestId('skills-marketplace-panel')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-search-input')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-search-input')).toHaveClass(/rounded-full/);
      await expect(page.getByTestId('skills-marketplace-source-tabs')).toBeVisible();
      await expect(page.locator('[data-testid^="skills-marketplace-source-tab-"]')).toHaveCount(2);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows total skill counts for marketplace sources', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await app.evaluate(({ ipcMain }) => {
        const state = globalThis as typeof globalThis & { __skillsSourceCountsRequests?: number };
        state.__skillsSourceCountsRequests = 0;
        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
          const method = request?.method ?? 'GET';
          const path = request?.path ?? '';

          if (path === '/api/skills' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: [],
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
                      id: 'clawhub',
                      label: 'ClawHub',
                      enabled: true,
                      site: 'https://clawhub.ai',
                      workdir: 'C:/Users/test/.openclaw/skill-sources/clawhub',
                    },
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
            state.__skillsSourceCountsRequests = (state.__skillsSourceCountsRequests ?? 0) + 1;
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
                  results: [],
                  nextCursor: null,
                },
              },
            };
          }

          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {},
            },
          };
        });
      });

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();

      await page.getByTestId('skills-discover-button').click();
      await expect(page.getByTestId('skills-marketplace-panel')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-source-tab-clawhub')).toContainText('55,550');
      await expect(page.getByTestId('skills-marketplace-source-tab-deepaiworker')).toContainText('10,638');

      await page.getByTestId('skills-discover-button').click();
      await expect(page.getByTestId('skills-marketplace-panel')).toHaveCount(0);

      await page.getByTestId('skills-discover-button').click();
      await expect(page.getByTestId('skills-marketplace-panel')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-source-tab-clawhub')).toContainText('55,550');
      await expect(page.getByTestId('skills-marketplace-source-tab-deepaiworker')).toContainText('10,638');

      await expect.poll(async () => await app.evaluate(() => {
        const state = globalThis as typeof globalThis & { __skillsSourceCountsRequests?: number };
        return state.__skillsSourceCountsRequests ?? 0;
      })).toBe(2);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('opens marketplace skill detail when a card is clicked', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string; body?: string | null }) => {
          const method = request?.method ?? 'GET';
          const path = request?.path ?? '';
          const body = request?.body ? JSON.parse(request.body) : {};

          if (path === '/api/skills' && method === 'GET') {
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: [],
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
                  results: [
                    {
                      slug: 'self-improving-agent',
                      version: '3.0.13',
                      sourceId: 'deepaiworker',
                      sourceLabel: 'DeepSkillHub',
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
                      slug: 'self-improving-agent',
                      name: 'Self Improving Agent',
                      description: 'Captures learnings and errors.',
                      version: '3.0.13',
                      author: 'clawhub',
                      sourceId: 'deepaiworker',
                      sourceLabel: 'DeepSkillHub',
                    },
                  ],
                  nextCursor: null,
                },
              },
            };
          }

          if (path === '/api/clawhub/skill-detail' && method === 'POST') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).__clawxE2eSkillDetailRequests = [
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ...((globalThis as any).__clawxE2eSkillDetailRequests ?? []),
              body,
            ];
            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  success: true,
                  detail: {
                    requestedSlug: 'self-improving-agent',
                    resolvedSlug: 'self-improving-agent',
                    pendingReview: false,
                    owner: {
                      handle: 'clawhub',
                      displayName: 'From ClawHub',
                    },
                    skill: {
                      slug: 'self-improving-agent',
                      displayName: 'Self Improving Agent',
                      description: 'Captures learnings and errors.',
                      summary: 'Captures learnings and errors to enable continuous improvement.',
                      stats: {
                        downloads: 383653,
                        stars: 3152,
                        versions: 1,
                      },
                      tags: {
                        latest: '3.0.13',
                      },
                    },
                    latestVersion: {
                      version: '3.0.13',
                      changelog: '- Initial release.',
                      rawMarkdown: '# Self Improving Agent\n\nThis is the full skill document.',
                      parsed: {
                        license: 'MIT-0',
                      },
                      staticScan: {
                        status: 'clean',
                        summary: 'No suspicious patterns detected.',
                        engineVersion: 'v2.4.0',
                        checkedAt: 1776137654368,
                      },
                      files: [
                        {
                          contentType: 'text/plain',
                          path: 'SKILL.md',
                          sha256: '6ef2c135267c1173b6b065f73be4aad7fb51acabc500a4fe64b6df846125ecb6',
                          size: 21606,
                        },
                        {
                          contentType: 'text/plain',
                          path: '_meta.json',
                          sha256: '6d43da44f18d5103926cdba903193a8b01ec945ff86a55bcd239af83ba483e08',
                          size: 140,
                        },
                      ],
                    },
                  },
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

      await page.getByTestId('sidebar-nav-skills').click();
      await expect(page.getByTestId('skills-page')).toBeVisible();

      await page.getByTestId('skills-discover-button').click();
      await expect(page.getByTestId('skills-marketplace-panel')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-item-deepaiworker-self-improving-agent')).toBeVisible();

      await page.getByTestId('skills-marketplace-item-deepaiworker-self-improving-agent').click();
      await expect(page.getByTestId('skills-marketplace-detail-page')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-search-input')).toHaveCount(0);
      await expect(page.getByTestId('skills-marketplace-detail-content')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-detail-close')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-detail-title')).toHaveText('Self Improving Agent');
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
