import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const SESSION_KEY = 'agent:main:timestamp-display';
const SESSION_LABEL = 'Timestamp Display';
const MAIN_SESSION_KEY = 'agent:main:main';

function hostApiKey(path: string, method = 'GET'): string {
  return JSON.stringify([path, method]);
}

function okJson(json: unknown) {
  return {
    ok: true,
    data: {
      status: 200,
      ok: true,
      json,
    },
  };
}

function atLocalTime(dayOffset: number, hour: number, minute: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute);
}

function toSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function formatExpectedAbsolute(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${hours}:${minutes}`;
}

test.describe('Chat message timestamps', () => {
  test('shows today, yesterday, and older dates in message metadata', async ({ launchElectronApp }) => {
    const todayAt1030 = atLocalTime(0, 10, 30);
    const yesterdayAt1030 = atLocalTime(-1, 10, 30);
    const olderAt1030 = atLocalTime(-2, 10, 30);
    const historyMessages = [
      {
        id: 'timestamp-today-user',
        role: 'user',
        content: 'Today timestamp sample',
        timestamp: toSeconds(todayAt1030),
      },
      {
        id: 'timestamp-yesterday-assistant',
        role: 'assistant',
        content: 'Yesterday timestamp reply',
        timestamp: toSeconds(yesterdayAt1030),
      },
      {
        id: 'timestamp-older-user',
        role: 'user',
        content: 'Older timestamp sample',
        timestamp: toSeconds(olderAt1030),
      },
    ];

    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
        hostApi: {
          [hostApiKey('/api/settings')]: okJson({
            setupComplete: true,
            language: 'zh',
            theme: 'system',
            sidebarCollapsed: false,
            sidebarWidth: 256,
            assistantMessageStyle: 'bubble',
            chatProcessDisplayMode: 'all',
            hideInternalRoutineProcesses: true,
            chatFontScale: 100,
          }),
          [hostApiKey('/api/gateway/status')]: okJson({
            state: 'running',
            port: 18789,
            pid: 12345,
            connectedAt: Date.now(),
          }),
          [hostApiKey('/api/agents')]: okJson({
            success: true,
            agents: [
              {
                id: 'main',
                name: 'Main Role',
                default: true,
                mainSessionKey: MAIN_SESSION_KEY,
              },
            ],
          }),
          [hostApiKey('/api/provider-accounts')]: okJson([]),
          [hostApiKey('/api/provider-account-statuses')]: okJson([]),
          [hostApiKey('/api/provider-vendors')]: okJson([]),
          [hostApiKey('/api/provider-accounts/default')]: okJson(null),
          [hostApiKey('/api/sessions/catalog')]: okJson({
            success: true,
            sessions: [
              {
                key: SESSION_KEY,
                label: SESSION_LABEL,
                updatedAt: Date.now(),
              },
            ],
            previews: {},
          }),
          [hostApiKey('/api/sessions/list')]: okJson({
            success: true,
            sessions: [
              {
                key: SESSION_KEY,
                label: SESSION_LABEL,
                updatedAt: Date.now(),
              },
            ],
          }),
          [hostApiKey('/api/sessions/metadata', 'POST')]: okJson({
            success: true,
            metadata: {},
          }),
          [hostApiKey('/api/sessions/history', 'POST')]: okJson({
            success: true,
            resolved: true,
            thinkingLevel: null,
            messages: historyMessages,
          }),
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });

      const sessionButton = page.getByTestId(`sidebar-session-${SESSION_KEY}`).locator('button').first();
      await expect(sessionButton).toBeVisible({ timeout: 20_000 });
      await sessionButton.click({ force: true });

      const todayRow = page.getByTestId('chat-message-row-user').filter({ hasText: 'Today timestamp sample' });
      await expect(todayRow).toBeVisible({ timeout: 30_000 });
      await expect(todayRow.getByText('今天 10:30')).toBeHidden();
      await todayRow.hover();
      await expect(todayRow.getByText('今天 10:30')).toBeVisible();

      const yesterdayShell = page.getByTestId('chat-assistant-message-shell').filter({ hasText: 'Yesterday timestamp reply' });
      await expect(yesterdayShell).toBeVisible();
      await expect(yesterdayShell.getByText('昨天 10:30')).toBeVisible();
      await expect(yesterdayShell.getByTestId('chat-message-meta-assistant')).toBeVisible();

      const olderRow = page.getByTestId('chat-message-row-user').filter({ hasText: 'Older timestamp sample' });
      await expect(olderRow).toBeVisible();
      await expect(olderRow.getByText(formatExpectedAbsolute(olderAt1030))).toBeHidden();
      await olderRow.hover();
      await expect(olderRow.getByText(formatExpectedAbsolute(olderAt1030))).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
