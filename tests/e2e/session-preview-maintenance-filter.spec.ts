import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:session-maintenance-filter-e2e';
const SESSION_ID = 'session-maintenance-filter-e2e';
const REAL_PROMPT = 'What model are you using now?';
const REAL_REPLY = 'Using the workspace default model right now.';
const AUTO_LABEL_MAX_CHARS = 30;
const PERSISTED_PREVIEW_LABEL = Array.from(REAL_PROMPT).slice(0, AUTO_LABEL_MAX_CHARS).join('');

function buildAsyncMaintenanceMessage(): string {
  return [
    'System (untrusted): [2026-04-24 11:42:02 GMT+8] Exec failed (amber-lo, signal SIGTERM) :: Resolved 24 packages in 4.22s Downloading onnxruntime (16.9MiB) Downloading magika (12.7MiB) Downloading numpy (5.0MiB)',
    '',
    'An async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.',
    '',
    '\u5f53\u524d\u65f6\u95f4\uff1aFriday, April 24th, 2026 - 11:42\uff08Asia/Shanghai\uff09',
    '',
    REAL_PROMPT,
  ].join('\n');
}

async function seedSessions(homeDir: string): Promise<void> {
  const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  const sessionFile = `${SESSION_ID}.jsonl`;
  const baseTimestamp = new Date().toISOString();
  const nextTimestamp = new Date(Date.now() + 1_000).toISOString();

  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      [SESSION_KEY]: {
        sessionId: SESSION_ID,
        id: SESSION_ID,
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
        id: SESSION_ID,
        timestamp: baseTimestamp,
        cwd: homeDir,
      }),
      JSON.stringify({
        type: 'message',
        id: 'real-user-1',
        timestamp: baseTimestamp,
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildAsyncMaintenanceMessage(),
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'real-assistant-1',
        timestamp: nextTimestamp,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: REAL_REPLY,
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

test.describe('Session maintenance filtering', () => {
  test('hides internal async maintenance turns and uses the next real user prompt for the session preview', async ({ homeDir, userDataDir, launchElectronApp }) => {
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

      await sessionRow.locator('button').first().click();

      await expect(page.getByText(REAL_REPLY, { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('An async command you ran earlier has completed.')).toHaveCount(0);
      await expect(page.getByText('System (untrusted):')).toHaveCount(0);
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
