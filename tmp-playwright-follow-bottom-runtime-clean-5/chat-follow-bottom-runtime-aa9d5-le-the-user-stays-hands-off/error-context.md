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
  199 |                   sessionKey: params?.sessionKey || sessionKey,
  200 |                 },
  201 |               });
  202 |             }, 0);
  203 | 
  204 |             const chunkDelays = [400, 2200, 4000];
  205 |             chunks.forEach((fullText, index) => {
  206 |               setTimeout(() => {
  207 |                 emitNotification({
  208 |                   method: 'agent',
  209 |                   params: {
  210 |                     runId,
  211 |                     sessionKey: params?.sessionKey || sessionKey,
  212 |                     stream: 'assistant',
  213 |                     data: {
  214 |                       text: fullText,
  215 |                       delta: index === 0 ? fullText : chunks[index].slice(chunks[index - 1].length),
  216 |                     },
  217 |                   },
  218 |                 });
  219 |               }, chunkDelays[index] ?? (400 + (index * 1800)));
  220 |             });
  221 | 
  222 |             setTimeout(() => {
  223 |               const completedAt = Math.floor(Date.now() / 1000);
  224 |               historyMessages = [
  225 |                 ...seedMessages,
  226 |                 {
  227 |                   id: 'user-follow-bottom-1',
  228 |                   role: 'user',
  229 |                   content: prompt,
  230 |                   timestamp: now,
  231 |                 },
  232 |                 {
  233 |                   id: 'assistant-follow-bottom-1',
  234 |                   role: 'assistant',
  235 |                   content: chunks[chunks.length - 1],
  236 |                   timestamp: completedAt,
  237 |                 },
  238 |               ];
  239 |               emitNotification({
  240 |                 method: 'agent',
  241 |                 params: {
  242 |                   phase: 'completed',
  243 |                   state: 'final',
  244 |                   runId,
  245 |                   sessionKey: params?.sessionKey || sessionKey,
  246 |                   message: {
  247 |                     role: 'assistant',
  248 |                     content: chunks[chunks.length - 1],
  249 |                     timestamp: completedAt,
  250 |                   },
  251 |                 },
  252 |               });
  253 |             }, 6_200);
  254 | 
  255 |             return {
  256 |               success: true,
  257 |               result: { runId },
  258 |             };
  259 |           }
  260 | 
  261 |           return { success: true, result: {} };
  262 |         });
  263 |       }, {
  264 |         prompt: PROMPT,
  265 |         runId: RUN_ID,
  266 |         sessionKey: SESSION_KEY,
  267 |         sessionId: SESSION_ID,
  268 |       });
  269 | 
  270 |       const page = await getStableWindow(app);
  271 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  272 | 
  273 |       const composer = page.getByTestId('chat-composer');
  274 |       const messageInput = composer.getByRole('textbox');
  275 |       const sendButton = composer.getByTestId('chat-send-button');
  276 | 
  277 |       await expect(page.getByText('历史回答 14')).toBeVisible({ timeout: 30_000 });
  278 |       await messageInput.fill(PROMPT);
  279 |       await sendButton.click();
  280 | 
  281 |       await expect.poll(async () => {
  282 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
  283 |       }, { timeout: 20_000 }).toBe(true);
  284 | 
  285 |       await expect.poll(async () => {
  286 |         const metrics = await measureScrollMetrics(page);
  287 |         return metrics.distanceFromBottom != null ? (metrics.distanceFromBottom <= 24) : false;
  288 |       }, { timeout: 20_000 }).toBe(true);
  289 |       const initialMetrics = await measureScrollMetrics(page);
  290 | 
  291 |       await expect(page.getByRole('cell', { name: '东方航空', exact: true })).toBeVisible({ timeout: 20_000 });
  292 |       await expect.poll(async () => {
  293 |         const metrics = await measureScrollMetrics(page);
  294 |         return metrics.scrollTop > initialMetrics.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  295 |       }, { timeout: 20_000 }).toBe(true);
  296 |       const metricsAfterFirstChunk = await measureScrollMetrics(page);
  297 | 
  298 |       await expect(page.getByRole('cell', { name: '南方航空', exact: true })).toBeVisible({ timeout: 20_000 });
> 299 |       await expect.poll(async () => {
      |       ^ Error: expect(received).toBe(expected) // Object.is equality
  300 |         const metrics = await measureScrollMetrics(page);
  301 |         return metrics.scrollTop > metricsAfterFirstChunk.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  302 |       }, { timeout: 20_000 }).toBe(true);
  303 |       const metricsAfterSecondChunk = await measureScrollMetrics(page);
  304 | 
  305 |       await expect(page.getByRole('cell', { name: '厦门航空', exact: true })).toBeVisible({ timeout: 20_000 });
  306 |       await expect.poll(async () => {
  307 |         const metrics = await measureScrollMetrics(page);
  308 |         return metrics.scrollTop > metricsAfterSecondChunk.scrollTop && (metrics.distanceFromBottom ?? 999) <= 24;
  309 |       }, { timeout: 20_000 }).toBe(true);
  310 | 
  311 |       await expect.poll(async () => {
  312 |         return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-send-horizontal'));
  313 |       }, { timeout: 20_000 }).toBe(true);
  314 |     } finally {
  315 |       await closeElectronApp(app);
  316 |     }
  317 |   });
  318 | });
  319 | 
```