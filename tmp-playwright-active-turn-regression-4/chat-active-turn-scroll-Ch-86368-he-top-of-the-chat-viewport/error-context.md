# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-active-turn-scroll.spec.ts >> Chat active turn scroll >> keeps a newly sent turn pinned to the top of the chat viewport
- Location: tests\e2e\chat-active-turn-scroll.spec.ts:317:7

# Error details

```
Error: Gateway did not become ready in time
```

# Test source

```ts
  96  |         baseUrl,
  97  |         apiProtocol: 'openai-completions',
  98  |         model: 'model-scroll',
  99  |         metadata: {
  100 |           customModels: ['model-scroll'],
  101 |           modelProtocols: {
  102 |             'model-scroll': 'openai-completions',
  103 |           },
  104 |         },
  105 |         enabled: true,
  106 |         isDefault: false,
  107 |         createdAt: now,
  108 |         updatedAt: now,
  109 |       },
  110 |       apiKey: DEFAULT_API_KEY,
  111 |     },
  112 |   });
  113 | 
  114 |   await hostApiJson(page, '/api/provider-accounts/default', {
  115 |     method: 'PUT',
  116 |     body: { accountId: DEFAULT_ACCOUNT_ID },
  117 |   });
  118 | }
  119 | 
  120 | async function startDelayedMockOpenAiServer(): Promise<{
  121 |   baseUrl: string;
  122 |   close: () => Promise<void>;
  123 | }> {
  124 |   const server = createHttpServer((req, res) => {
  125 |     if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
  126 |       res.writeHead(404, { 'Content-Type': 'application/json' });
  127 |       res.end(JSON.stringify({ error: { message: 'Not found' } }));
  128 |       return;
  129 |     }
  130 | 
  131 |     const chunks: Buffer[] = [];
  132 |     req.on('data', (chunk) => {
  133 |       chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  134 |     });
  135 |     req.on('end', () => {
  136 |       const rawBody = Buffer.concat(chunks).toString('utf8');
  137 |       const body = rawBody ? JSON.parse(rawBody) as { model?: string } : {};
  138 |       const model = body.model || 'unknown-model';
  139 | 
  140 |       setTimeout(() => {
  141 |         res.writeHead(200, { 'Content-Type': 'application/json' });
  142 |         res.end(JSON.stringify({
  143 |           id: `chatcmpl-${model}`,
  144 |           object: 'chat.completion',
  145 |           choices: [
  146 |             {
  147 |               index: 0,
  148 |               message: {
  149 |                 role: 'assistant',
  150 |                 content: `reply:${model}`,
  151 |               },
  152 |               finish_reason: 'stop',
  153 |             },
  154 |           ],
  155 |         }));
  156 |       }, 4_000);
  157 |     });
  158 |   });
  159 | 
  160 |   await new Promise<void>((resolve) => {
  161 |     server.listen(0, '127.0.0.1', () => resolve());
  162 |   });
  163 | 
  164 |   const address = server.address() as AddressInfo;
  165 |   return {
  166 |     baseUrl: `http://127.0.0.1:${address.port}/v1`,
  167 |     close: async () => {
  168 |       await new Promise<void>((resolve, reject) => {
  169 |         server.close((error) => {
  170 |           if (error) {
  171 |             reject(error);
  172 |             return;
  173 |           }
  174 |           resolve();
  175 |         });
  176 |       });
  177 |     },
  178 |   };
  179 | }
  180 | 
  181 | async function waitForGatewayRunning(page: Page, timeoutMs = GATEWAY_START_TIMEOUT_MS): Promise<void> {
  182 |   const deadline = Date.now() + timeoutMs;
  183 | 
  184 |   while (Date.now() < deadline) {
  185 |     const status = await page.evaluate(async () => (
  186 |       await window.electron.ipcRenderer.invoke('gateway:status')
  187 |     ) as { state?: string; pid?: number });
  188 | 
  189 |     if (status?.state === 'running' && status?.pid) {
  190 |       return;
  191 |     }
  192 | 
  193 |     await page.waitForTimeout(500);
  194 |   }
  195 | 
> 196 |   throw new Error('Gateway did not become ready in time');
      |         ^ Error: Gateway did not become ready in time
  197 | }
  198 | 
  199 | async function waitForGatewayStable(page: Page, minConnectedAgeMs = GATEWAY_STABLE_MS): Promise<void> {
  200 |   const deadline = Date.now() + minConnectedAgeMs + GATEWAY_START_TIMEOUT_MS;
  201 | 
  202 |   while (Date.now() < deadline) {
  203 |     const status = await page.evaluate(async () => (
  204 |       await window.electron.ipcRenderer.invoke('gateway:status')
  205 |     ) as { state?: string; pid?: number; connectedAt?: number | null });
  206 | 
  207 |     if (
  208 |       status?.state === 'running'
  209 |       && Boolean(status.pid)
  210 |       && typeof status.connectedAt === 'number'
  211 |       && Date.now() - status.connectedAt >= minConnectedAgeMs
  212 |     ) {
  213 |       return;
  214 |     }
  215 | 
  216 |     await page.waitForTimeout(500);
  217 |   }
  218 | 
  219 |   throw new Error('Gateway did not become stable in time');
  220 | }
  221 | 
  222 | async function startGateway(page: Page): Promise<void> {
  223 |   const result = await page.evaluate(async () => (
  224 |     await window.electron.ipcRenderer.invoke('gateway:start')
  225 |   ) as { success?: boolean; error?: string });
  226 |   expect(result?.success, result?.error || 'gateway:start failed during E2E setup').toBe(true);
  227 |   await waitForGatewayRunning(page);
  228 | }
  229 | 
  230 | async function seedSession(homeDir: string): Promise<void> {
  231 |   const baseTimestamp = Math.floor(Date.now() / 1000) - 120;
  232 |   const sessionsDir = join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  233 |   const seededMessages: Array<Record<string, unknown>> = [];
  234 | 
  235 |   for (let index = 0; index < 18; index += 1) {
  236 |     seededMessages.push({
  237 |       id: `history-user-${index + 1}`,
  238 |       role: 'user',
  239 |       content: `History question ${index + 1}`,
  240 |       timestamp: baseTimestamp + (index * 2),
  241 |     });
  242 |     seededMessages.push({
  243 |       id: `history-assistant-${index + 1}`,
  244 |       role: 'assistant',
  245 |       content: `History answer ${index + 1}`,
  246 |       timestamp: baseTimestamp + (index * 2) + 1,
  247 |     });
  248 |   }
  249 | 
  250 |   await mkdir(sessionsDir, { recursive: true });
  251 |   await writeFile(
  252 |     join(sessionsDir, 'sessions.json'),
  253 |     JSON.stringify({
  254 |       sessions: [
  255 |         {
  256 |           key: SESSION_KEY,
  257 |           id: 'active-turn-scroll-test',
  258 |           file: SESSION_FILE,
  259 |           label: SESSION_LABEL,
  260 |           updatedAt: Date.now(),
  261 |         },
  262 |       ],
  263 |     }, null, 2),
  264 |     'utf8',
  265 |   );
  266 |   await writeFile(
  267 |     join(sessionsDir, SESSION_FILE),
  268 |     `${seededMessages.map((message) => JSON.stringify(message)).join('\n')}\n`,
  269 |     'utf8',
  270 |   );
  271 | }
  272 | 
  273 | async function openSeededSession(page: Page): Promise<void> {
  274 |   const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
  275 |   await expect(sessionRow).toBeVisible({ timeout: 60_000 });
  276 |   await sessionRow.click();
  277 | }
  278 | 
  279 | async function measureActiveTurnAlignment(page: Page): Promise<{ delta: number; scrollTop: number } | null> {
  280 |   return await page.evaluate(() => {
  281 |     const scrollContainer = document.querySelector('[data-testid="chat-scroll-container"]') as HTMLElement | null;
  282 |     const anchor = document.querySelector('[data-testid="chat-active-turn-anchor"]') as HTMLElement | null;
  283 | 
  284 |     if (!scrollContainer || !anchor) {
  285 |       return null;
  286 |     }
  287 | 
  288 |     const scrollRect = scrollContainer.getBoundingClientRect();
  289 |     const anchorRect = anchor.getBoundingClientRect();
  290 | 
  291 |     return {
  292 |       delta: Number((anchorRect.top - scrollRect.top).toFixed(2)),
  293 |       scrollTop: scrollContainer.scrollTop,
  294 |     };
  295 |   });
  296 | }
```