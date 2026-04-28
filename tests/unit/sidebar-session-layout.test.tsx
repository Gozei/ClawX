import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';

const { settingsState, chatState, gatewayState, agentsState, updateState } = vi.hoisted(() => ({
  settingsState: {
    sidebarCollapsed: false,
    sidebarWidth: 240,
    language: 'en',
    brandingOverrides: null,
    setSidebarCollapsed: vi.fn(),
    setSidebarWidth: vi.fn(),
  },
  chatState: {
    sessions: [
      {
        key: 'agent:main:sidebar-layout-a',
        label: 'Aligned title A',
        pinned: false,
      },
      {
        key: 'agent:research:sidebar-layout-b',
        label: 'Aligned title B',
        pinned: false,
      },
    ],
    currentSessionKey: 'agent:main:sidebar-layout-a',
    sending: false,
    pendingFinal: false,
    sendStage: null as string | null,
    streamingMessage: null as unknown,
    streamingTools: [] as Array<Record<string, unknown>>,
    sessionRunningState: {} as Record<string, boolean>,
    sessionLabels: {},
    sessionLastActivity: {
      'agent:main:sidebar-layout-a': 2,
      'agent:research:sidebar-layout-b': 1,
    } as Record<string, number>,
    messages: [],
    switchSession: vi.fn(),
    newSession: vi.fn(),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
    toggleSessionPin: vi.fn(),
    loadSessions: vi.fn(),
    loadHistory: vi.fn(),
  },
  gatewayState: {
    status: { state: 'stopped' },
  },
  agentsState: {
    agents: [
      { id: 'main', name: 'Main Role' },
      { id: 'research', name: 'Operations Specialist Team' },
    ],
    fetchAgents: vi.fn(),
  },
  updateState: {
    currentVersion: '2026.4.9',
  },
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: Object.assign(
    (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
    {
      getState: () => settingsState,
    },
  ),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: typeof chatState) => unknown) => selector(chatState),
    {
      getState: () => chatState,
    },
  ),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: Object.assign(
    (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
    {
      getState: () => agentsState,
    },
  ),
}));

vi.mock('@/stores/update', () => ({
  useUpdateStore: (selector: (state: typeof updateState) => unknown) => selector(updateState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: () => null,
}));

vi.mock('@/components/branding/AppLogo', () => ({
  AppLogo: ({ testId, className }: { testId?: string; className?: string }) => (
    <div data-testid={testId} className={className} />
  ),
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    initReactI18next: actual.initReactI18next ?? { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { resolvedLanguage: 'en' },
    }),
  };
});

