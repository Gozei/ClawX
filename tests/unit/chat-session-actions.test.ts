import { beforeEach, describe, expect, it, vi } from 'vitest';

const { defaultAgentStoreState } = vi.hoisted(() => ({
  defaultAgentStoreState: {
    defaultAgentId: 'main',
  },
}));

const invokeIpcMock = vi.fn();
const hostApiFetchMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: {
    getState: () => defaultAgentStoreState,
  },
}));

type ChatLikeState = {
  currentSessionKey: string;
  currentAgentId: string;
  sessions: Array<{ key: string; label?: string; displayName?: string; updatedAt?: number; pinned?: boolean; pinOrder?: number; archived?: boolean; archivedAt?: number; createdAt?: number }>;
  messages: Array<{ role: string; timestamp?: number; content?: unknown }>;
  sessionLabels: Record<string, string>;
  sessionLastActivity: Record<string, number>;
  streamingText: string;
  streamingMessage: unknown | null;
  streamingTools: unknown[];
  activeRunId: string | null;
  error: string | null;
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  pendingToolImages: unknown[];
  loadSessions?: () => Promise<void>;
  switchSession?: (key: string) => void;
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
    streamingText: '',
    streamingMessage: null,
    streamingTools: [],
    activeRunId: null,
    error: null,
    pendingFinal: false,
    lastUserMessageAt: null,
    pendingToolImages: [],
    loadHistory: vi.fn(),
    ...initial,
  };
  const set = (partial: Partial<ChatLikeState> | ((s: ChatLikeState) => Partial<ChatLikeState>)) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  return { set, get, read: () => state };
}

