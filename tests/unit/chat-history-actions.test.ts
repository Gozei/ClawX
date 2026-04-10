import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpcMock = vi.fn();
const hostApiFetchMock = vi.fn();
const clearHistoryPoll = vi.fn();
const createToolResultProcessMessage = vi.fn((message: unknown) => message);
const EMPTY_ASSISTANT_RESPONSE_ERROR = 'The selected provider returned an empty response. Check the provider base URL, API protocol, model, and API key.';
const enrichWithCachedImages = vi.fn((messages) => messages);
const enrichWithToolResultFiles = vi.fn((messages) => messages);
const getMessageText = vi.fn((content: unknown) => typeof content === 'string' ? content : '');
const hasNonToolAssistantContent = vi.fn((message: { content?: unknown; _attachedFiles?: unknown[] } | undefined) => {
  if (!message) return false;
  if (Array.isArray(message._attachedFiles) && message._attachedFiles.length > 0) return true;
  if (typeof message.content === 'string') return message.content.trim().length > 0;
  if (Array.isArray(message.content)) return message.content.length > 0;
  return Boolean(message.content);
});
const isEmptyAssistantResponse = vi.fn((message: { role?: string; content?: unknown; _attachedFiles?: unknown[] } | undefined) => {
  if (!message || message.role !== 'assistant') return false;
  const hasFiles = Array.isArray(message._attachedFiles) && message._attachedFiles.length > 0;
  if (hasFiles) return false;
  return typeof message.content === 'string'
    ? message.content.trim().length === 0
    : Array.isArray(message.content) && message.content.length === 0;
});
const isToolResultRole = vi.fn((role: unknown) => role === 'toolresult' || role === 'tool_result');
const isInternalMessage = vi.fn((msg: { role?: unknown; content?: unknown }) => {
  if (msg.role === 'system') return true;
  if (msg.role === 'assistant') {
    const text = typeof msg.content === 'string' ? msg.content : '';
    if (/^(HEARTBEAT_OK|NO_REPLY)\s*$/.test(text)) return true;
  }
  return false;
});
const loadMissingPreviews = vi.fn(async () => false);
const toMs = vi.fn((ts: number) => ts < 1e12 ? ts * 1000 : ts);

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/stores/chat/helpers', () => ({
  clearHistoryPoll: (...args: unknown[]) => clearHistoryPoll(...args),
  createToolResultProcessMessage: (...args: unknown[]) => createToolResultProcessMessage(...args),
  EMPTY_ASSISTANT_RESPONSE_ERROR,
  enrichWithCachedImages: (...args: unknown[]) => enrichWithCachedImages(...args),
  enrichWithToolResultFiles: (...args: unknown[]) => enrichWithToolResultFiles(...args),
  getMessageText: (...args: unknown[]) => getMessageText(...args),
  hasNonToolAssistantContent: (...args: unknown[]) => hasNonToolAssistantContent(...args),
  isEmptyAssistantResponse: (...args: unknown[]) => isEmptyAssistantResponse(...args),
  isInternalMessage: (...args: unknown[]) => isInternalMessage(...args),
  isToolResultRole: (...args: unknown[]) => isToolResultRole(...args),
  loadMissingPreviews: (...args: unknown[]) => loadMissingPreviews(...args),
  toMs: (...args: unknown[]) => toMs(...args as Parameters<typeof toMs>),
}));

type ChatLikeState = {
  currentSessionKey: string;
  messages: Array<{ role: string; timestamp?: number; content?: unknown; _attachedFiles?: unknown[] }>;
  loading: boolean;
  error: string | null;
  sending: boolean;
  streamingText: string;
  streamingMessage: unknown | null;
  streamingTools: unknown[];
  lastUserMessageAt: number | null;
  pendingFinal: boolean;
  pendingToolImages: unknown[];
  sessionLabels: Record<string, string>;
  sessionLastActivity: Record<string, number>;
  thinkingLevel: string | null;
  activeRunId: string | null;
};

function makeHarness(initial?: Partial<ChatLikeState>) {
  let state: ChatLikeState = {
    currentSessionKey: 'agent:main:main',
    messages: [],
    loading: false,
    error: null,
    sending: false,
    streamingText: '',
    streamingMessage: null,
    streamingTools: [],
    lastUserMessageAt: null,
    pendingFinal: false,
    pendingToolImages: [],
    sessionLabels: {},
    sessionLastActivity: {},
    thinkingLevel: null,
    activeRunId: null,
    ...initial,
  };

  const set = (partial: Partial<ChatLikeState> | ((s: ChatLikeState) => Partial<ChatLikeState>)) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  return { set, get, read: () => state };
}

