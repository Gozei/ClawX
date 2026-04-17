import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SkillDetailPage, Skills } from '../../src/pages/Skills';
import type { SkillDetail, SkillSnapshot, SkillSource } from '../../src/types/skill';

const TEST_SKILLS_GUIDE_ID = 'skills-page-basics';
const TEST_SKILLS_GUIDE_VERSION = 1;

const fetchSkillsMock = vi.fn();
const fetchSkillDetailMock = vi.fn();
const enableSkillMock = vi.fn();
const disableSkillMock = vi.fn();
const searchSkillsMock = vi.fn();
const installSkillMock = vi.fn();
const uninstallSkillMock = vi.fn();
const fetchSourcesMock = vi.fn();
const fetchMarketplaceSourceCountsMock = vi.fn();
const fetchMarketInstalledSkillsMock = vi.fn();
const loadMoreSearchResultsMock = vi.fn();
const newSessionMock = vi.fn();
const startGuideMock = vi.fn();

const { gatewayState, guideState, settingsState, skillsState, marketplaceSheetState, toastMocks } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running' as const },
  },
  guideState: {
    activeGuideId: null as string | null,
  },
  settingsState: {
    guideSeenVersions: { 'skills-page-basics': 1 } as Record<string, number>,
  },
  skillsState: {
    skills: [] as SkillSnapshot[],
    loading: false,
    error: null as string | null,
    searchResults: [],
    searching: false,
    searchError: null as string | null,
    installing: {} as Record<string, boolean>,
    sources: [] as SkillSource[],
    marketplaceSourceCounts: {} as Record<string, number | null>,
    skillDetailsById: {} as Record<string, SkillDetail>,
    detailLoadingId: null as string | null,
  },
  marketplaceSheetState: {
    latestProps: null as null | Record<string, unknown>,
  },
  toastMocks: {
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: { newSession: typeof newSessionMock }) => unknown) => selector({
    newSession: newSessionMock,
  }),
}));

vi.mock('@/stores/guide', () => ({
  useGuideStore: (selector: (state: { activeGuideId: string | null; startGuide: typeof startGuideMock }) => unknown) => selector({
    activeGuideId: guideState.activeGuideId,
    startGuide: startGuideMock,
  }),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: { guideSeenVersions: Record<string, number> }) => unknown) => selector(settingsState),
}));

vi.mock('@/stores/skills', () => ({
  useSkillsStore: Object.assign((selector?: (state: typeof skillsState & {
    fetchSkills: typeof fetchSkillsMock;
    fetchSkillDetail: typeof fetchSkillDetailMock;
    enableSkill: typeof enableSkillMock;
    disableSkill: typeof disableSkillMock;
    searchSkills: typeof searchSkillsMock;
    installSkill: typeof installSkillMock;
    uninstallSkill: typeof uninstallSkillMock;
    fetchSources: typeof fetchSourcesMock;
    fetchMarketplaceSourceCounts: typeof fetchMarketplaceSourceCountsMock;
    fetchMarketInstalledSkills: typeof fetchMarketInstalledSkillsMock;
    loadMoreSearchResults: typeof loadMoreSearchResultsMock;
  }) => unknown) => {
    const state = {
      ...skillsState,
      fetchSkills: fetchSkillsMock,
      fetchSkillDetail: fetchSkillDetailMock,
      enableSkill: enableSkillMock,
      disableSkill: disableSkillMock,
      searchSkills: searchSkillsMock,
      installSkill: installSkillMock,
      uninstallSkill: uninstallSkillMock,
      fetchSources: fetchSourcesMock,
      fetchMarketplaceSourceCounts: fetchMarketplaceSourceCountsMock,
      fetchMarketInstalledSkills: fetchMarketInstalledSkillsMock,
      loadMoreSearchResults: loadMoreSearchResultsMock,
    };
    return typeof selector === 'function' ? selector(state) : state;
  }, {
    getState: () => ({
      ...skillsState,
      fetchSkills: fetchSkillsMock,
      fetchSkillDetail: fetchSkillDetailMock,
      enableSkill: enableSkillMock,
      disableSkill: disableSkillMock,
      searchSkills: searchSkillsMock,
      installSkill: installSkillMock,
      uninstallSkill: uninstallSkillMock,
      fetchSources: fetchSourcesMock,
      fetchMarketplaceSourceCounts: fetchMarketplaceSourceCountsMock,
      fetchMarketInstalledSkills: fetchMarketInstalledSkillsMock,
      loadMoreSearchResults: loadMoreSearchResultsMock,
    }),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string }) => {
      if (key === 'toolbar.filtersWithCount') {
        return `filters ${options?.count ?? 0}`;
      }
      if (key === 'guide.createPrompt') {
        return 'localized create prompt';
      }
      return options?.defaultValue ?? key;
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
    dismiss: toastMocks.dismiss,
  },
}));

