import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';

const { settingsState, chatState, gatewayState, agentsState } = vi.hoisted(() => ({
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
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { resolvedLanguage: 'en' },
    }),
  };
});

describe('Sidebar session layout', () => {
  beforeEach(() => {
    chatState.currentSessionKey = 'agent:main:sidebar-layout-a';
    chatState.sending = false;
    chatState.sessionRunningState = {};
  });

  it('renders fixed-width role badges and flexed title columns for session rows', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    );

    const shortRole = screen.getByTestId('sidebar-session-role-agent:main:sidebar-layout-a');
    const longRole = screen.getByTestId('sidebar-session-role-agent:research:sidebar-layout-b');
    const shortTitle = screen.getByTestId('sidebar-session-title-agent:main:sidebar-layout-a');
    const longTitle = screen.getByTestId('sidebar-session-title-agent:research:sidebar-layout-b');

    expect(shortRole).toHaveClass('w-[63px]', 'inline-flex', 'shrink-0');
    expect(longRole).toHaveClass('w-[63px]', 'inline-flex', 'shrink-0');
    expect(shortRole).toHaveAttribute('title', 'Main Role');
    expect(longRole).toHaveAttribute('title', 'Operations Specialist Team');

    expect(shortTitle).toHaveClass('min-w-0', 'flex-1', 'truncate');
    expect(longTitle).toHaveClass('min-w-0', 'flex-1', 'truncate');
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

    expect(primaryRunningIndicator).toHaveClass('opacity-100', 'group-hover:opacity-0');
    expect(secondaryRunningIndicator).toHaveClass('opacity-100', 'group-hover:opacity-0');
    expect(activeMenuTrigger).toHaveClass('opacity-0', 'group-hover:opacity-100');
    expect(backgroundMenuTrigger).toHaveClass('opacity-0', 'group-hover:opacity-100');
  });
});
