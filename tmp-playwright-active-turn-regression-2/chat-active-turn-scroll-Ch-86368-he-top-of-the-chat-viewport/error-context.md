# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-active-turn-scroll.spec.ts >> Chat active turn scroll >> keeps a newly sent turn pinned to the top of the chat viewport
- Location: tests\e2e\chat-active-turn-scroll.spec.ts:317:7

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator:  getByTestId('chat-composer').getByTestId('chat-send-button')
Expected: enabled
Received: disabled
Timeout:  20000ms

Call log:
  - Expect "toBeEnabled" with timeout 20000ms
  - waiting for getByTestId('chat-composer').getByTestId('chat-send-button')
    23 × locator resolved to <button disabled title="发送" data-testid="chat-send-button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:text-accent-foreground shrink-0 h-10 w-10 rounded-[12px] transition-colors bg-transparent text-muted-foreground/40 hover:bg-transparent">…</button>
       - unexpected value "disabled"

```

# Test source

```ts
  243 |       id: `history-assistant-${index + 1}`,
  244 |       role: 'assistant',
  245 |       content: `History answer ${index + 1}`,
  246 |       timestamp: baseTimestamp + (index * 2) + 1,
  247 |     });
  248 |   }
  249 | 
  250 |   await mkdir(sessionsDir, { recursive: true });
  251 |   await writeFile(
  252 |     join(sessionsDir, 'sessions.json'),
  253 |     JSON.stringify({
  254 |       sessions: [
  255 |         {
  256 |           key: SESSION_KEY,
  257 |           id: 'active-turn-scroll-test',
  258 |           file: SESSION_FILE,
  259 |           label: SESSION_LABEL,
  260 |           updatedAt: Date.now(),
  261 |         },
  262 |       ],
  263 |     }, null, 2),
  264 |     'utf8',
  265 |   );
  266 |   await writeFile(
  267 |     join(sessionsDir, SESSION_FILE),
  268 |     `${seededMessages.map((message) => JSON.stringify(message)).join('\n')}\n`,
  269 |     'utf8',
  270 |   );
  271 | }
  272 | 
  273 | async function openSeededSession(page: Page): Promise<void> {
  274 |   const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
  275 |   await expect(sessionRow).toBeVisible({ timeout: 60_000 });
  276 |   await sessionRow.click();
  277 | }
  278 | 
  279 | async function measureActiveTurnAlignment(page: Page): Promise<{ delta: number; scrollTop: number } | null> {
  280 |   return await page.evaluate(() => {
  281 |     const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
  282 |     const anchor = document.querySelector('[data-testid="chat-active-turn-anchor"]') as HTMLElement | null;
  283 | 
  284 |     if (!scrollContainer || !anchor) {
  285 |       return null;
  286 |     }
  287 | 
  288 |     const scrollRect = scrollContainer.getBoundingClientRect();
  289 |     const anchorRect = anchor.getBoundingClientRect();
  290 | 
  291 |     return {
  292 |       delta: Number((anchorRect.top - scrollRect.top).toFixed(2)),
  293 |       scrollTop: scrollContainer.scrollTop,
  294 |     };
  295 |   });
  296 | }
  297 | 
  298 | async function measureScrollTop(page: Page): Promise<number> {
  299 |   return await page.evaluate(() => {
  300 |     const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
  301 |     return scrollContainer?.scrollTop ?? 0;
  302 |   });
  303 | }
  304 | 
  305 | async function measureDistanceFromBottom(page: Page): Promise<number | null> {
  306 |   return await page.evaluate(() => {
  307 |     const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
  308 |     if (!scrollContainer) {
  309 |       return null;
  310 |     }
  311 | 
  312 |     return scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop;
  313 |   });
  314 | }
  315 | 
  316 | test.describe('Chat active turn scroll', () => {
  317 |   test('keeps a newly sent turn pinned to the top of the chat viewport', async ({ homeDir, launchElectronApp }) => {
  318 |     test.setTimeout(240_000);
  319 | 
  320 |     await seedSession(homeDir);
  321 |     const mockServer = await startDelayedMockOpenAiServer();
  322 |     const app = await launchElectronApp({ skipSetup: true });
  323 | 
  324 |     try {
  325 |       const page = await getStableWindow(app);
  326 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  327 | 
  328 |       await seedDefaultProvider(page, mockServer.baseUrl);
  329 |       await page.reload();
  330 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  331 | 
  332 |       await configureIsolatedGatewayPort(page);
  333 |       await startGateway(page);
  334 |       await waitForGatewayStable(page);
  335 |       await openSeededSession(page);
  336 | 
  337 |       const scrollContainer = page.getByTestId('chat-scroll-container');
  338 |       const composer = page.getByTestId('chat-composer');
  339 |       const messageInput = composer.getByRole('textbox');
  340 |       const sendButton = composer.getByTestId('chat-send-button');
  341 | 
  342 |       await expect(scrollContainer).toBeVisible();
> 343 |       await expect(sendButton).toBeEnabled({ timeout: 20_000 });
      |                                ^ Error: expect(locator).toBeEnabled() failed
  344 |       await expect.poll(async () => (
  345 |         await sendButton.evaluate((node) => (
  346 |           !!node.querySelector('svg.lucide-send-horizontal')
  347 |         ))
  348 |       ), { timeout: 20_000 }).toBe(true);
  349 |       await expect.poll(async () => (
  350 |         await scrollContainer.evaluate((node) => (node as HTMLElement).scrollTop)
  351 |       ), { timeout: 20_000 }).toBeGreaterThan(0);
  352 | 
  353 |       await messageInput.fill('Please keep this active turn aligned to the top.');
  354 |       await sendButton.click();
  355 | 
  356 |       await expect(page.getByTestId('chat-active-turn-anchor')).toBeVisible({ timeout: 20_000 });
  357 | 
  358 |       let alignment: { delta: number; scrollTop: number } | null = null;
  359 |       await expect.poll(async () => {
  360 |         alignment = await measureActiveTurnAlignment(page);
  361 |         return alignment ? Math.abs(alignment.delta) <= 2 : false;
  362 |       }, { timeout: 10_000 }).toBe(true);
  363 | 
  364 |       expect(alignment?.scrollTop ?? 0).toBeGreaterThan(0);
  365 | 
  366 |       const beforeManualScrollTop = await measureScrollTop(page);
  367 |       await scrollContainer.hover();
  368 |       await page.mouse.wheel(0, -160);
  369 | 
  370 |       await expect.poll(async () => (
  371 |         await measureScrollTop(page)
  372 |       ), { timeout: 5_000 }).toBeLessThan(beforeManualScrollTop);
  373 |       const afterManualScrollTop = await measureScrollTop(page);
  374 | 
  375 |       await page.waitForTimeout(750);
  376 |       await expect.poll(async () => (
  377 |         await measureScrollTop(page)
  378 |       ), { timeout: 5_000 }).toBeLessThanOrEqual(afterManualScrollTop + 2);
  379 | 
  380 |       await page.getByTestId('sidebar-new-chat').click();
  381 |       await expect(page.getByTestId('chat-composer')).toBeVisible({ timeout: 10_000 });
  382 | 
  383 |       await openSeededSession(page);
  384 |       await expect.poll(async () => {
  385 |         const distanceFromBottom = await measureDistanceFromBottom(page);
  386 |         return distanceFromBottom != null ? Math.abs(distanceFromBottom) <= 2 : false;
  387 |       }, { timeout: 10_000 }).toBe(true);
  388 |     } finally {
  389 |       try {
  390 |         const page = await getStableWindow(app);
  391 |         await page.evaluate(async () => {
  392 |           try {
  393 |             await window.electron.ipcRenderer.invoke('gateway:stop');
  394 |           } catch {
  395 |             // ignore gateway shutdown failures during cleanup
  396 |           }
  397 |         });
  398 |       } catch {
  399 |         // ignore cleanup failures before closing Electron
  400 |       }
  401 |       await closeElectronApp(app);
  402 |       await mockServer.close();
  403 |     }
  404 |   });
  405 | });
  406 | 
```