# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-browser-flight-runtime.spec.ts >> Chat browser flight runtime >> finishes the running state after a browser-style flight table reply without requiring a refresh
- Location: tests\e2e\chat-browser-flight-runtime.spec.ts:37:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('已帮你整理明天深圳到南京的机票信息：', { exact: true })
Expected: visible
Timeout: 60000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 60000ms
  - waiting for getByText('已帮你整理明天深圳到南京的机票信息：', { exact: true })

```

# Test source

```ts
  173 |                 method: 'agent',
  174 |                 params: {
  175 |                   runId,
  176 |                   sessionKey: activeSessionKey,
  177 |                   stream: 'assistant',
  178 |                   data: {
  179 |                     text: '我先打开浏览器访问携程，再整理明天深圳到南京的机票信息。',
  180 |                     delta: '我先打开浏览器访问携程，再整理明天深圳到南京的机票信息。',
  181 |                   },
  182 |                 },
  183 |               });
  184 |             }, 700);
  185 | 
  186 |             setTimeout(() => {
  187 |               const completedAt = Date.now();
  188 |               historyMessages = [
  189 |                 {
  190 |                   id: 'user-browser-flight-1',
  191 |                   role: 'user',
  192 |                   content: visiblePrompt,
  193 |                   timestamp: Math.floor(now / 1000),
  194 |                 },
  195 |                 {
  196 |                   id: 'assistant-browser-flight-1',
  197 |                   role: 'assistant',
  198 |                   content: [
  199 |                     '已帮你整理明天深圳到南京的机票信息：',
  200 |                     '',
  201 |                     finalHeader,
  202 |                     '| --- | --- | --- | --- | --- |',
  203 |                     finalRow,
  204 |                     '| 湖南航空 | A67297 | 07:15 | 09:30 | ￥650 起 |',
  205 |                     '| 深圳航空 | ZH9847 | 14:35 | 17:00 | ￥750 起 |',
  206 |                     '',
  207 |                     '如果需要，我可以继续帮你按最早起飞、最低价格或白天时段再筛一遍。',
  208 |                   ].join('\n'),
  209 |                   timestamp: Math.floor(completedAt / 1000),
  210 |                 },
  211 |               ];
  212 |               sessions = [{
  213 |                 key: activeSessionKey,
  214 |                 id: sessionId,
  215 |                 label: visiblePrompt,
  216 |                 updatedAt: completedAt,
  217 |               }];
  218 |             }, 2_800);
  219 | 
  220 |             return {
  221 |               success: true,
  222 |               result: {
  223 |                 runId,
  224 |               },
  225 |             };
  226 |           }
  227 | 
  228 |           return {};
  229 |         });
  230 |       }, {
  231 |         prompt: PROMPT,
  232 |         sessionKey: SESSION_KEY,
  233 |         sessionId: SESSION_ID,
  234 |         runId: RUN_ID,
  235 |         finalHeader: FINAL_TABLE_HEADER,
  236 |         finalRow: FINAL_ROW_TEXT,
  237 |       });
  238 | 
  239 |       const page = await getStableWindow(app);
  240 |       page.on('console', (message) => {
  241 |         console.log(`page-console:${message.type()}:`, message.text());
  242 |       });
  243 |       page.on('pageerror', (error) => {
  244 |         console.log('page-error:', String(error));
  245 |       });
  246 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  247 | 
  248 |       const composer = page.getByTestId('chat-composer');
  249 |       const messageInput = composer.getByRole('textbox');
  250 |       const sendButton = composer.getByTestId('chat-send-button');
  251 | 
  252 |       await messageInput.fill(PROMPT);
  253 |       await sendButton.click();
  254 | 
  255 |       const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
  256 |       await expect(sessionRow).toBeVisible({ timeout: 30_000 });
  257 |       await expect(page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`)).toBeVisible({ timeout: 30_000 });
  258 | 
  259 |       await expect.poll(async () => {
  260 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
  261 |       }, { timeout: 30_000 }).toBe(true);
  262 | 
  263 |       await expect(page.getByText('正在访问携程并查询深圳到南京的机票')).toBeVisible({ timeout: 30_000 });
  264 | 
  265 |       await page.waitForTimeout(6_000);
  266 |       console.log('body-text-after-runtime:', await page.evaluate(() => document.body.innerText));
  267 |       console.log('send-button-title-after-runtime:', await sendButton.getAttribute('title'));
  268 |       console.log('running-indicator-count-after-runtime:', await page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`).count());
  269 |       console.log('runtime-debug-after-runtime:', await app.evaluate(() => (globalThis as typeof globalThis & { __browserFlightRuntimeDebug?: unknown }).__browserFlightRuntimeDebug));
  270 |       console.log('assistant-message-texts-after-runtime:', await page.getByTestId('chat-message-content-assistant').allTextContents());
  271 |       console.log('chat-history-apply-debug-after-runtime:', await page.evaluate(() => (globalThis as typeof globalThis & { __chatHistoryApplyDebug?: unknown }).__chatHistoryApplyDebug));
  272 | 
> 273 |       await expect(page.getByText('已帮你整理明天深圳到南京的机票信息：', { exact: true })).toBeVisible({ timeout: 60_000 });
      |                                                                           ^ Error: expect(locator).toBeVisible() failed
  274 |       await expect(page.getByText('东方航空', { exact: true })).toBeVisible({ timeout: 60_000 });
  275 |       await expect(page.getByText('MU2878', { exact: true })).toBeVisible({ timeout: 60_000 });
  276 |       await expect(page.getByText('￥620 起', { exact: true })).toBeVisible({ timeout: 60_000 });
  277 | 
  278 |       await expect(page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`)).toHaveCount(0, { timeout: 20_000 });
  279 |       await expect.poll(async () => {
  280 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
  281 |       }, { timeout: 20_000 }).toBe(true);
  282 | 
  283 |       const sendButtonTitle = await sendButton.getAttribute('title');
  284 |       expect(['Send', '发送']).toContain(sendButtonTitle);
  285 | 
  286 |       await page.waitForTimeout(1_500);
  287 |       await expect(page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`)).toHaveCount(0);
  288 |       await expect.poll(async () => {
  289 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
  290 |       }).toBe(true);
  291 |     } finally {
  292 |       await closeElectronApp(app);
  293 |     }
  294 |   });
  295 | });
  296 | 
```