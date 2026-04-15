# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-history-refresh-hydration.spec.ts >> Chat history refresh hydration >> hydrates a missing final assistant reply after the initial history load
- Location: tests\e2e\chat-history-refresh-hydration.spec.ts:57:7

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1  | import { mkdir, writeFile } from 'node:fs/promises';
  2  | import { join } from 'node:path';
  3  | import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
  4  | 
  5  | const SESSION_KEY = 'agent:main:history-refresh-hydration-test';
  6  | const SESSION_FILE = 'history-refresh-hydration-test.jsonl';
  7  | const SESSION_LABEL = 'History refresh hydration session';
  8  | const USER_TEXT = 'Who are you?';
  9  | const FINAL_TEXT = 'I am ClawX.';
  10 | 
  11 | function buildSeededMessages(includeAssistant: boolean) {
  12 |   const baseTimestamp = Math.floor(Date.now() / 1000);
  13 |   return [
  14 |     {
  15 |       id: 'user-1',
  16 |       role: 'user',
  17 |       content: USER_TEXT,
  18 |       timestamp: baseTimestamp,
  19 |     },
  20 |     ...(includeAssistant
  21 |       ? [{
  22 |           id: 'assistant-1',
  23 |           role: 'assistant',
  24 |           content: FINAL_TEXT,
  25 |           timestamp: baseTimestamp + 1,
  26 |         }]
  27 |       : []),
  28 |   ];
  29 | }
  30 | 
  31 | async function writeSession(homeDir: string, includeAssistant: boolean): Promise<void> {
  32 |   const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  33 |   await mkdir(sessionsDir, { recursive: true });
  34 |   await writeFile(
  35 |     join(sessionsDir, 'sessions.json'),
  36 |     JSON.stringify({
  37 |       sessions: [
  38 |         {
  39 |           key: SESSION_KEY,
  40 |           id: 'history-refresh-hydration-test',
  41 |           file: SESSION_FILE,
  42 |           label: SESSION_LABEL,
  43 |           updatedAt: Date.now(),
  44 |         },
  45 |       ],
  46 |     }, null, 2),
  47 |     'utf8',
  48 |   );
  49 |   await writeFile(
  50 |     join(sessionsDir, SESSION_FILE),
  51 |     `${buildSeededMessages(includeAssistant).map((message) => JSON.stringify(message)).join('\n')}\n`,
  52 |     'utf8',
  53 |   );
  54 | }
  55 | 
  56 | test.describe('Chat history refresh hydration', () => {
  57 |   test('hydrates a missing final assistant reply after the initial history load', async ({ homeDir, launchElectronApp }) => {
  58 |     await writeSession(homeDir, false);
  59 | 
  60 |     const app = await launchElectronApp({ skipSetup: true });
  61 | 
  62 |     try {
  63 |       const page = await getStableWindow(app);
  64 |       await expect(page.getByTestId('main-layout')).toBeVisible();
  65 | 
  66 |       const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
> 67 |       await expect.poll(async () => await sessionRow.count(), {
     |       ^ Error: expect(received).toBeGreaterThan(expected)
  68 |         timeout: 60_000,
  69 |         intervals: [500, 1_000, 2_000],
  70 |       }).toBeGreaterThan(0);
  71 |       await expect(sessionRow).toBeVisible({ timeout: 60_000 });
  72 |       await sessionRow.click();
  73 | 
  74 |       const userMessages = page.getByTestId('chat-message-content-user').filter({ hasText: USER_TEXT });
  75 |       await expect(page.getByText(USER_TEXT, { exact: true })).toBeVisible({ timeout: 60_000 });
  76 |       await expect(userMessages).toHaveCount(1);
  77 |       await expect(page.getByText(FINAL_TEXT, { exact: true })).toHaveCount(0);
  78 | 
  79 |       await writeSession(homeDir, true);
  80 |       await page.getByTestId('chat-refresh-button').click();
  81 | 
  82 |       await expect(page.getByText(FINAL_TEXT, { exact: true })).toBeVisible({ timeout: 60_000 });
  83 |       await expect(userMessages).toHaveCount(1);
  84 |     } finally {
  85 |       await closeElectronApp(app);
  86 |     }
  87 |   });
  88 | });
  89 | 
```