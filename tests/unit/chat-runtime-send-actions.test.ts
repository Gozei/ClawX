import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpcMock = vi.fn();
const buildAgentExecutionMetadataMock = vi.fn(() => null);
const appendAssistantMessage = vi.fn((messages, message) => [...messages, message]);
const clearErrorRecoveryTimer = vi.fn();
const clearHistoryPoll = vi.fn();
const createLocalAssistantMessage = vi.fn((content: string, options?: { isError?: boolean; idPrefix?: string }) => ({
  id: `${options?.idPrefix || 'local-message'}-1`,
  role: 'assistant',
  content,
  timestamp: 1,
  isError: options?.isError === true,
}));
const getLastChatEventAt = vi.fn(() => 0);
const getNoResponseError = vi.fn(() => 'Localized no response');
const getSendFailedError = vi.fn((error?: string) => error ? `Localized send failed: ${error}` : 'Localized send failed');
const hasNonToolAssistantContent = vi.fn((message: { content?: unknown } | undefined) => (
  !!message && typeof message.content === 'string' && message.content.trim().length > 0
));
const isToolResultRole = vi.fn((role: unknown) => role === 'toolresult' || role === 'tool_result');
const setHistoryPollTimer = vi.fn();
const setLastChatEventAt = vi.fn();
const upsertImageCacheEntry = vi.fn();

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/lib/agent-execution-context', () => ({
  buildAgentExecutionMetadata: (...args: unknown[]) => buildAgentExecutionMetadataMock(...args),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: {
    getState: () => ({
      agents: [],
    }),
  },
}));

vi.mock('@/stores/chat/helpers', () => ({
  appendAssistantMessage: (...args: unknown[]) => appendAssistantMessage(...args),
  clearErrorRecoveryTimer: (...args: unknown[]) => clearErrorRecoveryTimer(...args),
  clearHistoryPoll: (...args: unknown[]) => clearHistoryPoll(...args),
  createLocalAssistantMessage: (...args: unknown[]) => createLocalAssistantMessage(...args),
  getLastChatEventAt: (...args: unknown[]) => getLastChatEventAt(...args),
  getNoResponseError: (...args: unknown[]) => getNoResponseError(...args),
  getSendFailedError: (...args: unknown[]) => getSendFailedError(...args),
  hasNonToolAssistantContent: (...args: unknown[]) => hasNonToolAssistantContent(...args),
  isToolResultRole: (...args: unknown[]) => isToolResultRole(...args),
  setHistoryPollTimer: (...args: unknown[]) => setHistoryPollTimer(...args),
  setLastChatEventAt: (...args: unknown[]) => setLastChatEventAt(...args),
  upsertImageCacheEntry: (...args: unknown[]) => upsertImageCacheEntry(...args),
}));

type ChatLikeState = {
  currentSessionKey: string;
  currentAgentId: string;
  sessions: Array<{ key: string; label?: string }>;
  messages: Array<Record<string, unknown>>;
  sessionLabels: Record<string, string>;
  sessionLastActivity: Record<string, number>;
  sending: boolean;
  activeRunId: string | null;
  streamingText: string;
  streamingMessage: unknown | null;
  streamingTools: unknown[];
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  pendingToolImages: unknown[];
  error: string | null;
  loadHistory: ReturnType<typeof vi.fn>;
};

function makeHarness(initial?: Partial<ChatLikeState>) {
  let state: ChatLikeState = {
    currentSessionKey: 'agent:main:main',
    currentAgentId: 'main',
    sessions: [{ key: 'agent:main:main' }],
    messages: [],
    sessionLabels: {},
    sessionLastActivity: {},
    sending: false,
    activeRunId: null,
    streamingText: '',
    streamingMessage: null,
    streamingTools: [],
    pendingFinal: false,
    lastUserMessageAt: null,
    pendingToolImages: [],
    error: null,
    loadHistory: vi.fn(async () => undefined),
    ...initial,
  };

  const set = (partial: Partial<ChatLikeState> | ((s: ChatLikeState) => Partial<ChatLikeState>)) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  return { set, get, read: () => state };
}

describe('chat runtime send actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T19:00:00Z'));
    getLastChatEventAt.mockReturnValue(Date.now() - 20_000);
    invokeIpcMock.mockImplementation(async (channel: string, method?: string) => {
      if (channel === 'gateway:rpc' && method === 'chat.send') {
        return new Promise(() => undefined);
      }
      if (channel === 'gateway:rpc' && method === 'chat.abort') {
        return { success: true };
      }
      if (channel === 'gateway:rpc' && method === 'chat.history') {
        return { success: true, result: { messages: [] } };
      }
      throw new Error(`Unexpected invokeIpc call: ${channel} ${String(method)}`);
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('finalizes a stale streaming assistant reply so sending unlocks again', async () => {
    const { createRuntimeSendActions } = await import('@/stores/chat/runtime-send-actions');
    const h = makeHarness();
    const actions = createRuntimeSendActions(h.set as never, h.get as never);

    void actions.sendMessage('hello');

    h.set({
      sending: true,
      streamingMessage: {
        id: 'stream-1',
        role: 'assistant',
        content: '记下来了，后面我会按这个风格来。',
        timestamp: Math.floor(Date.now() / 1000),
      },
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.resolve();

    expect(h.read().sending).toBe(false);
    expect(h.read().activeRunId).toBeNull();
    expect(h.read().pendingFinal).toBe(false);
    expect(h.read().streamingMessage).toBeNull();
    expect(h.read().messages.some((message) => message.id === 'stream-1')).toBe(true);
  });

  it('converts a safety-timeout send failure into an assistant error reply', async () => {
    const { createRuntimeSendActions } = await import('@/stores/chat/runtime-send-actions');
    const h = makeHarness();
    const actions = createRuntimeSendActions(h.set as never, h.get as never);

    void actions.sendMessage('hello');

    await vi.advanceTimersByTimeAsync(90_000);
    await Promise.resolve();

    const next = h.read();
    expect(next.error).toBeNull();
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Localized no response',
      isError: true,
    });
  });
});
