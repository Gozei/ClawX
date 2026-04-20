import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:desk';
const RESEARCH_SESSION_KEY = 'agent:research:desk';

async function allocateGatewayPort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a gateway port for E2E')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function seedOpenClawConfig(homeDir: string): Promise<void> {
  const configDir = join(homeDir, '.openclaw');
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, 'openclaw.json'),
    JSON.stringify({
      session: {
        mainKey: 'desk',
      },
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main Role',
            default: true,
          },
          {
            id: 'research',
            name: 'Research Role',
          },
        ],
      },
    }, null, 2),
    'utf8',
  );
}

async function seedAgentSession(
  homeDir: string,
  agentId: string,
  sessionKey: string,
  sessionId: string,
  label: string,
  messageText: string,
  updatedAt: number,
): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', agentId, 'sessions');
  const sessionFile = `${sessionId}.jsonl`;
  const timestamp = new Date(updatedAt).toISOString();

  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      [sessionKey]: {
        sessionId,
        id: sessionId,
        file: sessionFile,
        label,
        updatedAt,
      },
    }, null, 2),
    'utf8',
  );
  await writeFile(
    join(sessionsDir, sessionFile),
    [
      JSON.stringify({
        type: 'session',
        id: sessionId,
        timestamp,
        cwd: homeDir,
      }),
      JSON.stringify({
        type: 'message',
        id: `${sessionId}-user-1`,
        timestamp,
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: messageText,
            },
          ],
        },
      }),
    ].join('\n'),
    'utf8',
  );
}

test.describe('Chat new session default role', () => {
  test('resets the toolbar role to the configured default role after switching away', async ({ homeDir, launchElectronApp }) => {
    test.slow();
    const now = Date.now();
    await seedOpenClawConfig(homeDir);
    await seedAgentSession(homeDir, 'main', MAIN_SESSION_KEY, 'desk', 'Main desk', 'Main seed message', now - 1_000);
    await seedAgentSession(homeDir, 'research', RESEARCH_SESSION_KEY, 'desk', 'Research desk', 'Research seed message', now);
    const gatewayPort = await allocateGatewayPort();

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.evaluate(async (port) => {
        await window.electron.ipcRenderer.invoke('settings:set', 'gatewayPort', port);
      }, gatewayPort);

      const startResult = await page.evaluate(async () => {
        return await window.electron.ipcRenderer.invoke('gateway:start');
      }) as { success?: boolean; error?: string };
      expect(startResult?.success, startResult?.error || 'gateway:start failed during E2E setup').toBe(true);

      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      await expect(page.getByTestId(`sidebar-session-role-${MAIN_SESSION_KEY}`)).toHaveText('Main Role', { timeout: 60_000 });
      await expect(page.getByTestId(`sidebar-session-role-${RESEARCH_SESSION_KEY}`)).toHaveText('Research Role', { timeout: 60_000 });

      await page.getByTestId(`sidebar-session-${RESEARCH_SESSION_KEY}`).locator('button').first().click();
      await expect(page.getByTestId('chat-toolbar-current-agent-name')).toHaveText('Research Role');
      await expect.poll(async () => {
        return await page.evaluate(() => {
          const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
          return scrollContainer?.textContent?.includes('Research seed message') ?? false;
        });
      }, { timeout: 30_000 }).toBe(true);
      await expect.poll(async () => {
        return await page.evaluate(() => {
          const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
          if (!scrollContainer) {
            return null;
          }

          return window.getComputedStyle(scrollContainer).overflowX;
        });
      }, { timeout: 10_000 }).toBe('hidden');

      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByTestId('chat-toolbar-current-agent-name')).toHaveText('Main Role');
    } finally {
      try {
        const page = await getStableWindow(app);
        await page.evaluate(async () => {
          try {
            await window.electron.ipcRenderer.invoke('gateway:stop');
          } catch {
            // ignore gateway shutdown failures during test cleanup
          }
        });
      } catch {
        // ignore cleanup failures before closing the Electron app
      }
      await closeElectronApp(app);
    }
  });
});
