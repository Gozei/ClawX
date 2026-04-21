# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-browser-flight-runtime.spec.ts >> Chat browser flight runtime >> finishes the running state after a browser-style flight table reply without requiring a refresh
- Location: tests\e2e\chat-browser-flight-runtime.spec.ts:25:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('正在访问携程并查询深圳到南京的机票')
Expected: visible
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for getByText('正在访问携程并查询深圳到南京的机票')

```

# Test source

```ts
  131 |                   data: {
  132 |                     itemId: 'tool:browser-flight-1',
  133 |                     phase: 'start',
  134 |                     kind: 'tool',
  135 |                     name: 'browser',
  136 |                     status: 'running',
  137 |                     title: '打开浏览器',
  138 |                     progressText: '正在访问携程并查询深圳到南京的机票',
  139 |                     toolCallId: 'browser-flight-1',
  140 |                   },
  141 |                 },
  142 |               });
  143 |             }, 300);
  144 | 
  145 |             setTimeout(() => {
  146 |               emitNotification({
  147 |                 method: 'agent',
  148 |                 params: {
  149 |                   runId,
  150 |                   sessionKey: activeSessionKey,
  151 |                   stream: 'assistant',
  152 |                   data: {
  153 |                     text: '我先打开浏览器访问携程，再整理明天深圳到南京的机票信息。',
  154 |                     delta: '我先打开浏览器访问携程，再整理明天深圳到南京的机票信息。',
  155 |                   },
  156 |                 },
  157 |               });
  158 |             }, 700);
  159 | 
  160 |             setTimeout(() => {
  161 |               const completedAt = Date.now();
  162 |               historyMessages = [
  163 |                 {
  164 |                   id: 'user-browser-flight-1',
  165 |                   role: 'user',
  166 |                   content: visiblePrompt,
  167 |                   timestamp: Math.floor(now / 1000),
  168 |                 },
  169 |                 {
  170 |                   id: 'assistant-browser-flight-1',
  171 |                   role: 'assistant',
  172 |                   content: [
  173 |                     '已帮你整理明天深圳到南京的机票信息：',
  174 |                     '',
  175 |                     finalHeader,
  176 |                     '| --- | --- | --- | --- | --- |',
  177 |                     finalRow,
  178 |                     '| 湖南航空 | A67297 | 07:15 | 09:30 | ￥650 起 |',
  179 |                     '| 深圳航空 | ZH9847 | 14:35 | 17:00 | ￥750 起 |',
  180 |                     '',
  181 |                     '如果需要，我可以继续帮你按最早起飞、最低价格或白天时段再筛一遍。',
  182 |                   ].join('\n'),
  183 |                   timestamp: Math.floor(completedAt / 1000),
  184 |                 },
  185 |               ];
  186 |               sessions = [{
  187 |                 key: activeSessionKey,
  188 |                 id: sessionId,
  189 |                 label: visiblePrompt,
  190 |                 updatedAt: completedAt,
  191 |               }];
  192 |             }, 2_800);
  193 | 
  194 |             return {
  195 |               success: true,
  196 |               result: {
  197 |                 runId,
  198 |               },
  199 |             };
  200 |           }
  201 | 
  202 |           return {};
  203 |         });
  204 |       }, {
  205 |         prompt: PROMPT,
  206 |         sessionKey: SESSION_KEY,
  207 |         sessionId: SESSION_ID,
  208 |         runId: RUN_ID,
  209 |         finalHeader: '| 航空公司 | 航班 | 起飞 | 到达 | 价格 |',
  210 |         finalRow: FINAL_ROW_TEXT,
  211 |       });
  212 | 
  213 |       const page = await getStableWindow(app);
  214 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  215 | 
  216 |       const composer = page.getByTestId('chat-composer');
  217 |       const messageInput = composer.getByRole('textbox');
  218 |       const sendButton = composer.getByTestId('chat-send-button');
  219 | 
  220 |       await messageInput.fill(PROMPT);
  221 |       await sendButton.click();
  222 | 
  223 |       const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
  224 |       await expect(sessionRow).toBeVisible({ timeout: 30_000 });
  225 |       await expect(page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`)).toBeVisible({ timeout: 30_000 });
  226 | 
  227 |       await expect.poll(async () => {
  228 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
  229 |       }, { timeout: 30_000 }).toBe(true);
  230 | 
> 231 |       await expect(page.getByText('正在访问携程并查询深圳到南京的机票')).toBeVisible({ timeout: 30_000 });
      |                                                         ^ Error: expect(locator).toBeVisible() failed
  232 | 
  233 |       await expect(page.getByText('已帮你整理明天深圳到南京的机票信息：', { exact: true })).toBeVisible({ timeout: 60_000 });
  234 |       await expect(page.getByText('东方航空', { exact: true })).toBeVisible({ timeout: 60_000 });
  235 |       await expect(page.getByText('MU2878', { exact: true })).toBeVisible({ timeout: 60_000 });
  236 |       await expect(page.getByText('￥620 起', { exact: true })).toBeVisible({ timeout: 60_000 });
  237 | 
  238 |       await expect(page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`)).toHaveCount(0, { timeout: 20_000 });
  239 |       await expect.poll(async () => {
  240 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
  241 |       }, { timeout: 20_000 }).toBe(true);
  242 | 
  243 |       const sendButtonTitle = await sendButton.getAttribute('title');
  244 |       expect(['Send', '发送']).toContain(sendButtonTitle);
  245 | 
  246 |       await page.waitForTimeout(1_500);
  247 |       await expect(page.getByTestId(`sidebar-session-running-indicator-${SESSION_KEY}`)).toHaveCount(0);
  248 |       await expect.poll(async () => {
  249 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
  250 |       }).toBe(true);
  251 |     } finally {
  252 |       await closeElectronApp(app);
  253 |     }
  254 |   });
  255 | });
  256 | 
```