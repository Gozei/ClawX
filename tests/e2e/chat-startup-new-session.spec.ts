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
    } finally {
      await closeElectronApp(app);
    }
  });
});
