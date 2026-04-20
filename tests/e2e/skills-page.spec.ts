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
      await expect(page.getByTestId('skills-tutorial-button')).toBeVisible();
      await expect(page.getByTestId('skills-create-button')).toBeVisible();
      await expect(page.getByTestId('skills-discover-button')).toBeVisible();
      await expect(page.getByTestId('skills-tutorial-button')).toHaveClass(/rounded-lg/);
      await expect(page.getByTestId('skills-tutorial-button')).toHaveClass(/px-4/);
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

  test('shows total skill counts for marketplace sources', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await app.evaluate(({ ipcMain }) => {
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
      await expect(page.getByTestId('skills-marketplace-modal')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-source-count-clawhub')).toHaveText('55,550');
      await expect(page.getByTestId('skills-marketplace-source-count-deepaiworker')).toHaveText('10,638');
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
      await expect(page.getByTestId('skills-marketplace-modal')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-item-deepaiworker-self-improving-agent')).toBeVisible();

      await page.getByTestId('skills-marketplace-item-deepaiworker-self-improving-agent').click();
      await expect(page.getByTestId('skills-marketplace-modal')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-search-input')).toHaveCount(0);
      await expect(page.getByTestId('skills-marketplace-detail-content')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-detail-title')).toHaveText('Self Improving Agent');
      await expect(page.getByTestId('skills-marketplace-detail-docs')).toBeVisible();
      await expect(page.getByText('This is the full skill document.')).toBeVisible();
      await expect(page.getByTestId('skills-marketplace-detail-files')).toBeVisible();
      await expect(page.getByText('6ef2c135267c1173b6b065f73be4aad7fb51acabc500a4fe64b6df846125ecb6')).toHaveCount(0);
      await expect(page.getByText('Source')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Installed|已安装/ })).toBeDisabled();

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
