# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-refresh-user-dedupe.spec.ts >> Chat refresh user dedupe >> keeps an in-flight user prompt visible only once after a manual refresh
- Location: tests\e2e\chat-refresh-user-dedupe.spec.ts:169:7

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "Conversation info"
Received string:    ""

Call Log:
- Timeout 90000ms exceeded while waiting on the predicate
```

# Test source

```ts
  97  |         isDefault: false,
  98  |         createdAt: now,
  99  |         updatedAt: now,
  100 |       },
  101 |       apiKey: 'sk-test',
  102 |     },
  103 |   });
  104 | 
  105 |   await hostApiJson(page, '/api/provider-accounts/default', {
  106 |     method: 'PUT',
  107 |     body: { accountId: 'chat-refresh-dedupe-provider' },
  108 |   });
  109 | }
  110 | 
  111 | async function startDelayedMockOpenAiServer(): Promise<{
  112 |   baseUrl: string;
  113 |   close: () => Promise<void>;
  114 | }> {
  115 |   const server = createServer((req, res) => {
  116 |     if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
  117 |       res.writeHead(404, { 'Content-Type': 'application/json' });
  118 |       res.end(JSON.stringify({ error: { message: 'Not found' } }));
  119 |       return;
  120 |     }
  121 | 
  122 |     const chunks: Buffer[] = [];
  123 |     req.on('data', (chunk) => {
  124 |       chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  125 |     });
  126 |     req.on('end', () => {
  127 |       setTimeout(() => {
  128 |         res.writeHead(200, { 'Content-Type': 'application/json' });
  129 |         res.end(JSON.stringify({
  130 |           id: 'chatcmpl-refresh-dedupe',
  131 |           object: 'chat.completion',
  132 |           choices: [
  133 |             {
  134 |               index: 0,
  135 |               message: {
  136 |                 role: 'assistant',
  137 |                 content: 'reply:model-alpha',
  138 |               },
  139 |               finish_reason: 'stop',
  140 |             },
  141 |           ],
  142 |         }));
  143 |       }, RESPONSE_DELAY_MS);
  144 |     });
  145 |   });
  146 | 
  147 |   await new Promise<void>((resolve) => {
  148 |     server.listen(0, '127.0.0.1', () => resolve());
  149 |   });
  150 | 
  151 |   const address = server.address() as AddressInfo;
  152 |   return {
  153 |     baseUrl: `http://127.0.0.1:${address.port}/v1`,
  154 |     close: async () => {
  155 |       await new Promise<void>((resolve, reject) => {
  156 |         server.close((error) => {
  157 |           if (error) {
  158 |             reject(error);
  159 |             return;
  160 |           }
  161 |           resolve();
  162 |         });
  163 |       });
  164 |     },
  165 |   };
  166 | }
  167 | 
  168 | test.describe('Chat refresh user dedupe', () => {
  169 |   test('keeps an in-flight user prompt visible only once after a manual refresh', async ({ launchElectronApp }) => {
  170 |     test.setTimeout(240_000);
  171 |     const mockServer = await startDelayedMockOpenAiServer();
  172 |     const app = await launchElectronApp({ skipSetup: true });
  173 | 
  174 |     try {
  175 |       const page = await getStableWindow(app);
  176 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  177 |       await seedDefaultProvider(page, mockServer.baseUrl);
  178 |       await hostApiJson(page, '/api/settings/gatewayPort', {
  179 |         method: 'PUT',
  180 |         body: { value: await allocatePort() },
  181 |       });
  182 |       await page.reload();
  183 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  184 | 
  185 |       await startGateway(page);
  186 | 
  187 |       const composer = page.getByRole('textbox').first();
  188 |       const sendButton = page.getByTestId('chat-send-button');
  189 |       await expect(composer).toBeEnabled({ timeout: 60_000 });
  190 | 
  191 |       await composer.fill(USER_PROMPT);
  192 |       await sendButton.click();
  193 | 
  194 |       const userMessages = page.getByTestId('chat-message-content-user').filter({ hasText: USER_PROMPT });
  195 |       await expect(userMessages).toHaveCount(1, { timeout: 30_000 });
  196 | 
> 197 |       await expect.poll(async () => {
      |       ^ Error: expect(received).toContain(expected) // indexOf
  198 |         const history = await hostApiJson<{
  199 |           resolved?: boolean;
  200 |           messages?: Array<{ role?: string; content?: string }>;
  201 |         }>(page, '/api/sessions/history', {
  202 |           method: 'POST',
  203 |           body: { sessionKey: SESSION_KEY, limit: 200 },
  204 |         });
  205 |         const latestUser = [...(history.messages ?? [])].reverse().find((message) => message.role === 'user');
  206 |         if (!latestUser || typeof latestUser.content !== 'string') return '';
  207 |         return latestUser.content;
  208 |       }, {
  209 |         timeout: 90_000,
  210 |         intervals: [1_000, 2_000],
  211 |       }).toContain('Conversation info');
  212 | 
  213 |       await page.getByTestId('chat-refresh-button').click();
  214 |       await expect(userMessages).toHaveCount(1, { timeout: 30_000 });
  215 | 
  216 |       await expect(page.getByTestId('chat-message-content-assistant').last()).toContainText('reply:model-alpha', {
  217 |         timeout: 90_000,
  218 |       });
  219 |       await expect(userMessages).toHaveCount(1, { timeout: 30_000 });
  220 |     } finally {
  221 |       await closeElectronApp(app);
  222 |       await mockServer.close();
  223 |     }
  224 |   });
  225 | });
  226 | 
```