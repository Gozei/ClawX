# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-user-copy.spec.ts >> Chat user message copy >> keeps seeded chat content aligned with the composer and leaves breathing room above it
- Location: tests\e2e\chat-user-copy.spec.ts:235:7

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('chat-message-content-assistant').last()
Expected substring: "I can help analyze files, extract requirements, and turn them into a reusable skill."
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 15000ms
  - waiting for getByTestId('chat-message-content-assistant').last()

```

# Test source

```ts
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
  164 |       await expect(userBubble).not.toContainText('Execution playbook:');
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
> 252 |       await expect(assistantContent).toContainText('I can help analyze files, extract requirements, and turn them into a reusable skill.');
      |                                      ^ Error: expect(locator).toContainText(expected) failed
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
  265 | 
  266 |       if (composerBox && userContentBox && assistantContentBox) {
  267 |         expect(Math.abs(assistantContentBox.x - composerBox.x)).toBeLessThan(2);
  268 |         expect(Math.abs(
  269 |           (userContentBox.x + userContentBox.width) - (composerBox.x + composerBox.width),
  270 |         )).toBeLessThan(2);
  271 |         expect(composerBox.y - (assistantContentBox.y + assistantContentBox.height)).toBeGreaterThan(24);
  272 |       }
  273 |     } finally {
  274 |       await closeElectronApp(app);
  275 |     }
  276 |   });
  277 | });
  278 | 
```