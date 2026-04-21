# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-history-refresh-hydration.spec.ts >> Chat history refresh hydration >> hydrates a missing final assistant reply after the initial history load
- Location: tests\e2e\chat-history-refresh-hydration.spec.ts:71:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('main-layout')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByTestId('main-layout')

```

# Test source

```ts
  1   | import { mkdir, writeFile } from 'node:fs/promises';
  2   | import { join } from 'node:path';
  3   | import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
  4   | 
  5   | const SESSION_KEY = 'agent:main:history-refresh-hydration-test';
  6   | const SESSION_FILE = 'history-refresh-hydration-test.jsonl';
  7   | const SESSION_LABEL = 'History refresh hydration session';
  8   | const EARLIER_USER_TEXT = 'Earlier seeded question.';
  9   | const EARLIER_ASSISTANT_TEXT = 'Earlier seeded answer.';
  10  | const USER_TEXT = 'Who are you? '.repeat(10).trim();
  11  | const FINAL_TEXT = 'I am ClawX.';
  12  | 
  13  | function buildSeededMessages(includeAssistant: boolean) {
  14  |   const baseTimestamp = Math.floor(Date.now() / 1000);
  15  |   return [
  16  |     {
  17  |       id: 'user-0',
  18  |       role: 'user',
  19  |       content: EARLIER_USER_TEXT,
  20  |       timestamp: baseTimestamp - 2,
  21  |     },
  22  |     {
  23  |       id: 'assistant-0',
  24  |       role: 'assistant',
  25  |       content: EARLIER_ASSISTANT_TEXT,
  26  |       timestamp: baseTimestamp - 1,
  27  |     },
  28  |     {
  29  |       id: 'user-1',
  30  |       role: 'user',
  31  |       content: USER_TEXT,
  32  |       timestamp: baseTimestamp,
  33  |     },
  34  |     ...(includeAssistant
  35  |       ? [{
  36  |           id: 'assistant-1',
  37  |           role: 'assistant',
  38  |           content: FINAL_TEXT,
  39  |           timestamp: baseTimestamp + 1,
  40  |         }]
  41  |       : []),
  42  |   ];
  43  | }
  44  | 
  45  | async function writeSession(homeDir: string, includeAssistant: boolean): Promise<void> {
  46  |   const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  47  |   await mkdir(sessionsDir, { recursive: true });
  48  |   await writeFile(
  49  |     join(sessionsDir, 'sessions.json'),
  50  |     JSON.stringify({
  51  |       sessions: [
  52  |         {
  53  |           key: SESSION_KEY,
  54  |           id: 'history-refresh-hydration-test',
  55  |           file: SESSION_FILE,
  56  |           label: SESSION_LABEL,
  57  |           updatedAt: Date.now(),
  58  |         },
  59  |       ],
  60  |     }, null, 2),
  61  |     'utf8',
  62  |   );
  63  |   await writeFile(
  64  |     join(sessionsDir, SESSION_FILE),
  65  |     `${buildSeededMessages(includeAssistant).map((message) => JSON.stringify(message)).join('\n')}\n`,
  66  |     'utf8',
  67  |   );
  68  | }
  69  | 
  70  | test.describe('Chat history refresh hydration', () => {
  71  |   test('hydrates a missing final assistant reply after the initial history load', async ({ homeDir, launchElectronApp }) => {
  72  |     await writeSession(homeDir, false);
  73  | 
  74  |     const app = await launchElectronApp({ skipSetup: true });
  75  | 
  76  |     try {
  77  |       const page = await getStableWindow(app);
> 78  |       await expect(page.getByTestId('main-layout')).toBeVisible();
      |                                                     ^ Error: expect(locator).toBeVisible() failed
  79  | 
  80  |       const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
  81  |       if (await sessionRow.count() === 0) {
  82  |         const startResult = await page.evaluate(async () => (
  83  |           await window.electron.ipcRenderer.invoke('gateway:start')
  84  |         ) as { success?: boolean; error?: string });
  85  |         expect(startResult?.success, startResult?.error || 'gateway:start failed during E2E setup').toBe(true);
  86  |       }
  87  |       await expect(sessionRow).toBeVisible({ timeout: 60_000 });
  88  |       await sessionRow.click();
  89  | 
  90  |       const userMessages = page.getByTestId('chat-message-content-user').filter({ hasText: USER_TEXT });
  91  |       await expect(page.getByText(USER_TEXT, { exact: true })).toBeVisible({ timeout: 60_000 });
  92  |       await expect(userMessages).toHaveCount(1);
  93  |       await expect(page.getByText(FINAL_TEXT, { exact: true })).toHaveCount(0);
  94  | 
  95  |       await writeSession(homeDir, true);
  96  |       await page.getByTestId('chat-refresh-button').click();
  97  | 
  98  |       await expect(page.getByText(FINAL_TEXT, { exact: true })).toBeVisible({ timeout: 60_000 });
  99  |       await expect(userMessages).toHaveCount(1);
  100 |       await expect(page.getByTestId('chat-active-turn-bottom-spacer')).toHaveCount(0);
  101 | 
  102 |       const [finalMessageBox, composerBox] = await Promise.all([
  103 |         page.getByTestId('chat-assistant-message-shell').last().boundingBox(),
  104 |         page.getByTestId('chat-composer').boundingBox(),
  105 |       ]);
  106 | 
  107 |       if (finalMessageBox && composerBox) {
  108 |         const gap = composerBox.y - (finalMessageBox.y + finalMessageBox.height);
  109 |         expect(gap).toBeGreaterThan(0);
  110 |       }
  111 | 
  112 |       const scrollContainer = page.getByTestId('chat-scroll-container');
  113 |       await scrollContainer.hover();
  114 |       await page.mouse.wheel(0, -180);
  115 |       await expect(page.getByText(EARLIER_ASSISTANT_TEXT, { exact: true })).toBeVisible();
  116 |       await expect(page.getByText(USER_TEXT, { exact: true })).toBeVisible();
  117 |     } finally {
  118 |       await closeElectronApp(app);
  119 |     }
  120 |   });
  121 | });
  122 | 
```