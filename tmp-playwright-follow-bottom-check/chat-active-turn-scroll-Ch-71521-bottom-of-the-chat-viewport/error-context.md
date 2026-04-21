# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-active-turn-scroll.spec.ts >> Chat active turn scroll >> keeps a newly sent turn pinned near the bottom of the chat viewport
- Location: tests\e2e\chat-active-turn-scroll.spec.ts:298:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Test source

```ts
  241 |     });
  242 |     seededMessages.push({
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
  279 | async function measureScrollTop(page: Page): Promise<number> {
  280 |   return await page.evaluate(() => {
  281 |     const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
  282 |     return scrollContainer?.scrollTop ?? 0;
  283 |   });
  284 | }
  285 | 
  286 | async function measureDistanceFromBottom(page: Page): Promise<number | null> {
  287 |   return await page.evaluate(() => {
  288 |     const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
  289 |     if (!scrollContainer) {
  290 |       return null;
  291 |     }
  292 | 
  293 |     return scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop;
  294 |   });
  295 | }
  296 | 
  297 | test.describe('Chat active turn scroll', () => {
  298 |   test('keeps a newly sent turn pinned near the bottom of the chat viewport', async ({ homeDir, launchElectronApp }) => {
  299 |     test.setTimeout(240_000);
  300 | 
  301 |     await seedSession(homeDir);
  302 |     const mockServer = await startDelayedMockOpenAiServer();
  303 |     const app = await launchElectronApp({ skipSetup: true });
  304 | 
  305 |     try {
  306 |       const page = await getStableWindow(app);
  307 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  308 | 
  309 |       await seedDefaultProvider(page, mockServer.baseUrl);
  310 |       await page.reload();
  311 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  312 | 
  313 |       await configureIsolatedGatewayPort(page);
  314 |       await startGateway(page);
  315 |       await waitForGatewayStable(page);
  316 |       await openSeededSession(page);
  317 | 
  318 |       const scrollContainer = page.getByTestId('chat-scroll-container');
  319 |       const composer = page.getByTestId('chat-composer');
  320 |       const messageInput = composer.getByRole('textbox');
  321 |       const sendButton = composer.getByTestId('chat-send-button');
  322 |       const modelSwitch = composer.getByTestId('chat-model-switch');
  323 | 
  324 |       await expect(scrollContainer).toBeVisible();
  325 |       await expect(modelSwitch).toContainText(`${DEFAULT_PROVIDER_LABEL} / model-scroll`, { timeout: 20_000 });
  326 |       await expect.poll(async () => (
  327 |         await sendButton.evaluate((node) => (
  328 |           !!node.querySelector('svg.lucide-send-horizontal')
  329 |         ))
  330 |       ), { timeout: 20_000 }).toBe(true);
  331 |       await expect.poll(async () => (
  332 |         await scrollContainer.evaluate((node) => (node as HTMLElement).scrollTop)
  333 |       ), { timeout: 20_000 }).toBeGreaterThan(0);
  334 | 
  335 |       await messageInput.fill('Please keep this active turn aligned to the top.');
  336 |       await expect(sendButton).toBeEnabled({ timeout: 10_000 });
  337 |       await sendButton.click();
  338 | 
  339 |       await expect(page.getByTestId('chat-active-turn-anchor')).toBeVisible({ timeout: 20_000 });
  340 | 
> 341 |       await expect.poll(async () => {
      |       ^ Error: expect(received).toBe(expected) // Object.is equality
  342 |         const distanceFromBottom = await measureDistanceFromBottom(page);
  343 |         return distanceFromBottom != null ? Math.abs(distanceFromBottom) <= 2 : false;
  344 |       }, { timeout: 10_000 }).toBe(true);
  345 | 
  346 |       await expect.poll(async () => (
  347 |         await page.evaluate(() => document.body.innerText.includes('reply:model-scroll'))
  348 |       ), { timeout: 20_000 }).toBe(true);
  349 | 
  350 |       await expect.poll(async () => {
  351 |         const distanceFromBottom = await measureDistanceFromBottom(page);
  352 |         return distanceFromBottom != null ? Math.abs(distanceFromBottom) <= 18 : false;
  353 |       }, { timeout: 10_000 }).toBe(true);
  354 | 
  355 |       const beforeManualScrollTop = await measureScrollTop(page);
  356 |       await scrollContainer.hover();
  357 |       await page.mouse.wheel(0, -160);
  358 | 
  359 |       await expect.poll(async () => (
  360 |         await measureScrollTop(page)
  361 |       ), { timeout: 5_000 }).toBeLessThan(beforeManualScrollTop);
  362 |       const afterManualScrollTop = await measureScrollTop(page);
  363 | 
  364 |       await page.waitForTimeout(750);
  365 |       await expect.poll(async () => (
  366 |         await measureScrollTop(page)
  367 |       ), { timeout: 5_000 }).toBeLessThanOrEqual(afterManualScrollTop + 2);
  368 | 
  369 |       await page.getByTestId('sidebar-new-chat').click();
  370 |       await expect(page.getByTestId('chat-composer')).toBeVisible({ timeout: 10_000 });
  371 | 
  372 |       await openSeededSession(page);
  373 |       await expect.poll(async () => {
  374 |         const distanceFromBottom = await measureDistanceFromBottom(page);
  375 |         return distanceFromBottom != null ? Math.abs(distanceFromBottom) <= 2 : false;
  376 |       }, { timeout: 10_000 }).toBe(true);
  377 |     } finally {
  378 |       try {
  379 |         const page = await getStableWindow(app);
  380 |         await page.evaluate(async () => {
  381 |           try {
  382 |             await window.electron.ipcRenderer.invoke('gateway:stop');
  383 |           } catch {
  384 |             // ignore gateway shutdown failures during cleanup
  385 |           }
  386 |         });
  387 |       } catch {
  388 |         // ignore cleanup failures before closing Electron
  389 |       }
  390 |       await closeElectronApp(app);
  391 |       await mockServer.close();
  392 |     }
  393 |   });
  394 | });
  395 | 
```