# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-user-copy.spec.ts >> Chat user message copy >> hides injected execution metadata from user bubbles and copy actions
- Location: tests\e2e\chat-user-copy.spec.ts:143:7

# Error details

```
Error: expect(locator).not.toContainText(expected) failed

Locator: getByTestId('chat-message-content-user').first()
Expected substring: not "Execution playbook:"
Received string: "MDSKILL.mdMarkdown 文件 · 43.9 KBRAR方案skill.rar压缩文件 · 35.0 KB[Wed 2026-04-15 15:43 GMT+8] Conversation info (untrusted metadata): ```json
{\"agent\":{\"id\":\"ops\",\"name\":\"Operations\",\"preferredModel\":\"custom-custombc/gpt-5.4\"}}
```
Execution playbook:
- You are currently acting as the Operations agent.
- Preferred model: custom-custombc/gpt-5.4
- If tools are unavailable, explain the block instead of fabricating.

What can you do?刚刚"
Timeout: 15000ms

Call log:
  - Expect "not toContainText" with timeout 15000ms
  - waiting for getByTestId('chat-message-content-user').first()
    18 × locator resolved to <div data-testid="chat-message-content-user" class="flex flex-col w-full min-w-0 space-y-2 max-w-[80%] items-end">…</div>
       - unexpected value "MDSKILL.mdMarkdown 文件 · 43.9 KBRAR方案skill.rar压缩文件 · 35.0 KB[Wed 2026-04-15 15:43 GMT+8] Conversation info (untrusted metadata): ```json
{"agent":{"id":"ops","name":"Operations","preferredModel":"custom-custombc/gpt-5.4"}}
```
Execution playbook:
- You are currently acting as the Operations agent.
- Preferred model: custom-custombc/gpt-5.4
- If tools are unavailable, explain the block instead of fabricating.

What can you do?刚刚"

```

# Test source

```ts
  64  |             filePath: '/tmp/reply-notes.md',
  65  |           },
  66  |         ],
  67  |       },
  68  |     ];
  69  | 
  70  |   await mkdir(sessionsDir, { recursive: true });
  71  |   await writeFile(
  72  |     join(sessionsDir, 'sessions.json'),
  73  |     JSON.stringify({
  74  |       sessions: [
  75  |         {
  76  |           key: SEEDED_SESSION_KEY,
  77  |           id: 'user-metadata-hidden-test',
  78  |           file: SEEDED_SESSION_FILE,
  79  |           label: SEEDED_SESSION_LABEL,
  80  |           updatedAt: Date.now(),
  81  |         },
  82  |       ],
  83  |     }, null, 2),
  84  |     'utf8',
  85  |   );
  86  |   await writeFile(
  87  |     join(sessionsDir, SEEDED_SESSION_FILE),
  88  |     `${seededMessages.map((message) => JSON.stringify(message)).join('\n')}\n`,
  89  |     'utf8',
  90  |   );
  91  | }
  92  | 
  93  | async function ensureGatewayConnected(page: Awaited<ReturnType<typeof getStableWindow>>): Promise<void> {
  94  |   const startResult = await page.evaluate(async () => (
  95  |     await window.electron.ipcRenderer.invoke('gateway:start')
  96  |   ) as { success?: boolean; error?: string });
  97  |   expect(startResult?.success, startResult?.error || 'gateway:start failed during E2E setup').toBe(true);
  98  | }
  99  | 
  100 | async function openSeededSession(page: Awaited<ReturnType<typeof getStableWindow>>, sessionKey: string): Promise<void> {
  101 |   const sessionRow = page.getByTestId(`sidebar-session-${sessionKey}`);
  102 |   if (await sessionRow.count() === 0) {
  103 |     await ensureGatewayConnected(page);
  104 |   }
  105 |   await expect(sessionRow).toBeVisible({ timeout: 60_000 });
  106 |   await sessionRow.click();
  107 | }
  108 | 
  109 | test.describe('Chat user message copy', () => {
  110 |   test('copies the user prompt from the message hover action', async ({ launchElectronApp }) => {
  111 |     const app = await launchElectronApp({ skipSetup: true });
  112 | 
  113 |     try {
  114 |       const page = await getStableWindow(app);
  115 |       const textarea = page.locator('textarea').first();
  116 |       const messageText = 'Please copy this user prompt';
  117 | 
  118 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 45_000 });
  119 |       await ensureGatewayConnected(page);
  120 |       await expect(textarea).toBeEnabled({ timeout: 45_000 });
  121 | 
  122 |       await app.evaluate(({ clipboard }) => {
  123 |         clipboard.clear();
  124 |       });
  125 | 
  126 |       await textarea.fill(messageText);
  127 |       await textarea.press('Enter');
  128 | 
  129 |       const messageBubble = page.getByText(messageText);
  130 |       await expect(messageBubble).toBeVisible();
  131 |       await messageBubble.hover();
  132 | 
  133 |       const copyButton = page.getByTestId('chat-message-copy-user');
  134 |       await expect(copyButton).toBeVisible();
  135 |       await copyButton.click();
  136 | 
  137 |       await expect.poll(async () => await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(messageText);
  138 |     } finally {
  139 |       await closeElectronApp(app);
  140 |     }
  141 |   });
  142 | 
  143 |   test('hides injected execution metadata from user bubbles and copy actions', async ({ homeDir, launchElectronApp }) => {
  144 |     await seedSession(homeDir);
  145 | 
  146 |     const app = await launchElectronApp({ skipSetup: true });
  147 | 
  148 |     try {
  149 |       const page = await getStableWindow(app);
  150 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 45_000 });
  151 |       await ensureGatewayConnected(page);
  152 | 
  153 |       await app.evaluate(({ clipboard }) => {
  154 |         clipboard.clear();
  155 |       });
  156 | 
  157 |       await openSeededSession(page, SEEDED_SESSION_KEY);
  158 | 
  159 |       const userBubble = page.getByTestId('chat-message-content-user').first();
  160 |       await expect(userBubble).toContainText(SEEDED_USER_PROMPT);
  161 |       await expect(userBubble).not.toContainText('Sender (untrusted metadata):');
  162 |       await expect(userBubble).not.toContainText('Gateway check: completed');
  163 |       await expect(userBubble).not.toContainText('openclaw doctor --non-interactive');
> 164 |       await expect(userBubble).not.toContainText('Execution playbook:');
      |                                    ^ Error: expect(locator).not.toContainText(expected) failed
  165 |       await expect(userBubble).not.toContainText('Conversation info (untrusted metadata):');
  166 |       await expect(page.getByTestId('chat-assistant-brand-name').last()).toHaveText('Deep AI Worker');
  167 | 
  168 |       const assistantAvatar = page.getByTestId('chat-assistant-avatar').last();
  169 |       const assistantContent = page.getByTestId('chat-message-content-assistant').last();
  170 |       const [assistantAvatarBox, assistantContentBox] = await Promise.all([
  171 |         assistantAvatar.boundingBox(),
  172 |         assistantContent.boundingBox(),
  173 |       ]);
  174 | 
  175 |       expect(assistantAvatarBox).not.toBeNull();
  176 |       expect(assistantContentBox).not.toBeNull();
  177 | 
  178 |       if (assistantAvatarBox && assistantContentBox) {
  179 |         expect(Math.abs(assistantContentBox.x - assistantAvatarBox.x)).toBeLessThan(2);
  180 |       }
  181 | 
  182 |       await userBubble.hover();
  183 |       await page.getByTestId('chat-message-copy-user').click();
  184 | 
  185 |       await expect.poll(async () => await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(SEEDED_USER_PROMPT);
  186 |     } finally {
  187 |       await closeElectronApp(app);
  188 |     }
  189 |   });
  190 | 
  191 |   test('keeps user file cards right-aligned and assistant file cards left-aligned', async ({ homeDir, launchElectronApp }) => {
  192 |     await seedSession(homeDir);
  193 | 
  194 |     const app = await launchElectronApp({ skipSetup: true });
  195 | 
  196 |     try {
  197 |       const page = await getStableWindow(app);
  198 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 45_000 });
  199 |       await ensureGatewayConnected(page);
  200 |       await openSeededSession(page, SEEDED_SESSION_KEY);
  201 | 
  202 |       const userContent = page.getByTestId('chat-message-content-user').first();
  203 |       const assistantContent = page.getByTestId('chat-message-content-assistant').last();
  204 |       const userAttachments = page.getByTestId('chat-user-attachments').first();
  205 |       const assistantAttachments = page.getByTestId('chat-assistant-attachments').first();
  206 |       const userFileCard = userAttachments.getByTestId('chat-file-card').last();
  207 |       const assistantFileCard = assistantAttachments.getByTestId('chat-file-card').first();
  208 | 
  209 |       await expect(userAttachments).toBeVisible();
  210 |       await expect(assistantAttachments).toBeVisible();
  211 | 
  212 |       const [userContentBox, assistantContentBox, userCardBox, assistantCardBox] = await Promise.all([
  213 |         userContent.boundingBox(),
  214 |         assistantContent.boundingBox(),
  215 |         userFileCard.boundingBox(),
  216 |         assistantFileCard.boundingBox(),
  217 |       ]);
  218 | 
  219 |       expect(userContentBox).not.toBeNull();
  220 |       expect(assistantContentBox).not.toBeNull();
  221 |       expect(userCardBox).not.toBeNull();
  222 |       expect(assistantCardBox).not.toBeNull();
  223 | 
  224 |       if (userContentBox && assistantContentBox && userCardBox && assistantCardBox) {
  225 |         expect(Math.abs(
  226 |           (userCardBox.x + userCardBox.width) - (userContentBox.x + userContentBox.width),
  227 |         )).toBeLessThan(2);
  228 |         expect(Math.abs(assistantCardBox.x - assistantContentBox.x)).toBeLessThan(2);
  229 |       }
  230 |     } finally {
  231 |       await closeElectronApp(app);
  232 |     }
  233 |   });
  234 | 
  235 |   test('keeps seeded chat content aligned with the composer and leaves breathing room above it', async ({ homeDir, launchElectronApp }) => {
  236 |     await seedSession(homeDir);
  237 | 
  238 |     const app = await launchElectronApp({ skipSetup: true });
  239 | 
  240 |     try {
  241 |       const page = await getStableWindow(app);
  242 |       await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 45_000 });
  243 |       await ensureGatewayConnected(page);
  244 |       await openSeededSession(page, SEEDED_SESSION_KEY);
  245 | 
  246 |       const composer = page.getByTestId('chat-composer');
  247 |       const userContent = page.getByTestId('chat-message-content-user').first();
  248 |       const assistantContent = page.getByTestId('chat-message-content-assistant').last();
  249 | 
  250 |       await expect(composer).toBeVisible();
  251 |       await expect(userContent).toContainText(SEEDED_USER_PROMPT);
  252 |       await expect(assistantContent).toContainText('I can help analyze files, extract requirements, and turn them into a reusable skill.');
  253 |       await userContent.scrollIntoViewIfNeeded();
  254 |       await assistantContent.scrollIntoViewIfNeeded();
  255 | 
  256 |       const [composerBox, userContentBox, assistantContentBox] = await Promise.all([
  257 |         composer.boundingBox(),
  258 |         userContent.boundingBox(),
  259 |         assistantContent.boundingBox(),
  260 |       ]);
  261 | 
  262 |       expect(composerBox).not.toBeNull();
  263 |       expect(userContentBox).not.toBeNull();
  264 |       expect(assistantContentBox).not.toBeNull();
```