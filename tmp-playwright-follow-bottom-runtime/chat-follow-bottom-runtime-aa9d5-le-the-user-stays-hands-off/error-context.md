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
  191 |               setTimeout(() => {
  192 |                 emitNotification({
  193 |                   method: 'agent',
  194 |                   params: {
  195 |                     runId,
  196 |                     sessionKey: params?.sessionKey || sessionKey,
  197 |                     stream: 'assistant',
  198 |                     data: {
  199 |                       text: fullText,
  200 |                       delta: index === 0 ? fullText : chunks[index].slice(chunks[index - 1].length),
  201 |                     },
  202 |                   },
  203 |                 });
  204 |               }, 400 + (index * 900));
  205 |             });
  206 | 
  207 |             setTimeout(() => {
  208 |               const completedAt = Math.floor(Date.now() / 1000);
  209 |               historyMessages = [
  210 |                 ...seedMessages,
  211 |                 {
  212 |                   id: 'user-follow-bottom-1',
  213 |                   role: 'user',
  214 |                   content: prompt,
  215 |                   timestamp: now,
  216 |                 },
  217 |                 {
  218 |                   id: 'assistant-follow-bottom-1',
  219 |                   role: 'assistant',
  220 |                   content: chunks[chunks.length - 1],
  221 |                   timestamp: completedAt,
  222 |                 },
  223 |               ];
  224 |               emitNotification({
  225 |                 method: 'agent',
  226 |                 params: {
  227 |                   phase: 'completed',
  228 |                   state: 'final',
  229 |                   runId,
  230 |                   sessionKey: params?.sessionKey || sessionKey,
  231 |                   message: {
  232 |                     role: 'assistant',
  233 |                     content: chunks[chunks.length - 1],
  234 |                     timestamp: completedAt,
  235 |                   },
  236 |                 },
  237 |               });
  238 |             }, 3_400);
  239 | 
  240 |             return {
  241 |               success: true,
  242 |               result: { runId },
  243 |             };
  244 |           }
  245 | 
  246 |           return { success: true, result: {} };
  247 |         });
  248 |       }, {
  249 |         prompt: PROMPT,
  250 |         runId: RUN_ID,
  251 |         sessionKey: SESSION_KEY,
  252 |         sessionId: SESSION_ID,
  253 |       });
  254 | 
  255 |       const page = await getStableWindow(app);
  256 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  257 | 
  258 |       const composer = page.getByTestId('chat-composer');
  259 |       const messageInput = composer.getByRole('textbox');
  260 |       const sendButton = composer.getByTestId('chat-send-button');
  261 | 
  262 |       await expect(page.getByText('历史回答 14')).toBeVisible({ timeout: 30_000 });
  263 |       await messageInput.fill(PROMPT);
  264 |       await sendButton.click();
  265 | 
  266 |       await expect.poll(async () => {
  267 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
  268 |       }, { timeout: 20_000 }).toBe(true);
  269 | 
  270 |       await expect.poll(async () => {
  271 |         const metrics = await measureScrollMetrics(page);
  272 |         return metrics.distanceFromBottom != null ? (metrics.distanceFromBottom <= 24) : false;
  273 |       }, { timeout: 20_000 }).toBe(true);
  274 |       const initialMetrics = await measureScrollMetrics(page);
  275 | 
  276 |       await expect(page.getByText('东方航空')).toBeVisible({ timeout: 20_000 });
  277 |       await expect.poll(async () => {
  278 |         const metrics = await measureScrollMetrics(page);
  279 |         return metrics.scrollTop > initialMetrics.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  280 |       }, { timeout: 20_000 }).toBe(true);
  281 |       const metricsAfterFirstChunk = await measureScrollMetrics(page);
  282 | 
  283 |       await expect(page.getByText('湖南航空')).toBeVisible({ timeout: 20_000 });
  284 |       await expect.poll(async () => {
  285 |         const metrics = await measureScrollMetrics(page);
  286 |         return metrics.scrollTop > metricsAfterFirstChunk.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  287 |       }, { timeout: 20_000 }).toBe(true);
  288 |       const metricsAfterSecondChunk = await measureScrollMetrics(page);
  289 | 
  290 |       await expect(page.getByText('补充说明：如果你更关注白天出发，我可以继续筛掉红眼航班。')).toBeVisible({ timeout: 20_000 });
> 291 |       await expect.poll(async () => {
      |       ^ Error: expect(received).toBe(expected) // Object.is equality
  292 |         const metrics = await measureScrollMetrics(page);
  293 |         return metrics.scrollTop > metricsAfterSecondChunk.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  294 |       }, { timeout: 20_000 }).toBe(true);
  295 | 
  296 |       await expect.poll(async () => {
  297 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
  298 |       }, { timeout: 20_000 }).toBe(true);
  299 |     } finally {
  300 |       await closeElectronApp(app);
  301 |     }
  302 |   });
  303 | });
  304 | 
```