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
  196 |                   sessionKey: params?.sessionKey || sessionKey,
  197 |                 },
  198 |               });
  199 |             }, 0);
  200 | 
  201 |             const chunkDelays = [400, 2200, 4000];
  202 |             chunks.forEach((fullText, index) => {
  203 |               setTimeout(() => {
  204 |                 emitNotification({
  205 |                   method: 'agent',
  206 |                   params: {
  207 |                     runId,
  208 |                     sessionKey: params?.sessionKey || sessionKey,
  209 |                     stream: 'assistant',
  210 |                     data: {
  211 |                       text: fullText,
  212 |                       delta: index === 0 ? fullText : chunks[index].slice(chunks[index - 1].length),
  213 |                     },
  214 |                   },
  215 |                 });
  216 |               }, chunkDelays[index] ?? (400 + (index * 1800)));
  217 |             });
  218 | 
  219 |             setTimeout(() => {
  220 |               const completedAt = Math.floor(Date.now() / 1000);
  221 |               historyMessages = [
  222 |                 ...seedMessages,
  223 |                 {
  224 |                   id: 'user-follow-bottom-1',
  225 |                   role: 'user',
  226 |                   content: prompt,
  227 |                   timestamp: now,
  228 |                 },
  229 |                 {
  230 |                   id: 'assistant-follow-bottom-1',
  231 |                   role: 'assistant',
  232 |                   content: chunks[chunks.length - 1],
  233 |                   timestamp: completedAt,
  234 |                 },
  235 |               ];
  236 |               emitNotification({
  237 |                 method: 'agent',
  238 |                 params: {
  239 |                   phase: 'completed',
  240 |                   state: 'final',
  241 |                   runId,
  242 |                   sessionKey: params?.sessionKey || sessionKey,
  243 |                   message: {
  244 |                     role: 'assistant',
  245 |                     content: chunks[chunks.length - 1],
  246 |                     timestamp: completedAt,
  247 |                   },
  248 |                 },
  249 |               });
  250 |             }, 6_200);
  251 | 
  252 |             return {
  253 |               success: true,
  254 |               result: { runId },
  255 |             };
  256 |           }
  257 | 
  258 |           return { success: true, result: {} };
  259 |         });
  260 |       }, {
  261 |         prompt: PROMPT,
  262 |         runId: RUN_ID,
  263 |         sessionKey: SESSION_KEY,
  264 |         sessionId: SESSION_ID,
  265 |       });
  266 | 
  267 |       const page = await getStableWindow(app);
  268 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  269 | 
  270 |       const composer = page.getByTestId('chat-composer');
  271 |       const messageInput = composer.getByRole('textbox');
  272 |       const sendButton = composer.getByTestId('chat-send-button');
  273 | 
  274 |       await expect(page.getByText('历史回答 14')).toBeVisible({ timeout: 30_000 });
  275 |       await messageInput.fill(PROMPT);
  276 |       await sendButton.click();
  277 | 
  278 |       await expect.poll(async () => {
  279 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
  280 |       }, { timeout: 20_000 }).toBe(true);
  281 | 
  282 |       await expect.poll(async () => {
  283 |         const metrics = await measureScrollMetrics(page);
  284 |         return metrics.distanceFromBottom != null ? (metrics.distanceFromBottom <= 24) : false;
  285 |       }, { timeout: 20_000 }).toBe(true);
  286 |       const initialMetrics = await measureScrollMetrics(page);
  287 | 
  288 |       await expect(page.getByRole('cell', { name: '东方航空', exact: true })).toBeVisible({ timeout: 20_000 });
  289 |       await expect.poll(async () => {
  290 |         const metrics = await measureScrollMetrics(page);
  291 |         return metrics.scrollTop > initialMetrics.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  292 |       }, { timeout: 20_000 }).toBe(true);
  293 |       const metricsAfterFirstChunk = await measureScrollMetrics(page);
  294 | 
  295 |       await expect(page.getByRole('cell', { name: '湖南航空', exact: true })).toBeVisible({ timeout: 20_000 });
> 296 |       await expect.poll(async () => {
      |       ^ Error: expect(received).toBe(expected) // Object.is equality
  297 |         const metrics = await measureScrollMetrics(page);
  298 |         return metrics.scrollTop > metricsAfterFirstChunk.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  299 |       }, { timeout: 20_000 }).toBe(true);
  300 |       const metricsAfterSecondChunk = await measureScrollMetrics(page);
  301 | 
  302 |       await expect(page.getByText('补充说明七：如果你只接受直飞，我也可以只保留直飞航班。')).toBeVisible({ timeout: 20_000 });
  303 |       await expect.poll(async () => {
  304 |         const metrics = await measureScrollMetrics(page);
  305 |         return metrics.scrollTop > metricsAfterSecondChunk.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  306 |       }, { timeout: 20_000 }).toBe(true);
  307 | 
  308 |       await expect.poll(async () => {
  309 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
  310 |       }, { timeout: 20_000 }).toBe(true);
  311 |     } finally {
  312 |       await closeElectronApp(app);
  313 |     }
  314 |   });
  315 | });
  316 | 
```