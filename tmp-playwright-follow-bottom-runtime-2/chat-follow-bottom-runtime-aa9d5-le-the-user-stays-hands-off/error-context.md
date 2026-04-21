# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-follow-bottom-runtime.spec.ts >> Chat follow-bottom runtime >> keeps moving upward as streamed output grows while the user stays hands-off
- Location: tests\e2e\chat-follow-bottom-runtime.spec.ts:42:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('东方航空')
Expected: visible
Error: strict mode violation: getByText('东方航空') resolved to 2 elements:
    1) <td>东方航空</td> aka getByRole('cell', { name: '东方航空' })
    2) <p>补充说明：如果你更关注白天出发，我可以继续筛掉红眼航班。↵补充说明一：东方航空价格最低，但落地时间…</p> aka getByText('补充说明：如果你更关注白天出发，我可以继续筛掉红眼航班。 补充说明一：东方航空价格最低，但落地时间是次日凌晨。 补充说明二：湖南航空最早出发，适合一早到南京开会')

Call log:
  - Expect "toBeVisible" with timeout 20000ms
  - waiting for getByText('东方航空')

```

# Test source

```ts
  183 |               updatedAt: Date.now(),
  184 |             }];
  185 | 
  186 |             setTimeout(() => {
  187 |               emitNotification({
  188 |                 method: 'agent',
  189 |                 params: {
  190 |                   phase: 'started',
  191 |                   runId,
  192 |                   sessionKey: params?.sessionKey || sessionKey,
  193 |                 },
  194 |               });
  195 |             }, 0);
  196 | 
  197 |             chunks.forEach((fullText, index) => {
  198 |               setTimeout(() => {
  199 |                 emitNotification({
  200 |                   method: 'agent',
  201 |                   params: {
  202 |                     runId,
  203 |                     sessionKey: params?.sessionKey || sessionKey,
  204 |                     stream: 'assistant',
  205 |                     data: {
  206 |                       text: fullText,
  207 |                       delta: index === 0 ? fullText : chunks[index].slice(chunks[index - 1].length),
  208 |                     },
  209 |                   },
  210 |                 });
  211 |               }, 400 + (index * 900));
  212 |             });
  213 | 
  214 |             setTimeout(() => {
  215 |               const completedAt = Math.floor(Date.now() / 1000);
  216 |               historyMessages = [
  217 |                 ...seedMessages,
  218 |                 {
  219 |                   id: 'user-follow-bottom-1',
  220 |                   role: 'user',
  221 |                   content: prompt,
  222 |                   timestamp: now,
  223 |                 },
  224 |                 {
  225 |                   id: 'assistant-follow-bottom-1',
  226 |                   role: 'assistant',
  227 |                   content: chunks[chunks.length - 1],
  228 |                   timestamp: completedAt,
  229 |                 },
  230 |               ];
  231 |               emitNotification({
  232 |                 method: 'agent',
  233 |                 params: {
  234 |                   phase: 'completed',
  235 |                   state: 'final',
  236 |                   runId,
  237 |                   sessionKey: params?.sessionKey || sessionKey,
  238 |                   message: {
  239 |                     role: 'assistant',
  240 |                     content: chunks[chunks.length - 1],
  241 |                     timestamp: completedAt,
  242 |                   },
  243 |                 },
  244 |               });
  245 |             }, 3_400);
  246 | 
  247 |             return {
  248 |               success: true,
  249 |               result: { runId },
  250 |             };
  251 |           }
  252 | 
  253 |           return { success: true, result: {} };
  254 |         });
  255 |       }, {
  256 |         prompt: PROMPT,
  257 |         runId: RUN_ID,
  258 |         sessionKey: SESSION_KEY,
  259 |         sessionId: SESSION_ID,
  260 |       });
  261 | 
  262 |       const page = await getStableWindow(app);
  263 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  264 | 
  265 |       const composer = page.getByTestId('chat-composer');
  266 |       const messageInput = composer.getByRole('textbox');
  267 |       const sendButton = composer.getByTestId('chat-send-button');
  268 | 
  269 |       await expect(page.getByText('历史回答 14')).toBeVisible({ timeout: 30_000 });
  270 |       await messageInput.fill(PROMPT);
  271 |       await sendButton.click();
  272 | 
  273 |       await expect.poll(async () => {
  274 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
  275 |       }, { timeout: 20_000 }).toBe(true);
  276 | 
  277 |       await expect.poll(async () => {
  278 |         const metrics = await measureScrollMetrics(page);
  279 |         return metrics.distanceFromBottom != null ? (metrics.distanceFromBottom <= 24) : false;
  280 |       }, { timeout: 20_000 }).toBe(true);
  281 |       const initialMetrics = await measureScrollMetrics(page);
  282 | 
> 283 |       await expect(page.getByText('东方航空')).toBeVisible({ timeout: 20_000 });
      |                                            ^ Error: expect(locator).toBeVisible() failed
  284 |       await expect.poll(async () => {
  285 |         const metrics = await measureScrollMetrics(page);
  286 |         return metrics.scrollTop > initialMetrics.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  287 |       }, { timeout: 20_000 }).toBe(true);
  288 |       const metricsAfterFirstChunk = await measureScrollMetrics(page);
  289 | 
  290 |       await expect(page.getByText('湖南航空')).toBeVisible({ timeout: 20_000 });
  291 |       await expect.poll(async () => {
  292 |         const metrics = await measureScrollMetrics(page);
  293 |         return metrics.scrollTop > metricsAfterFirstChunk.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  294 |       }, { timeout: 20_000 }).toBe(true);
  295 |       const metricsAfterSecondChunk = await measureScrollMetrics(page);
  296 | 
  297 |       await expect(page.getByText('补充说明：如果你更关注白天出发，我可以继续筛掉红眼航班。')).toBeVisible({ timeout: 20_000 });
  298 |       await expect.poll(async () => {
  299 |         const metrics = await measureScrollMetrics(page);
  300 |         return metrics.scrollTop > metricsAfterSecondChunk.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  301 |       }, { timeout: 20_000 }).toBe(true);
  302 | 
  303 |       await expect.poll(async () => {
  304 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
  305 |       }, { timeout: 20_000 }).toBe(true);
  306 |     } finally {
  307 |       await closeElectronApp(app);
  308 |     }
  309 |   });
  310 | });
  311 | 
```