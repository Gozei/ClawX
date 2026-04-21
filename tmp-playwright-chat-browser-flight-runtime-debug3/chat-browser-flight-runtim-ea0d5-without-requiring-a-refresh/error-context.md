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
  166 |                   },
  167 |                 },
  168 |               });
  169 |             }, 300);
  170 | 
  171 |             setTimeout(() => {
  172 |               emitNotification({
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
  240 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  241 | 
  242 |       const composer = page.getByTestId('chat-composer');
  243 |       const messageInput = composer.getByRole('textbox');
  244 |       const sendButton = composer.getByTestId('chat-send-button');
  245 | 
  246 |       await messageInput.fill(PROMPT);
  247 |       await sendButton.click();
  248 | 
  249 |       const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
  250 |       await expect(sessionRow).toBeVisible({ timeout: 30_000 });
  251 |       await expect(page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`)).toBeVisible({ timeout: 30_000 });
  252 | 
  253 |       await expect.poll(async () => {
  254 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
  255 |       }, { timeout: 30_000 }).toBe(true);
  256 | 
  257 |       await expect(page.getByText('正在访问携程并查询深圳到南京的机票')).toBeVisible({ timeout: 30_000 });
  258 | 
  259 |       await page.waitForTimeout(6_000);
  260 |       console.log('body-text-after-runtime:', await page.evaluate(() => document.body.innerText));
  261 |       console.log('send-button-title-after-runtime:', await sendButton.getAttribute('title'));
  262 |       console.log('running-indicator-count-after-runtime:', await page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`).count());
  263 |       console.log('runtime-debug-after-runtime:', await app.evaluate(() => (globalThis as typeof globalThis & { __browserFlightRuntimeDebug?: unknown }).__browserFlightRuntimeDebug));
  264 |       console.log('assistant-message-texts-after-runtime:', await page.getByTestId('chat-message-content-assistant').allTextContents());
  265 | 
> 266 |       await expect(page.getByText('已帮你整理明天深圳到南京的机票信息：', { exact: true })).toBeVisible({ timeout: 60_000 });
      |                                                                           ^ Error: expect(locator).toBeVisible() failed
  267 |       await expect(page.getByText('东方航空', { exact: true })).toBeVisible({ timeout: 60_000 });
  268 |       await expect(page.getByText('MU2878', { exact: true })).toBeVisible({ timeout: 60_000 });
  269 |       await expect(page.getByText('￥620 起', { exact: true })).toBeVisible({ timeout: 60_000 });
  270 | 
  271 |       await expect(page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`)).toHaveCount(0, { timeout: 20_000 });
  272 |       await expect.poll(async () => {
  273 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
  274 |       }, { timeout: 20_000 }).toBe(true);
  275 | 
  276 |       const sendButtonTitle = await sendButton.getAttribute('title');
  277 |       expect(['Send', '发送']).toContain(sendButtonTitle);
  278 | 
  279 |       await page.waitForTimeout(1_500);
  280 |       await expect(page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`)).toHaveCount(0);
  281 |       await expect.poll(async () => {
  282 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
  283 |       }).toBe(true);
  284 |     } finally {
  285 |       await closeElectronApp(app);
  286 |     }
  287 |   });
  288 | });
  289 | 
```