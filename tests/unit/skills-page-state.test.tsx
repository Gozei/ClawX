import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SkillDetailPage, Skills } from '../../src/pages/Skills';
import type { SkillDetail, SkillSnapshot, SkillSource } from '../../src/types/skill';

const fetchSkillsMock = vi.fn();
const fetchSkillDetailMock = vi.fn();
const enableSkillMock = vi.fn();
const disableSkillMock = vi.fn();
const searchSkillsMock = vi.fn();
const installSkillMock = vi.fn();
const uninstallSkillMock = vi.fn();
const fetchSourcesMock = vi.fn();

const { gatewayState, skillsState } = vi.hoisted(() => ({
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
    skillDetailsById: {} as Record<string, SkillDetail>,
    detailLoadingId: null as string | null,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/skills', () => ({
  useSkillsStore: (selector?: (state: typeof skillsState & {
    fetchSkills: typeof fetchSkillsMock;
    fetchSkillDetail: typeof fetchSkillDetailMock;
    enableSkill: typeof enableSkillMock;
    disableSkill: typeof disableSkillMock;
    searchSkills: typeof searchSkillsMock;
    installSkill: typeof installSkillMock;
    uninstallSkill: typeof uninstallSkillMock;
    fetchSources: typeof fetchSourcesMock;
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
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
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

vi.mock('../../src/pages/Skills/components/SkillMarketplaceSheet', () => ({
  SkillMarketplaceSheet: () => null,
}));

vi.mock('../../src/pages/Skills/components/SkillDetailContent', () => ({
  SkillDetailContent: () => <div data-testid="skill-detail-content" />,
}));

describe('Skills page route state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      { id: 'local', label: 'Local', workdir: 'C:/Users/test/.codex/skills/local' } as SkillSource,
    ];
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
    fetchSourcesMock.mockResolvedValue(undefined);
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
});
