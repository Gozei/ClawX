import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const RECENT_SESSION_KEY = 'agent:main:session-latest';
const RECENT_SESSION_LABEL = 'Recovered startup session';
const MAIN_SESSION_KEY = 'agent:main:desk';
const MAIN_SESSION_LABEL = 'Desk';
const SLOW_SESSION_KEY = 'agent:main:session-slow-history';

test.describe('Chat startup new session', () => {
  test('keeps the blank new chat selected on launch even when history exists', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
        hostApi: {
          '["/api/gateway/status","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                state: 'running',
                port: 18789,
                pid: 12345,
                connectedAt: Date.now(),
              },
            },
          },
          '["/api/agents","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [
                  {
                    id: 'main',
                    name: 'Main Role',
                    default: true,
                    mainSessionKey: MAIN_SESSION_KEY,
                  },
                ],
              },
            },
          },
          '["/api/sessions/list","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                sessions: [
                  {
                    key: RECENT_SESSION_KEY,
                    label: RECENT_SESSION_LABEL,
                    updatedAt: Date.now(),
                  },
                  {
                    key: MAIN_SESSION_KEY,
                    displayName: MAIN_SESSION_LABEL,
                    updatedAt: Date.now() - 1_000,
                  },
                ],
              },
            },
          },
          '["/api/sessions/metadata","POST"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                metadata: {},
              },
            },
          },
          '["/api/sessions/history","POST"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                resolved: true,
                thinkingLevel: null,
                messages: [],
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const recentSessionButton = page.getByTestId(`sidebar-session-${RECENT_SESSION_KEY}`).locator('button').first();
      const mainSessionButton = page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).locator('button').first();

      await expect(page.getByTestId('chat-welcome-title')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(RECENT_SESSION_LABEL, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(MAIN_SESSION_LABEL, { exact: true }).first()).toBeVisible();
      await expect(recentSessionButton).not.toHaveClass(/font-medium/);
      await expect(mainSessionButton).not.toHaveClass(/font-medium/);
      await expect(page.getByText('Recovered startup history.', { exact: true })).toHaveCount(0);

      const mainPane = page.getByTestId('chat-main-pane');
      const composer = page.getByTestId('chat-composer');
      await expect(composer).toBeVisible({ timeout: 30_000 });

      const [mainPaneBox, composerBox] = await Promise.all([
        mainPane.boundingBox(),
        composer.boundingBox(),
      ]);

      expect(mainPaneBox).not.toBeNull();
      expect(composerBox).not.toBeNull();
      expect(Math.abs(
        ((composerBox?.x ?? 0) + ((composerBox?.width ?? 0) / 2))
        - ((mainPaneBox?.x ?? 0) + ((mainPaneBox?.width ?? 0) / 2)),
      )).toBeLessThanOrEqual(2);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('defers the empty-session loading spinner while history hydration starts', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
      });
      await app.evaluate(({ ipcMain }, params) => {
        const okJson = (json: Record<string, unknown>) => ({
          ok: true,
          data: {
            status: 200,
            ok: true,
            json,
          },
        });

        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
          const method = request?.method ?? 'GET';
          const path = request?.path ?? '';

          if (method === 'GET' && path === '/api/gateway/status') {
            return okJson({ state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() });
          }
          if (method === 'GET' && path === '/api/agents') {
            return okJson({
              success: true,
              agents: [
                {
                  id: 'main',
                  name: 'Main Role',
                  default: true,
                  mainSessionKey: params.mainSessionKey,
                },
              ],
            });
          }
          if (method === 'GET' && path === '/api/sessions/catalog') {
            return okJson({
              success: true,
              sessions: [
                {
                  key: params.sessionKey,
                  label: 'Slow history',
                  updatedAt: Date.now(),
                },
              ],
              previews: {},
            });
          }
          if (method === 'POST' && path === '/api/sessions/previews') {
            return okJson({ success: true, previews: {} });
          }
          if (method === 'POST' && path === '/api/sessions/history') {
            return await new Promise(() => {
              // Keep the request pending so the renderer-side loading timer is deterministic.
            });
          }

          return {
            ok: false,
            error: {
              message: `Unexpected hostapi:fetch request: ${method} ${path}`,
            },
          };
        });
      }, {
        mainSessionKey: MAIN_SESSION_KEY,
        sessionKey: SLOW_SESSION_KEY,
      });

      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-welcome-title')).toBeVisible({ timeout: 30_000 });
      await page.clock.install();

      await page.getByTestId(`sidebar-session-button-${SLOW_SESSION_KEY}`).click();
      await page.clock.runFor(0);
      expect(await page.getByTestId('chat-session-loading').count()).toBe(0);

      await page.clock.runFor(180);
      await expect(page.getByTestId('chat-session-loading')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
