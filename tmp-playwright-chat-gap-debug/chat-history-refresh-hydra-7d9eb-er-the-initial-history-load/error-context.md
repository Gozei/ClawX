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

Expected: > 36
Received:   0
```

# Test source

```ts
  13  |   return [
  14  |     {
  15  |       id: 'user-1',
  16  |       role: 'user',
  17  |       content: USER_TEXT,
  18  |       timestamp: baseTimestamp,
  19  |     },
  20  |     ...(includeAssistant
  21  |       ? [{
  22  |           id: 'assistant-1',
  23  |           role: 'assistant',
  24  |           content: FINAL_TEXT,
  25  |           timestamp: baseTimestamp + 1,
  26  |         }]
  27  |       : []),
  28  |   ];
  29  | }
  30  | 
  31  | async function writeSession(homeDir: string, includeAssistant: boolean): Promise<void> {
  32  |   const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  33  |   await mkdir(sessionsDir, { recursive: true });
  34  |   await writeFile(
  35  |     join(sessionsDir, 'sessions.json'),
  36  |     JSON.stringify({
  37  |       sessions: [
  38  |         {
  39  |           key: SESSION_KEY,
  40  |           id: 'history-refresh-hydration-test',
  41  |           file: SESSION_FILE,
  42  |           label: SESSION_LABEL,
  43  |           updatedAt: Date.now(),
  44  |         },
  45  |       ],
  46  |     }, null, 2),
  47  |     'utf8',
  48  |   );
  49  |   await writeFile(
  50  |     join(sessionsDir, SESSION_FILE),
  51  |     `${buildSeededMessages(includeAssistant).map((message) => JSON.stringify(message)).join('\n')}\n`,
  52  |     'utf8',
  53  |   );
  54  | }
  55  | 
  56  | test.describe('Chat history refresh hydration', () => {
  57  |   test('hydrates a missing final assistant reply after the initial history load', async ({ homeDir, launchElectronApp }) => {
  58  |     await writeSession(homeDir, false);
  59  | 
  60  |     const app = await launchElectronApp({ skipSetup: true });
  61  | 
  62  |     try {
  63  |       const page = await getStableWindow(app);
  64  |       await expect(page.getByTestId('main-layout')).toBeVisible();
  65  | 
  66  |       const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
  67  |       if (await sessionRow.count() === 0) {
  68  |         const startResult = await page.evaluate(async () => (
  69  |           await window.electron.ipcRenderer.invoke('gateway:start')
  70  |         ) as { success?: boolean; error?: string });
  71  |         expect(startResult?.success, startResult?.error || 'gateway:start failed during E2E setup').toBe(true);
  72  |       }
  73  |       await expect(sessionRow).toBeVisible({ timeout: 60_000 });
  74  |       await sessionRow.click();
  75  | 
  76  |       const userMessages = page.getByTestId('chat-message-content-user').filter({ hasText: USER_TEXT });
  77  |       await expect(page.getByText(USER_TEXT, { exact: true })).toBeVisible({ timeout: 60_000 });
  78  |       await expect(userMessages).toHaveCount(1);
  79  |       await expect(page.getByText(FINAL_TEXT, { exact: true })).toHaveCount(0);
  80  | 
  81  |       await writeSession(homeDir, true);
  82  |       await page.getByTestId('chat-refresh-button').click();
  83  | 
  84  |       await expect(page.getByText(FINAL_TEXT, { exact: true })).toBeVisible({ timeout: 60_000 });
  85  |       await expect(userMessages).toHaveCount(1);
  86  |       await expect(page.getByTestId('chat-active-turn-bottom-spacer')).toHaveCount(0);
  87  | 
  88  |       const [finalMessageBox, composerBox] = await Promise.all([
  89  |         page.getByTestId('chat-assistant-message-shell').last().boundingBox(),
  90  |         page.getByTestId('chat-composer').boundingBox(),
  91  |       ]);
  92  |       const layoutDebug = await page.evaluate(() => {
  93  |         const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
  94  |         const contentColumn = document.querySelector('[data-testid="chat-content-column"]') as HTMLElement | null;
  95  |         const assistantShells = Array.from(document.querySelectorAll('[data-testid="chat-assistant-message-shell"]')) as HTMLElement[];
  96  |         const assistantShell = assistantShells.at(-1) ?? null;
  97  |         const composer = document.querySelector('[data-testid="chat-composer"]') as HTMLElement | null;
  98  |         const lastItem = contentColumn?.lastElementChild as HTMLElement | null;
  99  |         return {
  100 |           scrollPaddingBottom: scrollContainer ? getComputedStyle(scrollContainer).paddingBottom : null,
  101 |           contentPaddingBottom: contentColumn ? getComputedStyle(contentColumn).paddingBottom : null,
  102 |           lastItemMarginBottom: lastItem ? getComputedStyle(lastItem).marginBottom : null,
  103 |           scrollRect: scrollContainer?.getBoundingClientRect().toJSON?.() ?? null,
  104 |           contentRect: contentColumn?.getBoundingClientRect().toJSON?.() ?? null,
  105 |           assistantRect: assistantShell?.getBoundingClientRect().toJSON?.() ?? null,
  106 |           composerRect: composer?.getBoundingClientRect().toJSON?.() ?? null,
  107 |         };
  108 |       });
  109 |       console.log('layoutDebug', JSON.stringify(layoutDebug));
  110 | 
  111 |       if (finalMessageBox && composerBox) {
  112 |         const gap = composerBox.y - (finalMessageBox.y + finalMessageBox.height);
> 113 |         expect(gap).toBeGreaterThan(36);
      |                     ^ Error: expect(received).toBeGreaterThan(expected)
  114 |         expect(gap).toBeLessThan(120);
  115 |       }
  116 |     } finally {
  117 |       await closeElectronApp(app);
  118 |     }
  119 |   });
  120 | });
  121 | 
```