describe('chat history actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createToolResultProcessMessage.mockImplementation((message: unknown) => message);
    invokeIpcMock.mockResolvedValue({ success: true, result: { messages: [] } });
    hostApiFetchMock.mockResolvedValue({ messages: [] });
  });

  it('uses cron session fallback when gateway history is empty', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:cron:job-1',
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    hostApiFetchMock.mockResolvedValueOnce({
      messages: [
        {
          id: 'cron-meta-job-1',
          role: 'system',
          content: 'Scheduled task: Drink water',
          timestamp: 1773281731495,
        },
        {
          id: 'cron-run-1',
          role: 'assistant',
          content: 'Drink water 💧',
          timestamp: 1773281732751,
        },
      ],
    });

    await actions.loadHistory();

    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/api/cron/session-history?sessionKey=agent%3Amain%3Acron%3Ajob-1&limit=200',
    );
    expect(h.read().messages.map((message) => message.content)).toEqual([
      'Drink water 💧',
    ]);
    expect(h.read().sessionLastActivity['agent:main:cron:job-1']).toBe(1773281732751);
    expect(h.read().loading).toBe(false);
  });

  it('does not use cron fallback for normal sessions', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    await actions.loadHistory();

    expect(hostApiFetchMock).not.toHaveBeenCalled();
    expect(h.read().messages).toEqual([]);
    expect(h.read().loading).toBe(false);
  });

  it('preserves existing messages when history refresh fails for the current session', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      messages: [
        {
          role: 'assistant',
          content: 'still here',
          timestamp: 1773281732,
        },
      ],
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockRejectedValueOnce(new Error('Gateway unavailable'));

    await actions.loadHistory();

    expect(h.read().messages.map((message) => message.content)).toEqual(['still here']);
    expect(h.read().error).toBe('Error: Gateway unavailable');
    expect(h.read().loading).toBe(false);
  });

  it('filters out system messages from loaded history', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness();
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          { role: 'user', content: 'Hello', timestamp: 1000 },
          { role: 'system', content: 'Gateway restarted', timestamp: 1001 },
          { role: 'assistant', content: 'Hi there!', timestamp: 1002 },
        ],
      },
    });

    await actions.loadHistory();

    expect(h.read().messages.map((m) => m.content)).toEqual([
      'Hello',
      'Hi there!',
    ]);
  });

  it('filters out HEARTBEAT_OK assistant messages', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness();
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          { role: 'user', content: 'Hello', timestamp: 1000 },
          { role: 'assistant', content: 'HEARTBEAT_OK', timestamp: 1001 },
          { role: 'assistant', content: 'Real response', timestamp: 1002 },
        ],
      },
    });

    await actions.loadHistory();

    expect(h.read().messages.map((m) => m.content)).toEqual([
      'Hello',
      'Real response',
    ]);
  });

  it('filters out NO_REPLY assistant messages', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness();
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          { role: 'user', content: 'Hello', timestamp: 1000 },
          { role: 'assistant', content: 'NO_REPLY', timestamp: 1001 },
          { role: 'assistant', content: 'Actual answer', timestamp: 1002 },
        ],
      },
    });

    await actions.loadHistory();

    expect(h.read().messages.map((m) => m.content)).toEqual([
      'Hello',
      'Actual answer',
    ]);
  });

  it('keeps normal assistant messages that contain HEARTBEAT_OK as substring', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness();
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          { role: 'user', content: 'What is HEARTBEAT_OK?', timestamp: 1000 },
          { role: 'assistant', content: 'HEARTBEAT_OK is a status code', timestamp: 1001 },
        ],
      },
    });

    await actions.loadHistory();

    expect(h.read().messages.map((m) => m.content)).toEqual([
      'What is HEARTBEAT_OK?',
      'HEARTBEAT_OK is a status code',
    ]);
  });

  it('drops stale history results after the user switches sessions', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    let resolveHistory: ((value: unknown) => void) | null = null;
    invokeIpcMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveHistory = resolve;
    }));

    const h = makeHarness({
      currentSessionKey: 'agent:main:session-a',
      messages: [
        {
          role: 'assistant',
          content: 'session b content',
          timestamp: 1773281732,
        },
      ],
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    const loadPromise = actions.loadHistory();
    h.set({
      currentSessionKey: 'agent:main:session-b',
      messages: [
        {
          role: 'assistant',
          content: 'session b content',
          timestamp: 1773281733,
        },
      ],
    });
    resolveHistory?.({
      success: true,
      result: {
        messages: [
          {
            role: 'assistant',
            content: 'stale session a content',
            timestamp: 1773281734,
          },
        ],
      },
    });

    await loadPromise;

    expect(h.read().currentSessionKey).toBe('agent:main:session-b');
    expect(h.read().messages.map((message) => message.content)).toEqual(['session b content']);
  });

  it('clears streaming state when history already contains the final assistant reply', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sending: true,
      activeRunId: 'run-final',
      pendingFinal: true,
      lastUserMessageAt: 1000,
      streamingText: 'Photo saved (60KB). You should be able to see it now.',
      streamingMessage: {
        role: 'assistant',
        content: 'Photo saved (60KB). You should be able to see it now.',
      },
      streamingTools: [{ name: 'camera_capture', status: 'running' }],
      pendingToolImages: [{ fileName: 'photo.png' }],
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          { role: 'user', content: 'Take a photo for me.', timestamp: 1000 },
          { role: 'assistant', content: 'Photo saved (60KB). You should be able to see it now.', timestamp: 1002 },
        ],
      },
    });

    await actions.loadHistory();

    expect(h.read().messages.map((message) => message.content)).toEqual([
      'Take a photo for me.',
      'Photo saved (60KB). You should be able to see it now.',
    ]);
    expect(h.read().sending).toBe(false);
    expect(h.read().activeRunId).toBeNull();
    expect(h.read().pendingFinal).toBe(false);
    expect(h.read().streamingText).toBe('');
    expect(h.read().streamingMessage).toBeNull();
    expect(h.read().streamingTools).toEqual([]);
    expect(h.read().pendingToolImages).toEqual([]);
    expect(clearHistoryPoll).toHaveBeenCalledTimes(1);
  });

  it('preserves local in-flight assistant process messages when history polling is behind', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sending: true,
      lastUserMessageAt: 1000,
      messages: [
        { id: 'user-1', role: 'user', content: 'Take a photo for me.', timestamp: 1000 },
        { id: 'assistant-local-1', role: 'assistant', content: 'Preparing the camera.', timestamp: 1001 },
      ],
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          { id: 'user-1', role: 'user', content: 'Take a photo for me.', timestamp: 1000 },
        ],
      },
    });

    await actions.loadHistory(true);

    expect(h.read().messages.map((message) => message.content)).toEqual([
      'Take a photo for me.',
      'Preparing the camera.',
    ]);
  });

  it('preserves the current streaming assistant reply during refresh when history is still behind', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sending: true,
      pendingFinal: true,
      lastUserMessageAt: 1000,
      messages: [
        { id: 'user-1', role: 'user', content: 'Take a photo for me.', timestamp: 1000 },
      ],
      streamingMessage: {
        id: 'stream-1',
        role: 'assistant',
        content: 'Photo saved (60KB). You should be able to see it now.',
        timestamp: 1001,
      },
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          { id: 'user-1', role: 'user', content: 'Take a photo for me.', timestamp: 1000 },
        ],
      },
    });

    await actions.loadHistory(true);

    expect(h.read().messages.map((message) => message.content)).toEqual([
      'Take a photo for me.',
      'Photo saved (60KB). You should be able to see it now.',
    ]);
  });

  it('preserves newer same-session messages when preview hydration finishes later', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    let releasePreviewHydration: (() => void) | null = null;
    loadMissingPreviews.mockImplementationOnce(async (messages) => {
      await new Promise<void>((resolve) => {
        releasePreviewHydration = () => {
          messages[0]!._attachedFiles = [
            {
              fileName: 'image.png',
              mimeType: 'image/png',
              fileSize: 42,
              preview: 'data:image/png;base64,abc',
              filePath: '/tmp/image.png',
            },
          ];
          resolve();
        };
      });
      return true;
    });

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          {
            id: 'history-1',
            role: 'assistant',
            content: 'older message',
            timestamp: 1000,
          },
        ],
      },
    });

    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    await actions.loadHistory();

    h.set((state) => ({
      messages: [
        ...state.messages,
        {
          id: 'newer-1',
          role: 'assistant',
          content: 'newer message',
          timestamp: 1001,
        },
      ],
    }));

    releasePreviewHydration?.();
    await Promise.resolve();

    expect(h.read().messages.map((message) => message.content)).toEqual([
      'older message',
      'newer message',
    ]);
    expect(h.read().messages[0]?._attachedFiles?.[0]?.preview).toBe('data:image/png;base64,abc');
  });

  it('surfaces an error when the latest assistant reply is empty', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sending: true,
      pendingFinal: true,
      lastUserMessageAt: 1000,
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          { role: 'user', content: 'Hello', timestamp: 1000 },
          { role: 'assistant', content: [], timestamp: 1001 },
        ],
      },
    });

    await actions.loadHistory(true);

    expect(clearHistoryPoll).toHaveBeenCalledTimes(1);
    expect(h.read().sending).toBe(false);
    expect(h.read().pendingFinal).toBe(false);
    expect(h.read().lastUserMessageAt).toBeNull();
    expect(h.read().error).toBe(EMPTY_ASSISTANT_RESPONSE_ERROR);
  });
});
