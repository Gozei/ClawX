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

Locator: getByText('| 航空公司 | 航班 | 起飞 | 到达 | 价格 |', { exact: true })
Expected: visible
Timeout: 60000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 60000ms
  - waiting for getByText('| 航空公司 | 航班 | 起飞 | 到达 | 价格 |', { exact: true })

```

# Test source

```ts
  145 |               });
  146 |             }, 300);
  147 | 
  148 |             setTimeout(() => {
  149 |               emitNotification({
  150 |                 method: 'agent',
  151 |                 params: {
  152 |                   runId,
  153 |                   sessionKey: activeSessionKey,
  154 |                   stream: 'assistant',
  155 |                   data: {
  156 |                     text: '我先打开浏览器访问携程，再整理明天深圳到南京的机票信息。',
  157 |                     delta: '我先打开浏览器访问携程，再整理明天深圳到南京的机票信息。',
  158 |                   },
  159 |                 },
  160 |               });
  161 |             }, 700);
  162 | 
  163 |             setTimeout(() => {
  164 |               const completedAt = Date.now();
  165 |               historyMessages = [
  166 |                 {
  167 |                   id: 'user-browser-flight-1',
  168 |                   role: 'user',
  169 |                   content: visiblePrompt,
  170 |                   timestamp: Math.floor(now / 1000),
  171 |                 },
  172 |                 {
  173 |                   id: 'assistant-browser-flight-1',
  174 |                   role: 'assistant',
  175 |                   content: [
  176 |                     '已帮你整理明天深圳到南京的机票信息：',
  177 |                     '',
  178 |                     finalHeader,
  179 |                     '| --- | --- | --- | --- | --- |',
  180 |                     finalRow,
  181 |                     '| 湖南航空 | A67297 | 07:15 | 09:30 | ￥650 起 |',
  182 |                     '| 深圳航空 | ZH9847 | 14:35 | 17:00 | ￥750 起 |',
  183 |                     '',
  184 |                     '如果需要，我可以继续帮你按最早起飞、最低价格或白天时段再筛一遍。',
  185 |                   ].join('\n'),
  186 |                   timestamp: Math.floor(completedAt / 1000),
  187 |                 },
  188 |               ];
  189 |               sessions = [{
  190 |                 key: activeSessionKey,
  191 |                 id: sessionId,
  192 |                 label: visiblePrompt,
  193 |                 updatedAt: completedAt,
  194 |               }];
  195 | 
  196 |               emitNotification({
  197 |                 method: 'agent',
  198 |                 params: {
  199 |                   phase: 'completed',
  200 |                   runId,
  201 |                   sessionKey: activeSessionKey,
  202 |                 },
  203 |               });
  204 |             }, 2_800);
  205 | 
  206 |             return {
  207 |               success: true,
  208 |               result: {
  209 |                 runId,
  210 |               },
  211 |             };
  212 |           }
  213 | 
  214 |           return {};
  215 |         });
  216 |       }, {
  217 |         prompt: PROMPT,
  218 |         sessionKey: SESSION_KEY,
  219 |         sessionId: SESSION_ID,
  220 |         runId: RUN_ID,
  221 |         finalHeader: FINAL_TABLE_HEADER,
  222 |         finalRow: FINAL_ROW_TEXT,
  223 |       });
  224 | 
  225 |       const page = await getStableWindow(app);
  226 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  227 | 
  228 |       const composer = page.getByTestId('chat-composer');
  229 |       const messageInput = composer.getByRole('textbox');
  230 |       const sendButton = composer.getByTestId('chat-send-button');
  231 | 
  232 |       await messageInput.fill(PROMPT);
  233 |       await sendButton.click();
  234 | 
  235 |       const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
  236 |       await expect(sessionRow).toBeVisible({ timeout: 30_000 });
  237 |       await expect(page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`)).toBeVisible({ timeout: 30_000 });
  238 | 
  239 |       await expect.poll(async () => {
  240 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
  241 |       }, { timeout: 30_000 }).toBe(true);
  242 | 
  243 |       await expect(page.getByText('正在访问携程并查询深圳到南京的机票')).toBeVisible({ timeout: 30_000 });
  244 | 
> 245 |       await expect(page.getByText(FINAL_TABLE_HEADER, { exact: true })).toBeVisible({ timeout: 60_000 });
      |                                                                         ^ Error: expect(locator).toBeVisible() failed
  246 |       await expect(page.getByText(FINAL_ROW_TEXT, { exact: true })).toBeVisible({ timeout: 60_000 });
  247 | 
  248 |       await expect(page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`)).toHaveCount(0, { timeout: 20_000 });
  249 |       await expect.poll(async () => {
  250 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
  251 |       }, { timeout: 20_000 }).toBe(true);
  252 | 
  253 |       const sendButtonTitle = await sendButton.getAttribute('title');
  254 |       expect(['Send', '发送']).toContain(sendButtonTitle);
  255 | 
  256 |       await page.waitForTimeout(1_500);
  257 |       await expect(page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`)).toHaveCount(0);
  258 |       await expect.poll(async () => {
  259 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
  260 |       }).toBe(true);
  261 |     } finally {
  262 |       await closeElectronApp(app);
  263 |     }
  264 |   });
  265 | });
  266 | 
```