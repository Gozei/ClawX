import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Chat } from '@/pages/Chat';

const { agentsState, chatState, gatewayState, settingsState } = vi.hoisted(() => ({
  agentsState: {
    fetchAgents: vi.fn(async () => {}),
  },
  chatState: {
    messages: [] as Array<Record<string, unknown>>,
    currentSessionKey: 'agent:main:main',
    loading: false,
    sending: false,
    sessionRunningState: {} as Record<string, boolean>,
    error: null as string | null,
    showThinking: true,
    activeTurnBuffer: undefined,
    streamingMessage: null as unknown,
    streamingTools: [] as Array<Record<string, unknown>>,
    sendStage: null as string | null,
    pendingFinal: false,
    lastUserMessageAt: null as number | null,
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
  },
  settingsState: {
    chatProcessDisplayMode: 'all',
    hideInternalRoutineProcesses: false,
    chatFontScale: 100,
    assistantMessageStyle: 'bubble',
  },
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      i18n: {
        resolvedLanguage: 'zh',
        language: 'zh',
      },
      t: (key: string, defaultValue?: string) => defaultValue ?? key,
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

vi.mock('@/components/branding/AppLogo', () => ({
  AppLogo: () => <div data-testid="app-logo" />,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: ({ prefillText, prefillNonce }: { prefillText?: string; prefillNonce?: number }) => (
    <div
      data-testid="chat-input"
      data-prefill-text={prefillText ?? ''}
      data-prefill-nonce={String(prefillNonce ?? 0)}
    />
  ),
}));

vi.mock('@/pages/Chat/ChatToolbarV2', () => ({
  ChatToolbarV2: () => <div data-testid="chat-toolbar" />,
}));

describe('Chat route prefill', () => {
  beforeEach(() => {
    agentsState.fetchAgents.mockClear();
    chatState.messages = [];
    chatState.currentSessionKey = 'agent:main:main';
    chatState.loading = false;
    chatState.sending = false;
    chatState.sessionRunningState = {};
    chatState.error = null;
    chatState.showThinking = true;
    chatState.activeTurnBuffer = undefined;
    chatState.streamingMessage = null;
    chatState.streamingTools = [];
    chatState.sendStage = null;
    chatState.pendingFinal = false;
    chatState.lastUserMessageAt = null;
    chatState.queuedMessages = {};
  });

  it('hydrates the composer from route state when a prefill is provided', async () => {
    render(
      <MemoryRouter
        initialEntries={[{
          pathname: '/',
          state: {
            composerPrefillText: '请帮我创建一个新的 skill，优先使用内置的 skill 创建能力。我的要求是：',
          },
        }]}
      >
        <Routes>
          <Route path="/" element={<Chat />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).toHaveAttribute(
        'data-prefill-text',
        '请帮我创建一个新的 skill，优先使用内置的 skill 创建能力。我的要求是：',
      );
    });
    expect(screen.getByTestId('chat-input')).not.toHaveAttribute('data-prefill-nonce', '0');
  });
});
