import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const navigateMock = vi.fn();

const { agentsState, chatState, gatewayState, settingsState, useDeferredValueMock } = vi.hoisted(() => ({
  agentsState: {
    fetchAgents: vi.fn(async () => {}),
  },
  chatState: {
    messages: [] as Array<Record<string, unknown>>,
    currentSessionKey: 'agent:main:main',
    loading: false,
    sending: true,
    sessionRunningState: {} as Record<string, boolean>,
    error: null as string | null,
    showThinking: true,
    streamingMessage: null as unknown,
    streamingTools: [] as Array<Record<string, unknown>>,
    sendStage: null as string | null,
    pendingFinal: false,
    lastUserMessageAt: 1000,
    sendMessage: vi.fn(),
    queueOfflineMessage: vi.fn(),
    flushQueuedMessage: vi.fn(),
    clearQueuedMessage: vi.fn(),
    abortRun: vi.fn(),
    clearError: vi.fn(),
    cleanupEmptySession: vi.fn(),
    queuedMessages: {} as Record<string, unknown>,
  },
  gatewayState: {
    status: { state: 'running', port: 18789 },
    start: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
  },
  settingsState: {
    chatProcessDisplayMode: 'all',
    chatFontScale: 100,
    assistantMessageStyle: 'bubble',
  },
  useDeferredValueMock: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useDeferredValue: (value: unknown) => useDeferredValueMock(value),
  };
});

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      i18n: {
        resolvedLanguage: 'en',
        language: 'en',
      },
      t: (key: string) => key,
    }),
  };
});

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/hooks/use-stick-to-bottom-instant', () => ({
  useStickToBottomInstant: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    stopScroll: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-min-loading', () => ({
  useMinLoading: () => false,
}));

vi.mock('@/lib/branding', () => ({
  useBranding: () => ({
    productName: 'ClawX',
  }),
}));

vi.mock('@/components/common/LoadingSpinner', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

vi.mock('@/pages/Chat/ChatToolbarV2', () => ({
  ChatToolbarV2: () => <div data-testid="chat-toolbar" />,
}));

import { Chat } from '@/pages/Chat';

describe('Chat active turn dedupe', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    agentsState.fetchAgents.mockClear();
    chatState.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: '你叫啥呢',
        timestamp: 1000,
      },
    ];
    chatState.currentSessionKey = 'agent:main:main';
    chatState.loading = false;
    chatState.sending = true;
    chatState.sessionRunningState = { 'agent:main:main': true };
    chatState.error = null;
    chatState.showThinking = true;
    chatState.streamingMessage = null;
    chatState.streamingTools = [];
    chatState.sendStage = 'running';
    chatState.pendingFinal = false;
    chatState.lastUserMessageAt = 1000;
    settingsState.chatProcessDisplayMode = 'all';
    settingsState.chatFontScale = 100;
    settingsState.assistantMessageStyle = 'bubble';
    useDeferredValueMock.mockImplementation(() => chatState.messages);
  });

  it('does not render the active turn user bubble twice when deferred history lags behind', () => {
    render(<Chat />);

    expect(screen.getAllByText('你叫啥呢')).toHaveLength(1);
  });
});