describe('chat session actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    defaultAgentStoreState.defaultAgentId = 'main';
    invokeIpcMock.mockResolvedValue({ success: true });
    hostApiFetchMock.mockResolvedValue({ success: true, label: 'Renamed session' });
  });

  it('switchSession preserves non-main session that has activity history', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:foo:session-a',
      sessions: [{ key: 'agent:foo:session-a' }, { key: 'agent:foo:main' }],
      messages: [],
      sessionLabels: { 'agent:foo:session-a': 'A' },
      sessionLastActivity: { 'agent:foo:session-a': 1 },
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    actions.switchSession('agent:foo:main');
    const next = h.read();
    expect(next.currentSessionKey).toBe('agent:foo:main');
    // Session with labels and activity should NOT be removed even though messages is empty,
    // because messages get cleared eagerly during switchSession before loadHistory completes.
    expect(next.sessions.find((s) => s.key === 'agent:foo:session-a')).toBeDefined();
    expect(next.sessionLabels['agent:foo:session-a']).toBe('A');
    expect(next.sessionLastActivity['agent:foo:session-a']).toBe(1);
    expect(h.read().loadHistory).toHaveBeenCalledTimes(1);
  });

  it('switchSession removes truly empty non-main session (no activity, no labels)', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:foo:session-b',
      sessions: [{ key: 'agent:foo:session-b' }, { key: 'agent:foo:main' }],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    actions.switchSession('agent:foo:main');
    const next = h.read();
    expect(next.currentSessionKey).toBe('agent:foo:main');
    // Truly empty session (no labels, no activity) should be cleaned up
    expect(next.sessions.find((s) => s.key === 'agent:foo:session-b')).toBeUndefined();
    expect(h.read().loadHistory).toHaveBeenCalledTimes(1);
  });

  it('deleteSession updates current session and keeps sidebar consistent', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:foo:session-a',
      sessions: [{ key: 'agent:foo:session-a' }, { key: 'agent:foo:main' }],
      sessionLabels: { 'agent:foo:session-a': 'A' },
      sessionLastActivity: { 'agent:foo:session-a': 1 },
      messages: [{ role: 'user' }],
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    await actions.deleteSession('agent:foo:session-a');
    const next = h.read();
    expect(invokeIpcMock).toHaveBeenCalledWith('session:delete', 'agent:foo:session-a');
    expect(next.currentSessionKey).toBe('agent:foo:main');
    expect(next.sessions.map((s) => s.key)).toEqual(['agent:foo:main']);
    expect(next.sessionLabels['agent:foo:session-a']).toBeUndefined();
    expect(next.sessionLastActivity['agent:foo:session-a']).toBeUndefined();
    expect(h.read().loadHistory).toHaveBeenCalledTimes(1);
  });

  it('newSession creates a draft session for the configured default role without adding it to history yet', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    defaultAgentStoreState.defaultAgentId = 'ops';
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:foo:main',
      currentAgentId: 'foo',
      sessions: [{ key: 'agent:foo:main' }],
      messages: [{ role: 'assistant' }],
      loading: true,
      streamingText: 'streaming',
      activeRunId: 'r1',
      pendingFinal: true,
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    actions.newSession();
    const next = h.read();
    expect(next.currentSessionKey).toBe('agent:ops:session-1711111111111');
    expect(next.currentAgentId).toBe('ops');
    expect(next.sessions.some((s) => s.key === 'agent:ops:session-1711111111111')).toBe(false);
    expect(next.messages).toEqual([]);
    expect(next.loading).toBe(false);
    expect(next.streamingText).toBe('');
    expect(next.activeRunId).toBeNull();
    expect(next.pendingFinal).toBe(false);
    nowSpy.mockRestore();
  });

  it('loadSessions does not materialize the active empty draft as history', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:foo:session-draft',
      sessions: [{ key: 'agent:foo:session-draft' }],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        sessions: [
          { key: 'agent:foo:main', displayName: 'Main' },
        ],
      },
    });

    await actions.loadSessions();

    expect(h.read().currentSessionKey).toBe('agent:foo:session-draft');
    expect(h.read().sessions.some((session) => session.key === 'agent:foo:session-draft')).toBe(false);
  });

  it('loadSessions keeps the blank default session selected on cold start', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        sessions: [
          { key: 'agent:main:session-latest', label: 'Latest session', updatedAt: 2_000 },
          { key: 'agent:main:main', displayName: 'Main', updatedAt: 1_000 },
        ],
      },
    });
    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      metadata: {},
    });

    await actions.loadSessions();

    expect(h.read().currentSessionKey).toBe('agent:main:main');
    expect(h.read().sessions.map((session) => session.key)).toEqual([
      'agent:main:session-latest',
      'agent:main:main',
    ]);
    expect(h.read().loadHistory).not.toHaveBeenCalled();
  });

  it('renameSession persists and updates the local label with a 30-character cap', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:foo:session-a',
      sessions: [{ key: 'agent:foo:session-a', displayName: 'Session A' }],
      sessionLabels: { 'agent:foo:session-a': 'Old name' },
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    await actions.renameSession('agent:foo:session-a', '123456789012345678901234567890XYZ');

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/rename', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: 'agent:foo:session-a',
        label: '123456789012345678901234567890',
      }),
    });
    expect(h.read().sessionLabels['agent:foo:session-a']).toBe('123456789012345678901234567890');
    expect(h.read().sessions[0]?.label).toBe('123456789012345678901234567890');
  });

  it('toggleSessionPin persists the pin state and appends pin order', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:foo:session-b',
      sessions: [
        { key: 'agent:foo:session-a', pinned: true, pinOrder: 1 },
        { key: 'agent:foo:session-b', displayName: 'Session B' },
      ],
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    hostApiFetchMock.mockResolvedValueOnce({ success: true, pinned: true, pinOrder: 2 });
    await actions.toggleSessionPin('agent:foo:session-b');

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/pin', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: 'agent:foo:session-b',
        pinned: true,
        pinOrder: 2,
      }),
    });
    expect(h.read().sessions.find((session) => session.key === 'agent:foo:session-b')).toMatchObject({
      pinned: true,
      pinOrder: 2,
    });

    hostApiFetchMock.mockResolvedValueOnce({ success: true, pinned: false });
    await actions.toggleSessionPin('agent:foo:session-b');
    expect(h.read().sessions.find((session) => session.key === 'agent:foo:session-b')).toMatchObject({
      pinned: false,
      pinOrder: undefined,
    });
  });

  it('archiveSession removes the session from the visible list and switches away when needed', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:foo:session-a',
      sessions: [
        { key: 'agent:foo:session-a', label: 'Alpha' },
        { key: 'agent:foo:session-b', label: 'Bravo' },
      ],
      sessionLabels: { 'agent:foo:session-a': 'Alpha' },
      sessionLastActivity: { 'agent:foo:session-a': 1 },
      messages: [{ role: 'user' }],
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    hostApiFetchMock.mockResolvedValueOnce({ success: true, archived: true, archivedAt: 123 });
    await actions.archiveSession('agent:foo:session-a');

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/archive', {
      method: 'POST',
      body: JSON.stringify({ sessionKey: 'agent:foo:session-a', archived: true }),
    });
    expect(h.read().currentSessionKey).toBe('agent:foo:session-b');
    expect(h.read().sessions.map((session) => session.key)).toEqual(['agent:foo:session-b']);
    expect(h.read().sessionLabels['agent:foo:session-a']).toBeUndefined();
    expect(h.read().loadHistory).toHaveBeenCalledTimes(1);
  });

  it('restoreSession unarchives and switches back to the restored session', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:foo:session-b',
      sessions: [{ key: 'agent:foo:session-b', label: 'Bravo' }],
    });
    const actions = createSessionActions(h.set as never, h.get as never);
    (h.read() as ChatLikeState).loadSessions = actions.loadSessions;
    (h.read() as ChatLikeState).switchSession = actions.switchSession;

    hostApiFetchMock.mockResolvedValueOnce({ success: true, archived: false });
    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        sessions: [
          { key: 'agent:foo:session-a', label: 'Alpha' },
          { key: 'agent:foo:session-b', label: 'Bravo' },
        ],
      },
    });
    hostApiFetchMock.mockResolvedValueOnce({ success: true, metadata: {} });

    await actions.restoreSession('agent:foo:session-a');

    expect(hostApiFetchMock).toHaveBeenNthCalledWith(1, '/api/sessions/archive', {
      method: 'POST',
      body: JSON.stringify({ sessionKey: 'agent:foo:session-a', archived: false }),
    });
    expect(h.read().currentSessionKey).toBe('agent:foo:session-a');
    expect(h.read().loadHistory).toHaveBeenCalledTimes(1);
  });

  it('seeds sessionLastActivity from backend updatedAt metadata', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sessions: [],
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        sessions: [
          {
            key: 'agent:main:main',
            displayName: 'Main',
            updatedAt: 1773281700000,
          },
          {
            key: 'agent:main:cron:job-1',
            label: 'Cron: Drink water',
            updatedAt: 1773281731621,
            pinned: true,
            pinOrder: 4,
          },
        ],
      },
    });

    await actions.loadSessions();

    expect(h.read().sessionLastActivity['agent:main:main']).toBe(1773281700000);
    expect(h.read().sessionLastActivity['agent:main:cron:job-1']).toBe(1773281731621);
    expect(h.read().sessions.find((session) => session.key === 'agent:main:cron:job-1')).toMatchObject({
      updatedAt: 1773281731621,
      pinned: true,
      pinOrder: 4,
    });
  });

  it('loadSessions merges persisted pin metadata from the host session store', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sessions: [],
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        sessions: [
          {
            key: 'agent:main:session-1',
            label: 'Pinned from disk',
            updatedAt: 1773281700000,
          },
        ],
      },
    });
    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      metadata: {
        'agent:main:session-1': {
          pinned: true,
          pinOrder: 7,
        },
      },
    });

    await actions.loadSessions();

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/metadata', {
      method: 'POST',
      body: JSON.stringify({ sessionKeys: ['agent:main:session-1'] }),
    });
    expect(h.read().sessions.find((session) => session.key === 'agent:main:session-1')).toMatchObject({
      pinned: true,
      pinOrder: 7,
    });
  });

  it('loadSessions hides archived sessions from the primary session list', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sessions: [],
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        sessions: [
          { key: 'agent:main:session-visible', label: 'Visible' },
          { key: 'agent:main:session-archived', label: 'Archived' },
        ],
      },
    });
    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      metadata: {
        'agent:main:session-visible': {},
        'agent:main:session-archived': { archived: true, archivedAt: 123 },
      },
    });

    await actions.loadSessions();

    expect(h.read().sessions.map((session) => session.key)).toEqual(['agent:main:session-visible']);
  });
});