describe('Sidebar session layout', () => {
  beforeEach(() => {
    chatState.sessions = [
      {
        key: 'agent:main:sidebar-layout-a',
        label: 'Aligned title A',
        pinned: false,
      },
      {
        key: 'agent:research:sidebar-layout-b',
        label: 'Aligned title B',
        pinned: false,
      },
    ];
    chatState.currentSessionKey = 'agent:main:sidebar-layout-a';
    chatState.sending = false;
    chatState.pendingFinal = false;
    chatState.sendStage = null;
    chatState.streamingMessage = null;
    chatState.streamingTools = [];
    chatState.sessionRunningState = {};
    gatewayState.status = { state: 'stopped' };
    updateState.currentVersion = '2026.4.9';
  });

  it('renders fixed-width role badges and relaxed idle title columns for session rows', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    );

    const shortRole = screen.getByTestId('sidebar-session-role-agent:main:sidebar-layout-a');
    const longRole = screen.getByTestId('sidebar-session-role-agent:research:sidebar-layout-b');
    const shortTitle = screen.getByTestId('sidebar-session-title-agent:main:sidebar-layout-a');
    const longTitle = screen.getByTestId('sidebar-session-title-agent:research:sidebar-layout-b');
    const shortButton = screen.getByTestId('sidebar-session-button-agent:main:sidebar-layout-a');
    const longButton = screen.getByTestId('sidebar-session-button-agent:research:sidebar-layout-b');

    expect(shortRole).toHaveClass('w-[63px]', 'inline-flex', 'shrink-0');
    expect(longRole).toHaveClass('w-[63px]', 'inline-flex', 'shrink-0');
    expect(shortRole).toHaveAttribute('title', 'Main Role');
    expect(longRole).toHaveAttribute('title', 'Operations Specialist Team');

    expect(shortTitle).toHaveClass('min-w-0', 'flex-1', 'truncate');
    expect(longTitle).toHaveClass('min-w-0', 'flex-1', 'truncate');
    expect(shortButton).toHaveClass('pr-3', 'group-hover:pr-10');
    expect(longButton).toHaveClass('pr-3', 'group-hover:pr-10');
    expect(shortButton).toHaveClass('transition-colors');
    expect(longButton).toHaveClass('transition-colors');
    expect(shortButton).not.toHaveClass('transition-all');
    expect(longButton).not.toHaveClass('transition-all');
    expect(shortButton).not.toHaveClass('pr-12');
    expect(longButton).not.toHaveClass('pr-12');
  });

  it('reserves action space only when a persistent status indicator is visible', () => {
    chatState.sessions = [
      {
        key: 'agent:main:sidebar-layout-a',
        label: 'Aligned title A',
        pinned: false,
      },
      {
        key: 'agent:research:sidebar-layout-b',
        label: 'Aligned title B',
        pinned: true,
      },
    ];

    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    );

    const idleButton = screen.getByTestId('sidebar-session-button-agent:main:sidebar-layout-a');
    const pinnedButton = screen.getByTestId('sidebar-session-button-agent:research:sidebar-layout-b');
    const idleMenuTrigger = screen.getByTestId('sidebar-session-menu-trigger-agent:main:sidebar-layout-a');
    const pinnedMenuTrigger = screen.getByTestId('sidebar-session-menu-trigger-agent:research:sidebar-layout-b');

    expect(idleButton).toHaveClass('pr-3', 'group-hover:pr-10');
    expect(pinnedButton).toHaveClass('pr-10');
    expect(pinnedButton).not.toHaveClass('group-hover:pr-10');
    expect(idleMenuTrigger).toHaveClass('pointer-events-none', 'group-hover:pointer-events-auto');
    expect(pinnedMenuTrigger).toHaveClass('pointer-events-none', 'group-hover:pointer-events-auto');
  });

  it('shows spinning run indicators for every running session while keeping actions hover-revealed', () => {
    chatState.sessionRunningState = {
      'agent:main:sidebar-layout-a': true,
      'agent:research:sidebar-layout-b': true,
    };

    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    );

    const primaryRunningIndicator = screen.getByTestId('sidebar-session-running-indicator-agent:main:sidebar-layout-a');
    const secondaryRunningIndicator = screen.getByTestId('sidebar-session-running-indicator-agent:research:sidebar-layout-b');
    const activeMenuTrigger = screen.getByTestId('sidebar-session-menu-trigger-agent:main:sidebar-layout-a');
    const backgroundMenuTrigger = screen.getByTestId('sidebar-session-menu-trigger-agent:research:sidebar-layout-b');
    const activeButton = screen.getByTestId('sidebar-session-button-agent:main:sidebar-layout-a');
    const backgroundButton = screen.getByTestId('sidebar-session-button-agent:research:sidebar-layout-b');

    expect(primaryRunningIndicator).toHaveClass('opacity-100', 'group-hover:opacity-0');
    expect(secondaryRunningIndicator).toHaveClass('opacity-100', 'group-hover:opacity-0');
    expect(activeMenuTrigger).toHaveClass('pointer-events-none', 'opacity-0', 'group-hover:pointer-events-auto', 'group-hover:opacity-100');
    expect(backgroundMenuTrigger).toHaveClass('pointer-events-none', 'opacity-0', 'group-hover:pointer-events-auto', 'group-hover:opacity-100');
    expect(activeButton).toHaveClass('pr-10');
    expect(backgroundButton).toHaveClass('pr-10');
  });

  it('shows the version and a green status dot below settings when the system is healthy', () => {
    gatewayState.status = { state: 'running', port: 18789 };

    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('sidebar-system-summary')).toHaveTextContent('Version');
    expect(screen.getByTestId('sidebar-system-summary')).toHaveClass('bg-transparent');
    expect(screen.getByTestId('sidebar-system-version')).toHaveTextContent('v2026.4.9');
    expect(screen.getByTestId('sidebar-system-status')).toHaveClass('bg-green-500', 'ring-green-500/15');
  });

  it('shows a red status dot below settings when the system is degraded', () => {
    gatewayState.status = { state: 'stopped', port: 18789 };

    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('sidebar-system-summary')).toHaveClass('bg-transparent');
    expect(screen.getByTestId('sidebar-system-status')).toHaveClass('bg-red-500', 'ring-red-500/15');
    expect(screen.getByTestId('sidebar-system-status')).toHaveAttribute('aria-label', 'System degraded: stopped');
  });

  it('shows a gateway status hint above new chat with a ticking elapsed timer while the gateway is starting', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-04-15T00:00:00.000Z'));
      gatewayState.status = { state: 'starting' };

      render(
        <MemoryRouter initialEntries={['/']}>
          <Sidebar />
        </MemoryRouter>,
      );

      expect(screen.getByTestId('sidebar-gateway-status-hint')).toHaveTextContent('Gateway starting');
      expect(screen.getByTestId('sidebar-gateway-status-hint')).toHaveClass(
        'border-red-200/80',
        'bg-red-50/95',
        'text-red-600',
      );
      expect(screen.getByTestId('sidebar-gateway-status-elapsed')).toHaveTextContent('(0s)');
      expect(screen.getByTestId('sidebar-gateway-status-elapsed')).toHaveClass('text-red-600/80');
      expect(screen.getByTestId('sidebar-gateway-status-ellipsis')).toHaveTextContent('...');

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(screen.getByTestId('sidebar-gateway-status-elapsed')).toHaveTextContent('(3s)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a disconnected gateway hint without elapsed time when the gateway is stopped', () => {
    gatewayState.status = { state: 'stopped' };

    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('sidebar-gateway-status-hint')).toHaveTextContent('Gateway not connected');
    expect(screen.queryByTestId('sidebar-gateway-status-elapsed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-gateway-status-ellipsis')).not.toBeInTheDocument();
  });
});
