# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: gateway-runtime-behavior.spec.ts >> Gateway runtime behavior >> keeps short chat replies aligned with the composer shell
- Location: tests\e2e\gateway-runtime-behavior.spec.ts:390:7

# Error details

```
Error: No assistant reply arrived for model model-alpha within 90s
```

# Test source

```ts
  177 | }
  178 | 
  179 | async function startMockOpenAiServer(): Promise<{
  180 |   baseUrl: string;
  181 |   close: () => Promise<void>;
  182 | }> {
  183 |   const server = createHttpServer((req, res) => {
  184 |     if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
  185 |       res.writeHead(404, { 'Content-Type': 'application/json' });
  186 |       res.end(JSON.stringify({ error: { message: 'Not found' } }));
  187 |       return;
  188 |     }
  189 | 
  190 |     const chunks: Buffer[] = [];
  191 |     req.on('data', (chunk) => {
  192 |       chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  193 |     });
  194 |     req.on('end', () => {
  195 |       const rawBody = Buffer.concat(chunks).toString('utf8');
  196 |       const body = rawBody ? JSON.parse(rawBody) as { model?: string } : {};
  197 |       const model = body.model || 'unknown-model';
  198 | 
  199 |       res.writeHead(200, { 'Content-Type': 'application/json' });
  200 |       res.end(JSON.stringify({
  201 |         id: `chatcmpl-${model}`,
  202 |         object: 'chat.completion',
  203 |         choices: [
  204 |           {
  205 |             index: 0,
  206 |             message: {
  207 |               role: 'assistant',
  208 |               content: `reply:${model}`,
  209 |             },
  210 |             finish_reason: 'stop',
  211 |           },
  212 |         ],
  213 |       }));
  214 |     });
  215 |   });
  216 | 
  217 |   await new Promise<void>((resolve) => {
  218 |     server.listen(0, '127.0.0.1', () => resolve());
  219 |   });
  220 | 
  221 |   const address = server.address() as AddressInfo;
  222 |   return {
  223 |     baseUrl: `http://127.0.0.1:${address.port}/v1`,
  224 |     close: async () => {
  225 |       await new Promise<void>((resolve, reject) => {
  226 |         server.close((error) => {
  227 |           if (error) {
  228 |             reject(error);
  229 |             return;
  230 |           }
  231 |           resolve();
  232 |         });
  233 |       });
  234 |     },
  235 |   };
  236 | }
  237 | 
  238 | async function applyModelDraft(page: Page): Promise<void> {
  239 |   const sheet = page.getByTestId('models-config-sheet');
  240 |   await expect(sheet).toBeVisible();
  241 |   await sheet.getByTestId('models-config-sheet-test-button').click();
  242 |   await expect(page.getByTestId('models-config-apply-button')).toBeEnabled({ timeout: 20_000 });
  243 |   await page.getByTestId('models-config-apply-button').click();
  244 |   await expect(sheet).toHaveCount(0);
  245 | }
  246 | 
  247 | async function sendMessageAndExpectReply(
  248 |   page: Page,
  249 |   messageInput: ReturnType<Page['getByRole']>,
  250 |   sendButton: ReturnType<Page['getByTestId']>,
  251 |   modelId: string,
  252 |   prompt: string,
  253 | ): Promise<void> {
  254 |   await messageInput.fill(prompt);
  255 |   await sendButton.click();
  256 | 
  257 |   const assistantMessage = page.getByTestId('chat-message-content-assistant').last();
  258 |   const errorMessage = page.getByTestId('chat-assistant-error-message').last();
  259 |   const deadline = Date.now() + 90_000;
  260 | 
  261 |   while (Date.now() < deadline) {
  262 |     if (await assistantMessage.count()) {
  263 |       const text = (await assistantMessage.textContent()) || '';
  264 |       if (text.includes(`reply:${modelId}`)) {
  265 |         return;
  266 |       }
  267 |     }
  268 | 
  269 |     if (await errorMessage.count()) {
  270 |       const text = ((await errorMessage.textContent()) || '').trim();
  271 |       throw new Error(`Chat returned an error after switching to ${modelId}: ${text}`);
  272 |     }
  273 | 
  274 |     await page.waitForTimeout(1_000);
  275 |   }
  276 | 
> 277 |   throw new Error(`No assistant reply arrived for model ${modelId} within 90s`);
      |         ^ Error: No assistant reply arrived for model model-alpha within 90s
  278 | }
  279 | 
  280 | test.describe('Gateway runtime behavior', () => {
  281 |   test('restarts the gateway after adding and editing model configs on Windows', async ({ page }) => {
  282 |     test.setTimeout(420_000);
  283 |     const mockServer = await startMockOpenAiServer();
  284 | 
  285 |     try {
  286 |       await completeSetup(page);
  287 |       await seedDefaultProvider(page, mockServer.baseUrl);
  288 |       await page.reload();
  289 |       await expect(page.getByTestId('main-layout')).toBeVisible();
  290 |       await configureIsolatedGatewayPort(page);
  291 |       await startGateway(page);
  292 |       await waitForGatewayStable(page);
  293 | 
  294 |       await openModelsFromSettings(page);
  295 |       await expect(page.getByTestId('models-config-panel')).toBeVisible();
  296 | 
  297 |       const gatewayPids: number[] = [];
  298 |       gatewayPids.push((await readGatewayStatus(page)).pid || 0);
  299 | 
  300 |       await page.getByTestId('models-config-add-button').click();
  301 |       const createSheet = page.getByTestId('models-config-sheet');
  302 |       await createSheet.getByTestId('models-config-sheet-vendor-select').selectOption('custom');
  303 |       await createSheet.getByTestId('models-config-sheet-label-input').fill('Created Config E2E');
  304 |       await createSheet.getByTestId('models-config-sheet-model-input').fill('model-delta');
  305 |       await createSheet.getByTestId('models-config-sheet-base-url-input').fill(mockServer.baseUrl);
  306 |       await createSheet.locator('#draft-api-key').fill(DEFAULT_API_KEY);
  307 |       const pidBeforeAdd = gatewayPids.at(-1) || 0;
  308 |       await applyModelDraft(page);
  309 |       await expect(page.locator('tbody tr', { hasText: 'model-delta' }).first()).toBeVisible();
  310 |       gatewayPids.push((await waitForGatewayPidChange(page, pidBeforeAdd)).pid || 0);
  311 | 
  312 |       await waitForGatewayStable(page);
  313 |       const deltaRow = page.locator('tbody tr', { hasText: 'model-delta' }).first();
  314 |       await deltaRow.locator('[data-testid^="models-config-edit-"]').click();
  315 |       const editSheet = page.getByTestId('models-config-sheet');
  316 |       await editSheet.getByTestId('models-config-sheet-model-input').fill('model-epsilon');
  317 |       const pidBeforeEditOne = gatewayPids.at(-1) || 0;
  318 |       await applyModelDraft(page);
  319 |       await expect(page.locator('tbody tr', { hasText: 'model-epsilon' }).first()).toBeVisible();
  320 |       gatewayPids.push((await waitForGatewayPidChange(page, pidBeforeEditOne)).pid || 0);
  321 | 
  322 |       await waitForGatewayStable(page);
  323 |       const epsilonRow = page.locator('tbody tr', { hasText: 'model-epsilon' }).first();
  324 |       await epsilonRow.locator('[data-testid^="models-config-edit-"]').click();
  325 |       const secondEditSheet = page.getByTestId('models-config-sheet');
  326 |       await secondEditSheet.getByTestId('models-config-sheet-model-input').fill('model-zeta');
  327 |       const pidBeforeEditTwo = gatewayPids.at(-1) || 0;
  328 |       await applyModelDraft(page);
  329 |       await expect(page.locator('tbody tr', { hasText: 'model-zeta' }).first()).toBeVisible();
  330 |       gatewayPids.push((await waitForGatewayPidChange(page, pidBeforeEditTwo)).pid || 0);
  331 | 
  332 |       expect(new Set(gatewayPids).size).toBe(gatewayPids.length);
  333 |     } finally {
  334 |       await mockServer.close();
  335 |     }
  336 |   });
  337 | 
  338 |   test('keeps the gateway pid stable while switching chat models and still returns replies', async ({ page }) => {
  339 |     test.setTimeout(420_000);
  340 |     const mockServer = await startMockOpenAiServer();
  341 | 
  342 |     try {
  343 |       await completeSetup(page);
  344 |       await seedDefaultProvider(page, mockServer.baseUrl);
  345 |       await page.reload();
  346 |       await expect(page.getByTestId('main-layout')).toBeVisible();
  347 |       await configureIsolatedGatewayPort(page);
  348 |       await startGateway(page);
  349 |       await waitForGatewayStable(page);
  350 | 
  351 |       await openModelsFromSettings(page);
  352 |       await expect(page.getByTestId('models-config-panel')).toBeVisible();
  353 |       const stablePid = (await waitForGatewayStable(page)).pid;
  354 | 
  355 |       await page.getByTestId('sidebar-new-chat').click();
  356 | 
  357 |       const composer = page.getByTestId('chat-composer');
  358 |       const modelSwitch = composer.getByTestId('chat-model-switch');
  359 |       const messageInput = composer.getByRole('textbox');
  360 |       const sendButton = composer.getByTestId('chat-send-button');
  361 | 
  362 |       await expect(modelSwitch).toContainText(`${DEFAULT_PROVIDER_LABEL} / model-alpha`, { timeout: 20_000 });
  363 |       await expect(modelSwitch).toBeEnabled();
  364 | 
  365 |       await sendMessageAndExpectReply(page, messageInput, sendButton, 'model-alpha', 'baseline alpha');
  366 |       expect((await readGatewayStatus(page)).pid).toBe(stablePid);
  367 | 
  368 |       const rounds = [
  369 |         { modelId: 'model-beta', prompt: 'switch beta' },
  370 |         { modelId: 'model-gamma', prompt: 'switch gamma' },
  371 |       ];
  372 | 
  373 |       for (const [index, round] of rounds.entries()) {
  374 |         await modelSwitch.click();
  375 |         await page.getByRole('button', { name: `${DEFAULT_PROVIDER_LABEL} / ${round.modelId}` }).click();
  376 |         await expect(modelSwitch).toContainText(`${DEFAULT_PROVIDER_LABEL} / ${round.modelId}`);
  377 |         expect((await readGatewayStatus(page)).pid).toBe(stablePid);
```