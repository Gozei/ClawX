import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { useSkillsStore } from '@/stores/skills';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { SkillSnapshot } from '@/types/skill';
import { skillIconControlClasses } from './components/constants';
import { SkillList } from './components/SkillList';
import { SkillDetailContent } from './components/SkillDetailContent';
import { SkillMarketplaceSheet } from './components/SkillMarketplaceSheet';
import { SkillsToolbar } from './components/SkillsToolbar';
import { useSkillFilters } from './hooks/useSkillFilters';
import { type MissingFilter, type SkillSourceCategory, type StatusFilter } from './filters';

const DEFAULT_QUERY = '';
const DEFAULT_SOURCE_CATEGORY: SkillSourceCategory = 'all';
const DEFAULT_STATUS_FILTER: StatusFilter = 'all';
const DEFAULT_MISSING_FILTER: MissingFilter = 'all';
let lastSkillsListSearchSnapshot = '';

function readEnumParam<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  if (value && allowed.includes(value as T)) {
    return value as T;
  }
  return fallback;
}

function buildSkillsSearchParams(options: {
  query: string;
  sourceCategory: SkillSourceCategory;
  statusFilter: StatusFilter;
  missingFilter: MissingFilter;
}) {
  const params = new URLSearchParams();
  const normalizedQuery = options.query.trim();
  if (normalizedQuery) params.set('q', normalizedQuery);
  if (options.sourceCategory !== DEFAULT_SOURCE_CATEGORY) params.set('source', options.sourceCategory);
  if (options.statusFilter !== DEFAULT_STATUS_FILTER) params.set('status', options.statusFilter);
  if (options.missingFilter !== DEFAULT_MISSING_FILTER) params.set('missing', options.missingFilter);
  return params;
}

