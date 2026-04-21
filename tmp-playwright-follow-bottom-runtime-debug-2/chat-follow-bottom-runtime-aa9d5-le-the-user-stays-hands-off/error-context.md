# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-follow-bottom-runtime.spec.ts >> Chat follow-bottom runtime >> keeps moving upward as streamed output grows while the user stays hands-off
- Location: tests\e2e\chat-follow-bottom-runtime.spec.ts:42:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 20000ms exceeded while waiting on the predicate
```

# Test source

```ts
  199 |             }, 0);
  200 | 
  201 |             chunks.forEach((fullText, index) => {
  202 |               setTimeout(() => {
  203 |                 emitNotification({
  204 |                   method: 'agent',
  205 |                   params: {
  206 |                     runId,
  207 |                     sessionKey: params?.sessionKey || sessionKey,
  208 |                     stream: 'assistant',
  209 |                     data: {
  210 |                       text: fullText,
  211 |                       delta: index === 0 ? fullText : chunks[index].slice(chunks[index - 1].length),
  212 |                     },
  213 |                   },
  214 |                 });
  215 |               }, 400 + (index * 900));
  216 |             });
  217 | 
  218 |             setTimeout(() => {
  219 |               const completedAt = Math.floor(Date.now() / 1000);
  220 |               historyMessages = [
  221 |                 ...seedMessages,
  222 |                 {
  223 |                   id: 'user-follow-bottom-1',
  224 |                   role: 'user',
  225 |                   content: prompt,
  226 |                   timestamp: now,
  227 |                 },
  228 |                 {
  229 |                   id: 'assistant-follow-bottom-1',
  230 |                   role: 'assistant',
  231 |                   content: chunks[chunks.length - 1],
  232 |                   timestamp: completedAt,
  233 |                 },
  234 |               ];
  235 |               emitNotification({
  236 |                 method: 'agent',
  237 |                 params: {
  238 |                   phase: 'completed',
  239 |                   state: 'final',
  240 |                   runId,
  241 |                   sessionKey: params?.sessionKey || sessionKey,
  242 |                   message: {
  243 |                     role: 'assistant',
  244 |                     content: chunks[chunks.length - 1],
  245 |                     timestamp: completedAt,
  246 |                   },
  247 |                 },
  248 |               });
  249 |             }, 3_400);
  250 | 
  251 |             return {
  252 |               success: true,
  253 |               result: { runId },
  254 |             };
  255 |           }
  256 | 
  257 |           return { success: true, result: {} };
  258 |         });
  259 |       }, {
  260 |         prompt: PROMPT,
  261 |         runId: RUN_ID,
  262 |         sessionKey: SESSION_KEY,
  263 |         sessionId: SESSION_ID,
  264 |       });
  265 | 
  266 |       const page = await getStableWindow(app);
  267 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  268 | 
  269 |       const composer = page.getByTestId('chat-composer');
  270 |       const messageInput = composer.getByRole('textbox');
  271 |       const sendButton = composer.getByTestId('chat-send-button');
  272 | 
  273 |       await expect(page.getByText('历史回答 14')).toBeVisible({ timeout: 30_000 });
  274 |       await messageInput.fill(PROMPT);
  275 |       await sendButton.click();
  276 | 
  277 |       await expect.poll(async () => {
  278 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
  279 |       }, { timeout: 20_000 }).toBe(true);
  280 | 
  281 |       await expect.poll(async () => {
  282 |         const metrics = await measureScrollMetrics(page);
  283 |         return metrics.distanceFromBottom != null ? (metrics.distanceFromBottom <= 24) : false;
  284 |       }, { timeout: 20_000 }).toBe(true);
  285 |       const initialMetrics = await measureScrollMetrics(page);
  286 |       console.log('initialMetrics', initialMetrics);
  287 | 
  288 |       await expect(page.getByRole('cell', { name: '东方航空', exact: true })).toBeVisible({ timeout: 20_000 });
  289 |       console.log('afterFirstVisible', await measureScrollMetrics(page));
  290 |       await expect.poll(async () => {
  291 |         const metrics = await measureScrollMetrics(page);
  292 |         return metrics.scrollTop > initialMetrics.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  293 |       }, { timeout: 20_000 }).toBe(true);
  294 |       const metricsAfterFirstChunk = await measureScrollMetrics(page);
  295 |       console.log('metricsAfterFirstChunk', metricsAfterFirstChunk);
  296 | 
  297 |       await expect(page.getByRole('cell', { name: '湖南航空', exact: true })).toBeVisible({ timeout: 20_000 });
  298 |       console.log('afterSecondVisible', await measureScrollMetrics(page));
> 299 |       await expect.poll(async () => {
      |       ^ Error: expect(received).toBe(expected) // Object.is equality
  300 |         const metrics = await measureScrollMetrics(page);
  301 |         console.log('secondChunkPoll', metrics);
  302 |         return metrics.scrollTop > metricsAfterFirstChunk.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  303 |       }, { timeout: 20_000 }).toBe(true);
  304 |       const metricsAfterSecondChunk = await measureScrollMetrics(page);
  305 | 
  306 |       await expect(page.getByText('补充说明：如果你更关注白天出发，我可以继续筛掉红眼航班。')).toBeVisible({ timeout: 20_000 });
  307 |       await expect.poll(async () => {
  308 |         const metrics = await measureScrollMetrics(page);
  309 |         return metrics.scrollTop > metricsAfterSecondChunk.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  310 |       }, { timeout: 20_000 }).toBe(true);
  311 | 
  312 |       await expect.poll(async () => {
  313 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
  314 |       }, { timeout: 20_000 }).toBe(true);
  315 |     } finally {
  316 |       await closeElectronApp(app);
  317 |     }
  318 |   });
  319 | });
  320 | 
```