vi.mock('../../src/pages/Skills/components/SkillMarketplaceSheet', () => ({
  SkillMarketplaceSheet: (props: Record<string, unknown>) => {
    marketplaceSheetState.latestProps = props;
    return null;
  },
}));

vi.mock('../../src/pages/Skills/components/SkillDetailContent', () => ({
  SkillDetailContent: () => <div data-testid="skill-detail-content" />,
}));

function ChatPrefillStateProbe() {
  const location = useLocation();
  return (
    <div data-testid="chat-prefill-state">
      {JSON.stringify(location.state)}
    </div>
  );
}

describe('Skills page route state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    newSessionMock.mockReset();
    startGuideMock.mockReset();
    gatewayState.status.state = 'running';
    guideState.activeGuideId = null;
    settingsState.guideSeenVersions = { [TEST_SKILLS_GUIDE_ID]: TEST_SKILLS_GUIDE_VERSION };
    skillsState.skills = [
      {
        id: 'alpha',
        name: 'Alpha Skill',
        description: 'Built in alpha',
        enabled: true,
        ready: true,
        sourceId: 'clawhub',
      } as SkillSnapshot,
      {
        id: 'beta',
        name: 'Beta Skill',
        description: 'Market beta',
        enabled: true,
        ready: false,
        sourceId: 'clawhub',
        missing: { env: ['BETA_KEY'] },
      } as SkillSnapshot,
      {
        id: 'gamma',
        name: 'Gamma Skill',
        description: 'Other gamma',
        enabled: false,
        ready: true,
        sourceId: 'local',
      } as SkillSnapshot,
    ];
    skillsState.sources = [
      { id: 'clawhub', label: 'ClawHub', workdir: 'C:/Users/test/.codex/skills/clawhub' } as SkillSource,
      { id: 'deepaiworker', label: 'DeepSkillHub', workdir: 'C:/Users/test/.codex/skills/deepaiworker' } as SkillSource,
    ];
    skillsState.marketplaceSourceCounts = {
      clawhub: 55550,
      deepaiworker: 10638,
    };
    skillsState.loading = false;
    skillsState.error = null;
    skillsState.skillDetailsById = {
      beta: {
        identity: {
          id: 'beta',
          name: 'Beta Skill',
          description: 'Market beta',
          icon: '📦',
          source: 'clawhub',
        },
        status: {
          enabled: true,
          ready: false,
          missing: { env: ['BETA_KEY'] },
        },
        requirements: {
          primaryEnv: null,
          requires: {},
          rawMarkdown: '# Beta',
        },
        config: {
          apiKey: '',
          env: {},
        },
      } as SkillDetail,
    };
    skillsState.detailLoadingId = null;
    fetchSkillsMock.mockResolvedValue(undefined);
    fetchSkillDetailMock.mockResolvedValue(undefined);
    enableSkillMock.mockResolvedValue(undefined);
    disableSkillMock.mockResolvedValue(undefined);
    searchSkillsMock.mockResolvedValue(undefined);
    installSkillMock.mockResolvedValue(undefined);
    uninstallSkillMock.mockResolvedValue(undefined);
    fetchSourcesMock.mockResolvedValue(skillsState.sources);
    fetchMarketplaceSourceCountsMock.mockResolvedValue(skillsState.marketplaceSourceCounts);
    fetchMarketInstalledSkillsMock.mockResolvedValue(undefined);
    loadMoreSearchResultsMock.mockResolvedValue(undefined);
    toastMocks.success.mockReset();
    toastMocks.error.mockReset();
    toastMocks.dismiss.mockReset();
    toastMocks.success.mockReturnValue('toast-id');
    marketplaceSheetState.latestProps = null;
  });

  it('auto-opens the skills guide when the user has not seen it yet', async () => {
    settingsState.guideSeenVersions = {};

    render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(startGuideMock).toHaveBeenCalledWith(TEST_SKILLS_GUIDE_ID);
    });
  });

  it('fetches marketplace source counts after loading skill sources', async () => {
    render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(fetchMarketplaceSourceCountsMock).toHaveBeenCalledTimes(1);
    });
  });

  it('restarts the skills guide when the guide button is clicked', async () => {
    render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );

    await act(async () => {
      screen.getByTestId('skills-guide-button').click();
      await Promise.resolve();
    });

    expect(startGuideMock).toHaveBeenCalledWith(TEST_SKILLS_GUIDE_ID);
  });

  it('starts a new chat and passes the skill creation prefill when create is clicked', async () => {
    render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
          <Route path="/" element={<ChatPrefillStateProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await act(async () => {
      screen.getByTestId('skills-create-button').click();
      await Promise.resolve();
    });

    expect(newSessionMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('chat-prefill-state')).toHaveTextContent(
      'localized create prompt',
    );
  });

  it('hydrates the list search and filters from the URL', () => {
    render(
      <MemoryRouter initialEntries={['/skills?q=beta&status=enabled&missing=missing']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('skills-search-input')).toHaveValue('beta');
    expect(screen.getByTestId('skills-filter-button')).toHaveTextContent('filters 2');
    expect(screen.getByTestId('skills-list-item-beta')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-list-item-alpha')).not.toBeInTheDocument();
    expect(screen.queryByTestId('skills-list-item-gamma')).not.toBeInTheDocument();
  });

  it('retries loading skills only once after the gateway first becomes running', async () => {
    gatewayState.status.state = 'starting';
    skillsState.skills = [];

    const view = render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchSkillsMock).toHaveBeenCalledTimes(1));

    gatewayState.status.state = 'running';
    view.rerender(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchSkillsMock).toHaveBeenCalledTimes(2));

    gatewayState.status.state = 'starting';
    view.rerender(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );

    gatewayState.status.state = 'running';
    view.rerender(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchSkillsMock).toHaveBeenCalledTimes(2));
  });

  it('shows a marketplace success CTA that navigates to the installed skill detail page', async () => {
    render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
          <Route path="/skills/:skillId" element={<SkillDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await act(async () => {
      screen.getByTestId('skills-discover-button').click();
      await Promise.resolve();
    });

    expect((marketplaceSheetState.latestProps as { open?: boolean } | null)?.open).toBe(true);

    expect((marketplaceSheetState.latestProps as { sourceCounts?: Record<string, number | null> } | null)?.sourceCounts).toEqual({
      clawhub: 55550,
      deepaiworker: 10638,
    });

    const marketplaceProps = marketplaceSheetState.latestProps as null | {
      onInstall?: (slug: string, version?: string, sourceId?: string, force?: boolean) => void;
      onViewInstalledSkill?: (slug: string) => void;
      marketplaceNotice?: { type: string; slug: string; name?: string } | null;
    };

    expect(marketplaceProps?.onInstall).toBeTypeOf('function');

    await act(async () => {
      marketplaceProps?.onInstall?.('beta', '1.0.0', 'clawhub', false);
      await Promise.resolve();
    });

    expect(installSkillMock).toHaveBeenCalledWith('beta', '1.0.0', 'clawhub', false);
    expect(enableSkillMock).toHaveBeenCalledWith('beta');

    const updatedMarketplaceProps = marketplaceSheetState.latestProps as null | {
      onViewInstalledSkill?: (slug: string) => void;
      marketplaceNotice?: { type: string; slug: string; name?: string } | null;
    };
    expect(updatedMarketplaceProps?.marketplaceNotice?.slug).toBe('beta');
    expect(updatedMarketplaceProps?.marketplaceNotice?.type).toBe('installed');

    await act(async () => {
      updatedMarketplaceProps?.onViewInstalledSkill?.('beta');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'detail.backToList' }).getAttribute('href')).toContain('marketplace=1');
    });
    expect(screen.getByTestId('skill-detail-content')).toBeInTheDocument();
  });

  it('ignores transient undefined skill entries when rendering the skills page', async () => {
    skillsState.skills = [
      undefined as unknown as SkillSnapshot,
      {
        id: 'beta',
        name: 'Beta Skill',
        description: 'Market beta',
        enabled: true,
        ready: false,
        sourceId: 'clawhub',
      } as SkillSnapshot,
    ];

    render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId('skills-page')).toBeInTheDocument());
    expect(screen.getByTestId('skills-list-item-beta')).toBeInTheDocument();
  });

  it('keeps the current query string on the detail page back link', () => {
    render(
      <MemoryRouter initialEntries={['/skills/beta?q=beta&status=enabled&missing=missing']}>
        <Routes>
          <Route path="/skills/:skillId" element={<SkillDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const backLink = screen.getByRole('link', { name: 'detail.backToList' });
    expect(backLink).toHaveAttribute('href', '/skills?q=beta&status=enabled&missing=missing');
    expect(screen.getByTestId('skill-detail-content')).toBeInTheDocument();
  });

  it('keeps the marketplace query state on the detail page back link', () => {
    render(
      <MemoryRouter initialEntries={['/skills/beta?marketplace=1&q=beta']}>
        <Routes>
          <Route path="/skills/:skillId" element={<SkillDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const backLink = screen.getByRole('link', { name: 'detail.backToList' });
    expect(backLink).toHaveAttribute('href', '/skills?marketplace=1&q=beta');
    expect(screen.getByTestId('skill-detail-content')).toBeInTheDocument();
  });

  it('does not crash when the skills snapshot is not an array on the detail page', () => {
    skillsState.skills = {} as unknown as SkillSnapshot[];

    render(
      <MemoryRouter initialEntries={['/skills/beta?q=beta']}>
        <Routes>
          <Route path="/skills/:skillId" element={<SkillDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('skill-detail-content')).toBeInTheDocument();
  });
});
