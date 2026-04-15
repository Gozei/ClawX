import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:session-preview-e2e';
const PREVIEW_TEXT = 'Session preview title from transcript';
const AUTO_LABEL_MAX_CHARS = 30;
const PERSISTED_PREVIEW_LABEL = Array.from(PREVIEW_TEXT).slice(0, AUTO_LABEL_MAX_CHARS).join('');

async function seedSessions(homeDir: string): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  const sessionId = 'session-preview-e2e';
  const sessionFile = `${sessionId}.jsonl`;
  const baseTimestamp = new Date().toISOString();
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      [SESSION_KEY]: {
        sessionId,
        id: sessionId,
        file: sessionFile,
        updatedAt: Date.now(),
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
        timestamp: baseTimestamp,
        cwd: homeDir,
      }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-1',
        timestamp: baseTimestamp,
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: PREVIEW_TEXT,
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-2',
        timestamp: new Date(Date.now() + 1000).toISOString(),
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Earlier assistant reply',
            },
          ],
        },
      }),
    ].join('\n'),
    'utf8',
  );
}

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

test.describe('Session preview labels', () => {
  test('hydrates sidebar titles from transcript previews and persists them', async ({ homeDir, userDataDir, launchElectronApp }) => {
    test.slow();
    await seedSessions(homeDir);
    const sessionsJsonPath = join(homeDir, '.openclaw', 'agents', 'main', 'sessions', 'sessions.json');
    const gatewayPort = await allocateGatewayPort();

    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const runtimeUserDataPath = await page.evaluate(async () => (
        await window.electron.ipcRenderer.invoke('app:getPath', 'userData')
      ) as string);
      expect(runtimeUserDataPath).toBe(userDataDir);

      await page.evaluate(async (port) => {
        await window.electron.ipcRenderer.invoke('settings:set', 'gatewayPort', port);
      }, gatewayPort);

      const configuredPort = await page.evaluate(async () => (
        await window.electron.ipcRenderer.invoke('settings:get', 'gatewayPort')
      ) as number);
      expect(configuredPort).toBe(gatewayPort);

      const startResult = await page.evaluate(async () => {
        return await window.electron.ipcRenderer.invoke('gateway:start');
      }) as { success?: boolean; error?: string };
      expect(startResult?.success, startResult?.error || 'gateway:start failed during E2E setup').toBe(true);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
      await expect(sessionRow).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId(`sidebar-session-title-${SESSION_KEY}`)).toHaveText(PERSISTED_PREVIEW_LABEL, { timeout: 60_000 });
      await expect.poll(async () => {
        const stored = JSON.parse(await readFile(sessionsJsonPath, 'utf8')) as Record<string, { label?: string }>;
        return stored[SESSION_KEY]?.label ?? null;
      }).toBe(PERSISTED_PREVIEW_LABEL);
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