export function Skills() {
  const { t } = useTranslation('skills');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    skills,
    loading,
    error,
    fetchSkills,
    enableSkill,
    disableSkill,
    searchResults,
    searching,
    searchingMore,
    searchError,
    searchSkills,
    loadMoreSearchResults,
    installSkill,
    uninstallSkill,
    installing,
    sources,
    fetchSources,
    marketInstalledSkills,
    fetchMarketInstalledSkills,
  } = useSkillsStore();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const query = searchParams.get('q') ?? DEFAULT_QUERY;
  const [installOpen, setInstallOpen] = useState(false);
  const [installQuery, setInstallQuery] = useState('');
  const [installSourceId, setInstallSourceId] = useState('');
  const effectiveInstallSourceId = installSourceId || sources[0]?.id || '';
  const sourceCategory = readEnumParam(
    searchParams.get('source'),
    ['all', 'builtin', 'market', 'other'] as const,
    DEFAULT_SOURCE_CATEGORY,
  );
  const statusFilter = readEnumParam(
    searchParams.get('status'),
    ['all', 'enabled', 'disabled'] as const,
    DEFAULT_STATUS_FILTER,
  );
  const missingFilter = readEnumParam(
    searchParams.get('missing'),
    ['all', 'missing', 'clean'] as const,
    DEFAULT_MISSING_FILTER,
  );

  const updateListState = useCallback((updates: Partial<{
    query: string;
    sourceCategory: SkillSourceCategory;
    statusFilter: StatusFilter;
    missingFilter: MissingFilter;
  }>) => {
    const nextParams = buildSkillsSearchParams({
      query: updates.query ?? query,
      sourceCategory: updates.sourceCategory ?? sourceCategory,
      statusFilter: updates.statusFilter ?? statusFilter,
      missingFilter: updates.missingFilter ?? missingFilter,
    });
    setSearchParams(nextParams, { replace: true });
  }, [missingFilter, query, setSearchParams, sourceCategory, statusFilter]);

  useEffect(() => {
    const currentListSearch = buildSkillsSearchParams({
      query,
      sourceCategory,
      statusFilter,
      missingFilter,
    }).toString();

    if (currentListSearch) {
      lastSkillsListSearchSnapshot = currentListSearch;
      return;
    }

    if (lastSkillsListSearchSnapshot) {
      setSearchParams(lastSkillsListSearchSnapshot, { replace: true });
    }
  }, [missingFilter, query, setSearchParams, sourceCategory, statusFilter]);

  useEffect(() => {
    if (gatewayStatus.state === 'running') void fetchSkills(true);
  }, [fetchSkills, gatewayStatus.state]);

  useEffect(() => {
    void fetchSources();
  }, [fetchSources]);

  useEffect(() => {
    if (!installOpen) return;
    void fetchMarketInstalledSkills();
  }, [fetchMarketInstalledSkills, installOpen]);

  useEffect(() => {
    if (!installOpen || !effectiveInstallSourceId) return;
    const normalizedQuery = installQuery.trim();

    if (!normalizedQuery) {
      void searchSkills('', effectiveInstallSourceId);
      return;
    }

    const timer = setTimeout(() => {
      void searchSkills(normalizedQuery, effectiveInstallSourceId);
    }, 300);
    return () => clearTimeout(timer);
  }, [effectiveInstallSourceId, installOpen, installQuery, searchSkills]);

  const { sourceCounts, filteredSkills, activeFilterCount } = useSkillFilters({
    skills,
    sources,
    query,
    sourceCategory,
    statusFilter,
    missingFilter,
  });
  const sourceOptions: Array<{ id: SkillSourceCategory; label: string; count: number }> = [
    { id: 'all', label: t('toolbar.sources.all'), count: sourceCounts.all },
    { id: 'builtin', label: t('toolbar.sources.builtin'), count: sourceCounts.builtin },
    { id: 'market', label: t('toolbar.sources.market'), count: sourceCounts.market },
    { id: 'other', label: t('toolbar.sources.other'), count: sourceCounts.other },
  ];
  const listSearch = useMemo(() => {
    const value = buildSkillsSearchParams({
      query,
      sourceCategory,
      statusFilter,
      missingFilter,
    }).toString();
    return value ? `?${value}` : '';
  }, [missingFilter, query, sourceCategory, statusFilter]);
  const onToggle = useCallback(async (skill: SkillSnapshot, enabled: boolean) => {
    try {
      if (enabled) await enableSkill(skill.id);
      else await disableSkill(skill.id);
    } catch (error) {
      toast.error(String(error));
    }
  }, [disableSkill, enableSkill]);

  const onInstall = useCallback(async (slug: string, version?: string, sourceId?: string, force = false) => {
    try {
      await installSkill(slug, version, sourceId, force);
      await enableSkill(slug);
      toast.success(t('toast.installed'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [enableSkill, installSkill, t]);

  const onMarketplaceUninstall = useCallback(async (slug: string, sourceId?: string) => {
    try {
      await uninstallSkill(slug, sourceId);
      toast.success(t('toast.uninstalled'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [t, uninstallSkill]);

  if (loading) {
    return <div data-testid="skills-page" className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <div data-testid="skills-page" className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          titleTestId="skills-page-title"
          subtitleTestId="skills-page-subtitle"
          actions={(
            <>
              <Button
                data-testid="skills-discover-button"
                variant="ghost"
                size="icon"
                aria-label={t('actions.discover')}
                onClick={() => {
                  if (!effectiveInstallSourceId && sources.length > 0) {
                    setInstallSourceId(sources[0]?.id || '');
                  }
                  setInstallOpen(true);
                }}
                className={cn(skillIconControlClasses, 'h-14 w-14 border-0 bg-transparent text-[#223047] hover:bg-transparent dark:text-white dark:hover:bg-transparent')}
              >
                <Plus className="h-10 w-10" />
              </Button>
            </>
          )}
        />

        <section className="shrink-0 pb-6">
          <SkillsToolbar
            query={query}
            onQueryChange={(value) => updateListState({ query: value })}
            sourceOptions={sourceOptions}
            sourceCategory={sourceCategory}
            onSourceCategoryChange={(value) => updateListState({ sourceCategory: value })}
            statusFilter={statusFilter}
            onStatusFilterChange={(value) => updateListState({ statusFilter: value })}
            missingFilter={missingFilter}
            onMissingFilterChange={(value) => updateListState({ missingFilter: value })}
            activeFilterCount={activeFilterCount}
            onResetFilters={() => updateListState({
              sourceCategory: DEFAULT_SOURCE_CATEGORY,
              statusFilter: DEFAULT_STATUS_FILTER,
              missingFilter: DEFAULT_MISSING_FILTER,
            })}
          />
        </section>

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">

          {error && (
            <div className="mt-6 flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm font-medium text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <section>
            <SkillList
              skills={filteredSkills}
              onSelect={(skillId) => navigate(`/skills/${encodeURIComponent(skillId)}${listSearch}`)}
              onToggle={(skill, enabled) => void onToggle(skill, enabled)}
            />
          </section>
        </div>
      </div>

      <SkillMarketplaceSheet
        open={installOpen}
        onOpenChange={setInstallOpen}
        installQuery={installQuery}
        onInstallQueryChange={setInstallQuery}
        installSourceId={effectiveInstallSourceId}
        onInstallSourceIdChange={setInstallSourceId}
        sources={sources}
        searchError={searchError}
        searching={searching}
        searchingMore={searchingMore}
        searchResults={searchResults}
        installedSkills={marketInstalledSkills}
        installing={installing}
        onLoadMore={() => void loadMoreSearchResults(installQuery.trim(), effectiveInstallSourceId)}
        onInstall={(slug, version, sourceId, force) => void onInstall(slug, version, sourceId, force)}
        onUninstall={(slug, sourceId) => void onMarketplaceUninstall(slug, sourceId)}
      />
    </div>
  );
}

export function SkillDetailPage() {
  const { t } = useTranslation('skills');
  const navigate = useNavigate();
  const location = useLocation();
  const { skillId } = useParams<{ skillId: string }>();
  const { fetchSkills, fetchSkillDetail, skillDetailsById, detailLoadingId, loading, skills } = useSkillsStore();
  const decodedSkillId = skillId ? decodeURIComponent(skillId) : '';
  const detail = decodedSkillId ? skillDetailsById[decodedSkillId] : undefined;
  const detailLoading = Boolean(decodedSkillId) && detailLoadingId === decodedSkillId && !detail;
  const summary = skills.find((skill) => skill.id === decodedSkillId);
  const backToListHref = `/skills${location.search}`;

  useEffect(() => {
    void fetchSkills();
  }, [fetchSkills]);

  useEffect(() => {
    if (!decodedSkillId) return;
    void fetchSkillDetail(decodedSkillId, true).catch((error) => toast.error(String(error)));
  }, [decodedSkillId, fetchSkillDetail]);

  if (loading || detailLoading) {
    return <div data-testid="skills-detail-page" className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  if (!decodedSkillId || !detail) {
    return (
      <div data-testid="skills-detail-page" className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)]">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col p-10 pt-16">
          <PageHeader
            title={summary?.name || t('detail.notFoundTitle')}
            subtitle={t('detail.notFoundSubtitle')}
            titleTestId="skills-detail-page-title"
            actions={(
              <Button variant="outline" onClick={() => navigate(backToListHref)} className="rounded-full">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('detail.backToList')}
              </Button>
            )}
          />
        </div>
      </div>
    );
  }

  return (
    <div data-testid="skills-detail-page" className="flex flex-col -m-6 min-h-[calc(100vh-2.5rem)] bg-[#f6f7fb] dark:bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col p-6 pt-4 pb-10">
        <div className="mb-4 flex justify-end">
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="h-10 w-10 rounded-full text-slate-500 hover:bg-white hover:text-slate-700 dark:text-white/60 dark:hover:bg-white/[0.05] dark:hover:text-white"
          >
            <Link to={backToListHref} aria-label={t('detail.backToList')}>
              <X className="h-5 w-5" />
            </Link>
          </Button>
        </div>
        <SkillDetailContent detail={detail} onDeleted={() => navigate(backToListHref)} />
      </div>
    </div>
  );
}

export default Skills;
