import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  retryElectronAppOperation,
  test,
} from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const SESSION_ID = 'process-step-complete-without-refresh';
const RUN_ID = 'run-process-step-complete-without-refresh';
const PROMPT = 'Update the draft script and keep working without stopping.';
const TOOL_PATH = 'D:/AI/Deep AI Worker/ClawX/tmp-process-step.py';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Chat process step completion', () => {
  test('updates a streamed process card to completed without a manual refresh', async ({ launchElectronApp }) => {
    test.setTimeout(180_000);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                state: 'running',
                port: 18789,
                pid: 12345,
                connectedAt: Date.now(),
              },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [],
              },
            },
          },
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                language: 'en',
                chatProcessDisplayMode: 'all',
                assistantMessageStyle: 'bubble',
                hideInternalRoutineProcesses: true,
                setupComplete: true,
              },
            },
          },
        },
      });

      await retryElectronAppOperation(app, async () => await app.evaluate(({ ipcMain, BrowserWindow }, { prompt, runId, sessionId, sessionKey, toolPath }) => {
        let sessions: Array<{ key: string; id: string; label: string; updatedAt: number }> = [];
        let historyMessages: Array<Record<string, unknown>> = [];

        function emitNotification(payload: unknown): void {
          const window = BrowserWindow.getAllWindows().at(-1);
          if (!window) throw new Error('No BrowserWindow available');
          window.webContents.send('gateway:notification', payload);
        }

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event, method: string, params?: { sessionKey?: string }) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: { sessions },
            };
          }

          if (method === 'chat.history') {
            return {
              success: true,
              result: { messages: historyMessages },
            };
          }

          if (method === 'chat.abort') {
            return {
              success: true,
              result: { ok: true },
            };
          }

          if (method === 'chat.send') {
            const now = Date.now();
            const activeSessionKey = params?.sessionKey || sessionKey;

            sessions = [{
              key: activeSessionKey,
              id: sessionId,
              label: prompt,
              updatedAt: now,
            }];

            historyMessages = [{
              id: 'user-process-step-1',
              role: 'user',
              content: prompt,
              timestamp: Math.floor(now / 1000),
            }];

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  phase: 'started',
                  runId,
                  sessionKey: activeSessionKey,
                },
              });
            }, 0);

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  runId,
                  sessionKey: activeSessionKey,
                  state: 'delta',
                  message: {
                    role: 'assistant',
                    content: [
                      {
                        type: 'tool_use',
                        id: 'write-process-1',
                        name: 'write',
                        input: {
                          path: toolPath,
                          content: 'print("draft")',
                        },
                      },
                    ],
                    timestamp: Math.floor(Date.now() / 1000),
                  },
                },
              });
            }, 600);

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  runId,
                  sessionKey: activeSessionKey,
                  state: 'delta',
                  message: {
                    role: 'assistant',
                    content: [
                      {
                        type: 'tool_use',
                        id: 'write-process-1',
                        name: 'write',
                        input: {
                          path: toolPath,
                          content: 'print("draft")',
                        },
                      },
                      {
                        type: 'tool_result',
                        id: 'write-process-1',
                        name: 'write',
                        content: `Successfully wrote 149 bytes to ${toolPath}`,
                      },
                    ],
                    timestamp: Math.floor(Date.now() / 1000),
                  },
                },
              });
            }, 1_800);

            return {
              success: true,
              result: { runId },
            };
          }

          return {};
        });
      }, {
        prompt: PROMPT,
        runId: RUN_ID,
        sessionId: SESSION_ID,
        sessionKey: SESSION_KEY,
        toolPath: TOOL_PATH,
      }));

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const composer = page.getByTestId('chat-composer');
      const messageInput = composer.getByRole('textbox');
      const sendButton = composer.getByTestId('chat-send-button');

      await messageInput.fill(PROMPT);
      await sendButton.click();

      await expect.poll(async () => {
        return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
      }, { timeout: 30_000 }).toBe(true);

      const processSummaries = page.getByTestId('chat-process-event-summary');
      await expect(processSummaries.first()).toHaveText('Editing code', { timeout: 30_000 });
      await expect.poll(async () => await processSummaries.allTextContents(), { timeout: 30_000 }).toEqual([
        'Code edit completed',
        'Code edit completed',
      ]);
      const completedSummary = page.getByTestId('chat-process-event-summary').first();
      const completedPreview = page.getByTestId('chat-process-event-preview').first();
      await expect(completedPreview).toBeVisible();
      await expect(completedSummary).toHaveCSS('font-size', '13px');
      await expect(completedPreview).toHaveCSS('font-size', '13px');
      const processActivity = page.getByTestId('chat-process-activity-label');
      await expect(processActivity).toBeVisible();
      await expect(processActivity).toHaveCSS('font-size', '13px');
      await expect(page.getByTestId('chat-process-activity-copy')).toHaveCSS('padding-left', '6px');
      await expect(page.getByTestId('chat-process-activity-label-scan')).toHaveCSS(
        'animation-name',
        'chat-process-activity-label-scan',
      );
      const activityScanBackground = await page.getByTestId('chat-process-activity-label-scan').evaluate((node) => {
        return getComputedStyle(node).backgroundImage;
      });
      expect(activityScanBackground).toMatch(/rgba?\(255,\s*255,\s*255/);
      expect(activityScanBackground).not.toMatch(/rgba?\(79,\s*141,\s*247/);

      await expect.poll(async () => {
        return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
      }, { timeout: 5_000 }).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('updates a streamed process card to completed when tool_result arrives as a direct delta message', async ({ launchElectronApp }) => {
    test.setTimeout(180_000);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                state: 'running',
                port: 18789,
                pid: 12345,
                connectedAt: Date.now(),
              },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [],
              },
            },
          },
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                language: 'en',
                chatProcessDisplayMode: 'all',
                assistantMessageStyle: 'bubble',
                hideInternalRoutineProcesses: true,
                setupComplete: true,
              },
            },
          },
        },
      });

      await retryElectronAppOperation(app, async () => await app.evaluate(({ ipcMain, BrowserWindow }, { prompt, runId, sessionId, sessionKey, toolPath }) => {
        let sessions: Array<{ key: string; id: string; label: string; updatedAt: number }> = [];
        let historyMessages: Array<Record<string, unknown>> = [];

        function emitNotification(payload: unknown): void {
          const window = BrowserWindow.getAllWindows().at(-1);
          if (!window) throw new Error('No BrowserWindow available');
          window.webContents.send('gateway:notification', payload);
        }

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event, method: string, params?: { sessionKey?: string }) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: { sessions },
            };
          }

          if (method === 'chat.history') {
            return {
              success: true,
              result: { messages: historyMessages },
            };
          }

          if (method === 'chat.abort') {
            return {
              success: true,
              result: { ok: true },
            };
          }

          if (method === 'chat.send') {
            const now = Date.now();
            const activeSessionKey = params?.sessionKey || sessionKey;

            sessions = [{
              key: activeSessionKey,
              id: sessionId,
              label: prompt,
              updatedAt: now,
            }];

            historyMessages = [{
              id: 'user-process-step-direct-result-1',
              role: 'user',
              content: prompt,
              timestamp: Math.floor(now / 1000),
            }];

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  phase: 'started',
                  runId,
                  sessionKey: activeSessionKey,
                },
              });
            }, 0);

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  runId,
                  sessionKey: activeSessionKey,
                  state: 'delta',
                  message: {
                    role: 'assistant',
                    content: [
                      {
                        type: 'tool_use',
                        id: 'write-process-direct-1',
                        name: 'write',
                        input: {
                          path: toolPath,
                          content: 'print("draft")',
                        },
                      },
                    ],
                    timestamp: Math.floor(Date.now() / 1000),
                  },
                },
              });
            }, 2_000);

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  runId,
                  sessionKey: activeSessionKey,
                  state: 'delta',
                  message: {
                    role: 'tool_result',
                    toolCallId: 'write-process-direct-1',
                    toolName: 'write',
                    content: `Successfully wrote 149 bytes to ${toolPath}`,
                    timestamp: Math.floor(Date.now() / 1000),
                  },
                },
              });
            }, 3_200);

            return {
              success: true,
              result: { runId },
            };
          }

          return {};
        });
      }, {
        prompt: PROMPT,
        runId: `${RUN_ID}-direct-tool-result`,
        sessionId: `${SESSION_ID}-direct-tool-result`,
        sessionKey: SESSION_KEY,
        toolPath: TOOL_PATH,
      }));

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const composer = page.getByTestId('chat-composer');
      const messageInput = composer.getByRole('textbox');
      const sendButton = composer.getByTestId('chat-send-button');

      await messageInput.fill(PROMPT);
      await sendButton.click();

      const productScan = page.getByTestId('chat-typing-indicator-scan');
      await expect(productScan).toBeVisible({ timeout: 5_000 });
      await expect(productScan).toHaveCSS('animation-name', 'chat-product-scan');
      await expect(productScan).toHaveCSS('background-image', /linear-gradient/);
      const productScanBackground = await productScan.evaluate((node) => {
        return getComputedStyle(node).backgroundImage;
      });
      expect(productScanBackground).toMatch(/rgba?\(255,\s*255,\s*255/);
      expect(productScanBackground).not.toMatch(/rgba?\(79,\s*141,\s*247/);

      await expect.poll(async () => {
        return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
      }, { timeout: 30_000 }).toBe(true);

      const processSummaries = page.getByTestId('chat-process-event-summary');
      await expect(processSummaries.first()).toHaveText('Editing code', { timeout: 30_000 });
      await expect.poll(async () => await processSummaries.allTextContents(), { timeout: 30_000 }).toEqual([
        'Code edit completed',
      ]);

      await expect.poll(async () => {
        return await sendButton.evaluate((node) => !!node.querySelector('svg.lucide-square'));
      }, { timeout: 5_000 }).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps completed process rows above trailing live notes when tool status is tracked separately', async ({ launchElectronApp }) => {
    test.setTimeout(180_000);

    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                state: 'running',
                port: 18789,
                pid: 12345,
                connectedAt: Date.now(),
              },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [],
              },
            },
          },
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                language: 'en',
                chatProcessDisplayMode: 'all',
                assistantMessageStyle: 'bubble',
                hideInternalRoutineProcesses: true,
                setupComplete: true,
              },
            },
          },
        },
      });

      await retryElectronAppOperation(app, async () => await app.evaluate(({ ipcMain, BrowserWindow }, { prompt, runId, sessionId, sessionKey }) => {
        let sessions: Array<{ key: string; id: string; label: string; updatedAt: number }> = [];
        let historyMessages: Array<Record<string, unknown>> = [];

        function emitNotification(payload: unknown): void {
          const window = BrowserWindow.getAllWindows().at(-1);
          if (!window) throw new Error('No BrowserWindow available');
          window.webContents.send('gateway:notification', payload);
        }

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event, method: string, params?: { sessionKey?: string }) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: { sessions },
            };
          }

          if (method === 'chat.history') {
            return {
              success: true,
              result: { messages: historyMessages },
            };
          }

          if (method === 'chat.abort') {
            return {
              success: true,
              result: { ok: true },
            };
          }

          if (method === 'chat.send') {
            const now = Date.now();
            const activeSessionKey = params?.sessionKey || sessionKey;

            sessions = [{
              key: activeSessionKey,
              id: sessionId,
              label: prompt,
              updatedAt: now,
            }];

            historyMessages = [{
              id: 'user-process-order-1',
              role: 'user',
              content: prompt,
              timestamp: Math.floor(now / 1000),
            }];

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  phase: 'started',
                  runId,
                  sessionKey: activeSessionKey,
                },
              });
            }, 0);

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  runId,
                  sessionKey: activeSessionKey,
                  state: 'delta',
                  message: {
                    role: 'assistant',
                    content: [
                      {
                        type: 'text',
                        text: 'The browser request hit a restriction.',
                      },
                    ],
                    timestamp: Math.floor(Date.now() / 1000),
                  },
                },
              });
            }, 600);

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  runId,
                  sessionKey: activeSessionKey,
                  state: 'delta',
                  message: {
                    role: 'assistant',
                    content: [
                      {
                        type: 'tool_use',
                        id: 'browser-order-live-1',
                        name: 'browser',
                        input: {
                          action: 'open',
                          url: 'https://flights.ctrip.com/',
                        },
                      },
                    ],
                    timestamp: Math.floor(Date.now() / 1000),
                  },
                },
              });
            }, 1_400);

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  runId,
                  sessionKey: activeSessionKey,
                  state: 'delta',
                  message: {
                    role: 'tool_result',
                    toolCallId: 'browser-order-live-1',
                    toolName: 'browser',
                    content: 'Blocked by site policy',
                    timestamp: Math.floor(Date.now() / 1000),
                  },
                },
              });
            }, 2_000);

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  runId,
                  sessionKey: activeSessionKey,
                  state: 'delta',
                  message: {
                    role: 'assistant',
                    content: [
                      {
                        type: 'text',
                        text: 'The browser was blocked, so I am switching to search results now.',
                      },
                    ],
                    timestamp: Math.floor(Date.now() / 1000),
                  },
                },
              });
            }, 2_600);

            return {
              success: true,
              result: { runId },
            };
          }

          return {};
        });
      }, {
        prompt: 'Check tomorrow Shenzhen to Beijing flights.',
        runId: `${RUN_ID}-event-order`,
        sessionId: `${SESSION_ID}-event-order`,
        sessionKey: SESSION_KEY,
      }));

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const composer = page.getByTestId('chat-composer');
      const messageInput = composer.getByRole('textbox');
      const sendButton = composer.getByTestId('chat-send-button');

      await messageInput.fill('Check tomorrow Shenzhen to Beijing flights.');
      await sendButton.click();

      await expect.poll(async () => {
        return await page.getByTestId('chat-process-content').evaluate((container) => {
          const summary = container.querySelector('[data-testid="chat-process-event-summary"]');
          const directNote = container.querySelector('[data-testid="chat-process-note-content"]');
          if (!summary || !directNote) {
            return false;
          }
          if (!directNote.textContent?.includes('The browser was blocked, so I am switching to search results now.')) {
            return false;
          }
          return (summary.compareDocumentPosition(directNote) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        });
      }, { timeout: 30_000 }).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('places late process deltas above an already rendered final reply', async ({ launchElectronApp }) => {
    test.setTimeout(180_000);

    const app = await launchElectronApp({ skipSetup: true });
    const prompt = 'Fix the workbook formula placement.';
    const processNote = 'I found the formula issue before writing the final answer.';
    const finalReply = 'The corrected workbook is ready.';

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                state: 'running',
                port: 18789,
                pid: 12345,
                connectedAt: Date.now(),
              },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [],
              },
            },
          },
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                language: 'en',
                chatProcessDisplayMode: 'all',
                assistantMessageStyle: 'bubble',
                hideInternalRoutineProcesses: true,
                setupComplete: true,
              },
            },
          },
        },
      });

      await retryElectronAppOperation(app, async () => await app.evaluate(({ ipcMain, BrowserWindow }, { finalReply, processNote, prompt, runId, sessionId, sessionKey }) => {
        let sessions: Array<{ key: string; id: string; label: string; updatedAt: number }> = [];
        let historyMessages: Array<Record<string, unknown>> = [];

        function emitNotification(payload: unknown): void {
          const window = BrowserWindow.getAllWindows().at(-1);
          if (!window) throw new Error('No BrowserWindow available');
          window.webContents.send('gateway:notification', payload);
        }

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event, method: string, params?: { sessionKey?: string }) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: { sessions },
            };
          }

          if (method === 'chat.history') {
            return {
              success: true,
              result: { messages: historyMessages },
            };
          }

          if (method === 'chat.abort') {
            return {
              success: true,
              result: { ok: true },
            };
          }

          if (method === 'chat.send') {
            const now = Math.floor(Date.now() / 1000);
            const activeSessionKey = params?.sessionKey || sessionKey;
            const userMessage = {
              id: 'user-late-process-1',
              role: 'user',
              content: prompt,
              timestamp: now,
            };
            const processMessage = {
              id: 'assistant-late-process-1',
              role: 'assistant',
              content: [
                { type: 'text', text: processNote },
                {
                  type: 'toolCall',
                  id: 'late-process-tool-1',
                  name: 'exec',
                  input: { command: 'inspect workbook formulas' },
                },
              ],
              timestamp: now + 5,
              stopReason: 'toolUse',
            };
            const finalMessage = {
              id: 'assistant-late-final-1',
              role: 'assistant',
              content: finalReply,
              timestamp: now + 10,
              stopReason: 'stop',
            };

            sessions = [{
              key: activeSessionKey,
              id: sessionId,
              label: prompt,
              updatedAt: Date.now(),
            }];
            historyMessages = [userMessage];

            setTimeout(() => {
              emitNotification({
                method: 'agent',
                params: {
                  phase: 'started',
                  runId,
                  sessionKey: activeSessionKey,
                },
              });
            }, 0);

            setTimeout(() => {
              historyMessages = [userMessage, finalMessage];
              emitNotification({
                method: 'agent',
                params: {
                  runId,
                  sessionKey: activeSessionKey,
                  state: 'final',
                  message: finalMessage,
                },
              });
            }, 500);

            setTimeout(() => {
              historyMessages = [userMessage, processMessage, finalMessage];
              emitNotification({
                method: 'agent',
                params: {
                  runId,
                  sessionKey: activeSessionKey,
                  state: 'delta',
                  message: processMessage,
                },
              });
            }, 1_100);

            return {
              success: true,
              result: { runId },
            };
          }

          return {};
        });
      }, {
        finalReply,
        processNote,
        prompt,
        runId: `${RUN_ID}-late-process-after-final`,
        sessionId: `${SESSION_ID}-late-process-after-final`,
        sessionKey: SESSION_KEY,
      }));

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const composer = page.getByTestId('chat-composer');
      await composer.getByRole('textbox').fill(prompt);
      await composer.getByTestId('chat-send-button').click();

      await expect(page.getByText(finalReply)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-process-toggle').first()).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat-process-toggle').first().click();
      await expect(page.getByText(processNote)).toBeVisible({ timeout: 30_000 });

      await expect.poll(async () => await page.evaluate(({ finalReplyText, processNoteText }) => {
        const messageNodes = Array.from(document.querySelectorAll([
          '[data-testid="chat-process-note-content"]',
          '[data-testid="chat-assistant-message-bubble"]',
        ].join(',')));
        const processNode = messageNodes
          .find((node) => node.textContent?.includes(processNoteText));
        const finalNode = messageNodes
          .find((node) => node.textContent?.includes(finalReplyText));
        if (!processNode || !finalNode) return false;
        return (processNode.compareDocumentPosition(finalNode) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      }, {
        finalReplyText: finalReply,
        processNoteText: processNote,
      }), { timeout: 30_000 }).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

});
