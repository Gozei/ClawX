import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SkillDetailPage, Skills } from '../../src/pages/Skills';
import type { MarketplaceSkillDetail, SkillDetail, SkillSnapshot, SkillSource } from '../../src/types/skill';

const fetchSkillsMock = vi.fn();
const fetchSkillDetailMock = vi.fn();
const fetchMarketplaceSkillDetailMock = vi.fn();
const enableSkillMock = vi.fn();
const disableSkillMock = vi.fn();
const searchSkillsMock = vi.fn();
const installSkillMock = vi.fn();
const uninstallSkillMock = vi.fn();
const fetchSourcesMock = vi.fn();
const fetchMarketplaceSourceCountsMock = vi.fn();
const fetchMarketInstalledSkillsMock = vi.fn();
const loadMoreSearchResultsMock = vi.fn();

const { gatewayState, skillsState, marketplaceSheetState, toastMocks } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running' as const },
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
    marketplaceSkillDetailsByKey: {} as Record<string, MarketplaceSkillDetail>,
    marketplaceDetailLoadingKey: null as string | null,
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

vi.mock('@/stores/skills', () => ({
  useSkillsStore: Object.assign((selector?: (state: typeof skillsState & {
    fetchSkills: typeof fetchSkillsMock;
    fetchSkillDetail: typeof fetchSkillDetailMock;
    fetchMarketplaceSkillDetail: typeof fetchMarketplaceSkillDetailMock;
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
      fetchMarketplaceSkillDetail: fetchMarketplaceSkillDetailMock,
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
      fetchMarketplaceSkillDetail: fetchMarketplaceSkillDetailMock,
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
    return props.open ? <div data-testid="skills-marketplace-panel" /> : null;
  },
}));

vi.mock('../../src/pages/Skills/components/SkillDetailContent', () => ({
  SkillDetailContent: () => <div data-testid="skill-detail-content" />,
}));

describe('Skills page route state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayState.status.state = 'running';
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
    fetchMarketplaceSkillDetailMock.mockResolvedValue(undefined);
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

  it('fetches marketplace source counts only after opening the marketplace', async () => {
    render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(fetchSourcesMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMarketplaceSourceCountsMock).not.toHaveBeenCalled();

    await act(async () => {
      screen.getByTestId('skills-discover-button').click();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchMarketplaceSourceCountsMock).toHaveBeenCalledTimes(1);
    });
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

  it('shows a marketplace success CTA and opens the marketplace detail page in place', async () => {
    render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );

    await act(async () => {
      screen.getByTestId('skills-discover-button').click();
      await Promise.resolve();
    });

    expect((marketplaceSheetState.latestProps as { open?: boolean } | null)?.open).toBe(true);
    expect(screen.getByTestId('skills-marketplace-panel')).toBeInTheDocument();

    const marketplaceProps = marketplaceSheetState.latestProps as null | {
      onInstall?: (slug: string, version?: string, sourceId?: string, force?: boolean) => void;
      onSelectMarketplaceSkill?: (slug: string, sourceId?: string) => void;
    };

    expect(marketplaceProps?.onInstall).toBeTypeOf('function');

    await act(async () => {
      marketplaceProps?.onInstall?.('beta', '1.0.0', 'clawhub', false);
      await Promise.resolve();
    });

    expect(installSkillMock).toHaveBeenCalledWith('beta', '1.0.0', 'clawhub', false);
    expect(enableSkillMock).toHaveBeenCalledWith('beta');
    expect(toastMocks.success).toHaveBeenCalledWith('marketplace.installSuccessDescription');

    const updatedMarketplaceProps = marketplaceSheetState.latestProps as null | {
      onSelectMarketplaceSkill?: (slug: string, sourceId?: string) => void;
    };

    await act(async () => {
      updatedMarketplaceProps?.onSelectMarketplaceSkill?.('beta', 'clawhub');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchMarketplaceSkillDetailMock).toHaveBeenCalledWith('beta', 'clawhub');
    });
    expect(screen.getByTestId('skills-marketplace-detail-page')).toBeInTheDocument();
    expect(screen.getByTestId('skills-marketplace-detail-close')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-marketplace-panel')).not.toBeInTheDocument();
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
