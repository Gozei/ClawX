import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Search, Store, X } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { pagePrimaryInputClasses } from '@/components/layout/page-tokens';
import { cn } from '@/lib/utils';
import { useSkillsStore } from '@/stores/skills';
import { useGatewayStore } from '@/stores/gateway';
import { toast } from 'sonner';
import type { SkillSnapshot } from '@/types/skill';
import { SkillList } from './components/SkillList';
import { SkillDetailContent } from './components/SkillDetailContent';
import { SkillMarketplaceDetailContent } from './components/SkillMarketplaceDetailContent';
import { SkillMarketplaceSheet } from './components/SkillMarketplaceSheet';
import { SkillsToolbar } from './components/SkillsToolbar';
import { useSkillFilters } from './hooks/useSkillFilters';
import { resolveInstalledSkillId } from './marketplace-state';
import { type MissingFilter, type SkillSourceCategory, type StatusFilter } from './filters';

const DEFAULT_QUERY = '';
const DEFAULT_SOURCE_CATEGORY: SkillSourceCategory = 'all';
const DEFAULT_STATUS_FILTER: StatusFilter = 'all';
const DEFAULT_MISSING_FILTER: MissingFilter = 'all';
const SKILLS_TUTORIAL_URL = 'https://docs.qq.com/aio/p/scchzbdpjgz9ho4?p=sGkmem2WlWWvi4rh4PDslN';

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
  marketplaceOpen?: boolean;
}) {
  const params = new URLSearchParams();
  const normalizedQuery = options.query.trim();
  if (normalizedQuery) params.set('q', normalizedQuery);
  if (options.sourceCategory !== DEFAULT_SOURCE_CATEGORY) params.set('source', options.sourceCategory);
  if (options.statusFilter !== DEFAULT_STATUS_FILTER) params.set('status', options.statusFilter);
  if (options.missingFilter !== DEFAULT_MISSING_FILTER) params.set('missing', options.missingFilter);
  if (options.marketplaceOpen) params.set('marketplace', '1');
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
    marketplaceSourceCounts,
    fetchMarketplaceSourceCounts,
    marketInstalledSkills,
    fetchMarketInstalledSkills,
    marketplaceSkillDetailsByKey,
    marketplaceDetailLoadingKey,
    fetchMarketplaceSkillDetail,
  } = useSkillsStore();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const hasRequestedInitialSkillsRef = useRef(false);
  const previousGatewayStateRef = useRef(gatewayStatus.state);
  const shouldRetrySkillsWhenGatewayReadyRef = useRef(gatewayStatus.state !== 'running');
  const hasRetriedSkillsWhenGatewayReadyRef = useRef(false);
  const query = searchParams.get('q') ?? DEFAULT_QUERY;
  const installOpen = searchParams.get('marketplace') === '1';
  const [installQuery, setInstallQuery] = useState('');
  const [installSourceId, setInstallSourceId] = useState('');
  const [selectedMarketplaceSkill, setSelectedMarketplaceSkill] = useState<{ slug: string; sourceId?: string } | null>(null);
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
      marketplaceOpen: installOpen,
    });
    setSearchParams(nextParams, { replace: true });
  }, [installOpen, missingFilter, query, setSearchParams, sourceCategory, statusFilter]);

  const setMarketplaceOpen = useCallback((open: boolean) => {
    const nextParams = buildSkillsSearchParams({
      query,
      sourceCategory,
      statusFilter,
      missingFilter,
      marketplaceOpen: open,
    });
    setSearchParams(nextParams, { replace: true });
  }, [missingFilter, query, setSearchParams, sourceCategory, statusFilter]);

  useEffect(() => {
    if (hasRequestedInitialSkillsRef.current) return;
    hasRequestedInitialSkillsRef.current = true;
    void fetchSkills();
  }, [fetchSkills]);

  const safeSkills = Array.isArray(skills) ? skills.filter((skill): skill is SkillSnapshot => Boolean(skill)) : [];
  const shouldShowGatewayWarning = gatewayStatus.state !== 'running';

  useEffect(() => {
    const previousGatewayState = previousGatewayStateRef.current;
    previousGatewayStateRef.current = gatewayStatus.state;

    if (safeSkills.length > 0) {
      shouldRetrySkillsWhenGatewayReadyRef.current = false;
      return;
    }

    if (gatewayStatus.state !== 'running') {
      if (hasRequestedInitialSkillsRef.current && !hasRetriedSkillsWhenGatewayReadyRef.current) {
        shouldRetrySkillsWhenGatewayReadyRef.current = true;
      }
      return;
    }

    const becameRunning = previousGatewayState !== 'running';
    if (!becameRunning || !shouldRetrySkillsWhenGatewayReadyRef.current || hasRetriedSkillsWhenGatewayReadyRef.current) {
      return;
    }

    shouldRetrySkillsWhenGatewayReadyRef.current = false;
    hasRetriedSkillsWhenGatewayReadyRef.current = true;
    void fetchSkills();
  }, [fetchSkills, gatewayStatus.state, safeSkills.length]);

  useEffect(() => {
    void fetchSources();
  }, [fetchSources]);

  useEffect(() => {
    if (!installOpen || sources.length === 0) return;
    void fetchMarketplaceSourceCounts(true);
  }, [fetchMarketplaceSourceCounts, installOpen, sources.length]);

  useEffect(() => {
    if (!installOpen) return;
    void fetchMarketInstalledSkills();
  }, [fetchMarketInstalledSkills, installOpen]);

  useEffect(() => {
    if (!installOpen) {
      setSelectedMarketplaceSkill(null);
    }
  }, [installOpen]);

  useEffect(() => {
    if (!installOpen || !selectedMarketplaceSkill) return;
    void fetchMarketplaceSkillDetail(
      selectedMarketplaceSkill.slug,
      selectedMarketplaceSkill.sourceId,
    ).catch((error) => toast.error(String(error)));
  }, [fetchMarketplaceSkillDetail, installOpen, selectedMarketplaceSkill]);

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
    skills: safeSkills,
    sources,
    query,
    sourceCategory,
    statusFilter,
    missingFilter,
  });
  const shouldShowEmptySkillList = filteredSkills.length > 0 || !shouldShowGatewayWarning || safeSkills.length > 0;
  const sourceOptions: Array<{ id: SkillSourceCategory; label: string; count: number }> = [
    { id: 'all', label: t('toolbar.sources.all'), count: sourceCounts.all },
    { id: 'builtin', label: t('toolbar.sources.builtin'), count: sourceCounts.builtin },
    { id: 'market', label: t('toolbar.sources.market'), count: sourceCounts.market },
    { id: 'other', label: t('toolbar.sources.other'), count: sourceCounts.other },
  ];
  const marketplaceSourceOptions = useMemo(() => sources.map((source) => ({
    id: source.id,
    label: source.label,
    count: marketplaceSourceCounts[source.id] ?? null,
  })), [marketplaceSourceCounts, sources]);
  const listSearch = useMemo(() => {
    const value = buildSkillsSearchParams({
      query,
      sourceCategory,
      statusFilter,
      missingFilter,
      marketplaceOpen: installOpen,
    }).toString();
    return value ? `?${value}` : '';
  }, [installOpen, missingFilter, query, sourceCategory, statusFilter]);
  const onToggle = useCallback(async (skill: SkillSnapshot, enabled: boolean) => {
    try {
      if (enabled) await enableSkill(skill.id);
      else await disableSkill(skill.id);
    } catch (error) {
      toast.error(String(error));
    }
  }, [disableSkill, enableSkill]);

  const onInstall = useCallback(async (slug: string, version?: string, sourceId?: string, force = false) => {
    const skillName = searchResults.find((skill) => skill.slug === slug && skill.sourceId === sourceId)?.name;
    try {
      await installSkill(slug, version, sourceId, force);
      const refreshedSkills = useSkillsStore.getState().skills ?? [];
      const installedSkillId = resolveInstalledSkillId(slug, refreshedSkills, sourceId);
      await enableSkill(installedSkillId);
      toast.success(t('marketplace.installSuccessDescription', {
        skill: skillName || slug,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [enableSkill, installSkill, searchResults, t]);

  const onSelectMarketplaceSkill = useCallback((slug: string, sourceId?: string) => {
    setSelectedMarketplaceSkill({ slug, sourceId });
  }, []);
  const selectedMarketplaceSkillKey = selectedMarketplaceSkill
    ? (selectedMarketplaceSkill.sourceId
      ? `${selectedMarketplaceSkill.sourceId}:${selectedMarketplaceSkill.slug}`
      : selectedMarketplaceSkill.slug)
    : '';
  const selectedMarketplaceSkillDetail = selectedMarketplaceSkillKey
    ? marketplaceSkillDetailsByKey[selectedMarketplaceSkillKey] ?? null
    : null;
  const selectedMarketplaceSkillLoading = Boolean(selectedMarketplaceSkillKey)
    && marketplaceDetailLoadingKey === selectedMarketplaceSkillKey
    && !selectedMarketplaceSkillDetail;
  const marketplaceDetailOpen = installOpen && Boolean(selectedMarketplaceSkill);

  const onMarketplaceUninstall = useCallback(async (slug: string, sourceId?: string) => {
    const skillName = searchResults.find((skill) => skill.slug === slug && skill.sourceId === sourceId)?.name || slug;
    try {
      await uninstallSkill(slug, sourceId);
      toast.success(t('marketplace.uninstallSuccessDescription', {
        skill: skillName,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [searchResults, t, uninstallSkill]);

  const onOpenTutorial = useCallback(() => {
    void window.electron?.openExternal?.(SKILLS_TUTORIAL_URL);
  }, []);

  if (loading) {
    return <div data-testid="skills-page" className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <div
      data-testid="skills-page"
      className={cn(
        'flex flex-col -m-6 h-[calc(100vh-2.5rem)] overflow-hidden dark:bg-background',
        marketplaceDetailOpen && 'bg-[#f5f7fb] dark:bg-background',
      )}
    >
      <div
        className={cn(
          'w-full mx-auto flex flex-col h-full',
          marketplaceDetailOpen
            ? 'max-w-6xl p-6 pt-4 pb-10'
            : installOpen
              ? 'max-w-[1320px] p-10 pt-16'
              : 'max-w-5xl p-10 pt-16',
        )}
      >
        {!marketplaceDetailOpen && (
          <>
            <PageHeader
              title={installOpen ? t('marketplace.title') : t('title')}
              subtitle={installOpen ? t('marketplace.subtitle') : t('subtitle')}
              titleTestId="skills-page-title"
              subtitleTestId="skills-page-subtitle"
              actions={(
                <>
                  <Button
                    data-testid="skills-tutorial-button"
                    aria-label={t('actions.tutorial')}
                    onClick={onOpenTutorial}
                    variant="outline"
                    className="h-10 rounded-lg px-4 text-[13px] font-medium border-[#d4dceb] bg-white text-[#223047] shadow-none hover:bg-[#f3f6fb] dark:border-white/10 dark:bg-transparent dark:text-white dark:hover:bg-white/6"
                  >
                    <BookOpen className="mr-2 h-3.5 w-3.5" />
                    {t('actions.tutorial')}
                  </Button>
                  <Button
                    data-testid="skills-discover-button"
                    data-guide-id="skills-marketplace"
                    aria-label={installOpen ? t('actions.backToSkills') : t('actions.marketplace')}
                    onClick={() => {
                      if (installOpen) {
                        setMarketplaceOpen(false);
                        return;
                      }
                      if (!effectiveInstallSourceId && sources.length > 0) {
                        setInstallSourceId(sources[0]?.id || '');
                      }
                      setMarketplaceOpen(true);
                    }}
                    className={cn(
                      'h-10 rounded-lg px-4 text-[13px] font-medium shadow-none',
                      installOpen
                        ? 'border border-primary/15 bg-primary/10 text-primary hover:bg-primary/14 dark:border-primary/20 dark:bg-primary/12'
                        : ''
                    )}
                  >
                    <Store className="mr-2 h-3.5 w-3.5" />
                    {installOpen ? t('actions.backToSkills') : t('actions.marketplace')}
                  </Button>
                </>
              )}
            />

            <section className="shrink-0 pb-6">
              {installOpen ? (
                <div data-testid="skills-marketplace-toolbar" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
                  <div className="relative min-w-0">
                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      data-testid="skills-marketplace-search-input"
                      value={installQuery}
                      onChange={(event) => setInstallQuery(event.target.value)}
                      className={cn(pagePrimaryInputClasses, 'border-[#d6deea] bg-white pl-10 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:border-white/12 dark:bg-transparent')}
                      placeholder={t('searchMarketplace')}
                    />
                  </div>

                  <div className="min-w-0">
                    <div className="grid min-w-0 auto-cols-fr grid-flow-col items-center gap-x-0.5" data-testid="skills-marketplace-source-tabs">
                      {marketplaceSourceOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setInstallSourceId(option.id)}
                          className={cn(
                            'relative min-w-0 border-0 bg-transparent px-2 pb-3 pt-1 text-[14px] font-semibold leading-none shadow-none outline-none transition-colors',
                            effectiveInstallSourceId === option.id
                              ? 'text-[#0f172a] dark:text-white'
                              : 'text-[#415168] hover:text-[#243247] dark:text-white/58 dark:hover:text-white/82'
                          )}
                          data-testid={`skills-marketplace-source-tab-${option.id}`}
                        >
                          <span className="flex items-center justify-center gap-1 whitespace-nowrap">
                            <span className="truncate">{option.label}</span>
                            <span
                              className={cn(
                                'text-[11px] font-semibold leading-none',
                                effectiveInstallSourceId === option.id ? 'text-primary/70 dark:text-primary-foreground/72' : 'text-[#607089] dark:text-white/44'
                              )}
                            >
                              {typeof option.count === 'number' ? option.count.toLocaleString() : '...'}
                            </span>
                          </span>
                          <span
                            className={cn(
                              'absolute bottom-0 left-1/2 h-[2px] -translate-x-1/2 rounded-full transition-all',
                              effectiveInstallSourceId === option.id ? 'w-[64px] bg-primary' : 'w-0 bg-transparent'
                            )}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
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
              )}
            </section>
          </>
        )}

        <div className={cn('flex-1 min-h-0 overflow-y-auto', marketplaceDetailOpen ? '' : 'pb-10 pr-2 -mr-2')}>
          {installOpen ? (
            marketplaceDetailOpen && selectedMarketplaceSkill ? (
              <div data-testid="skills-marketplace-detail-page" className="flex min-h-full flex-col">
                <div className="mb-4 flex justify-end">
                  <Button
                    data-testid="skills-marketplace-detail-close"
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelectedMarketplaceSkill(null)}
                    className="h-10 w-10 rounded-full text-slate-500 hover:bg-white hover:text-slate-700 dark:text-white/60 dark:hover:bg-white/[0.05] dark:hover:text-white"
                    aria-label={t('detail.backToList')}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
                {selectedMarketplaceSkillLoading && !selectedMarketplaceSkillDetail ? (
                  <div className="flex flex-1 items-center justify-center">
                    <LoadingSpinner size="lg" />
                  </div>
                ) : selectedMarketplaceSkillDetail ? (
                  <SkillMarketplaceDetailContent
                    detail={selectedMarketplaceSkillDetail}
                    installedSkills={marketInstalledSkills}
                    skills={safeSkills}
                    sources={sources}
                    sourceId={selectedMarketplaceSkill.sourceId}
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center text-center text-muted-foreground">
                    <div>
                      <AlertCircle className="mx-auto mb-4 h-10 w-10 opacity-50" />
                      <p>{t('marketplace.detailUnavailable', { defaultValue: 'Detail unavailable.' })}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <SkillMarketplaceSheet
                open={installOpen}
                installQuery={installQuery}
                sources={sources}
                skills={safeSkills}
                searchError={searchError}
                searching={searching}
                searchingMore={searchingMore}
                searchResults={searchResults}
                installedSkills={marketInstalledSkills}
                installing={installing}
                selectedMarketplaceSkill={selectedMarketplaceSkill}
                onLoadMore={() => void loadMoreSearchResults(installQuery.trim(), effectiveInstallSourceId)}
                onInstall={(slug, version, sourceId, force) => void onInstall(slug, version, sourceId, force)}
                onUninstall={(slug, sourceId) => void onMarketplaceUninstall(slug, sourceId)}
                onSelectMarketplaceSkill={onSelectMarketplaceSkill}
              />
            )
          ) : (
            <>
              {shouldShowGatewayWarning && (
                <div
                  data-testid="skills-gateway-warning"
                  className="mb-8 flex items-center gap-3 rounded-xl border border-yellow-500/50 bg-yellow-500/10 p-4"
                >
                  <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                  <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                    {t('gatewayWarning')}
                  </span>
                </div>
              )}

              {error && (
                <div className="mt-6 flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm font-medium text-destructive">
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <section>
                {shouldShowEmptySkillList ? (
                  <SkillList
                    skills={filteredSkills}
                    onSelect={(skillId) => navigate(`/skills/${encodeURIComponent(skillId)}${listSearch}`)}
                    onToggle={(skill, enabled) => void onToggle(skill, enabled)}
                  />
                ) : null}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function SkillDetailPage() {
  const { t } = useTranslation('skills');
  const navigate = useNavigate();
  const location = useLocation();
  const { skillId } = useParams<{ skillId: string }>();
  const { fetchSkills, fetchSkillDetail, skillDetailsById, detailLoadingId, loading, skills } = useSkillsStore();
  const isGatewayRunning = useGatewayStore((state) => state.status.state === 'running');
  const decodedSkillId = skillId ? decodeURIComponent(skillId) : '';
  const detail = decodedSkillId ? skillDetailsById[decodedSkillId] : undefined;
  const detailLoading = Boolean(decodedSkillId) && detailLoadingId === decodedSkillId && !detail;
  const safeSkills = Array.isArray(skills) ? skills.filter((skill): skill is SkillSnapshot => Boolean(skill)) : [];
  const summary = safeSkills.find((skill) => skill.id === decodedSkillId);
  const backToListHref = `/skills${location.search}`;

  useEffect(() => {
    if (!isGatewayRunning) return;
    void fetchSkills();
  }, [fetchSkills, isGatewayRunning]);

  useEffect(() => {
    if (!decodedSkillId) return;
    if (!isGatewayRunning) return;
    void fetchSkillDetail(decodedSkillId, true).catch((error) => toast.error(String(error)));
  }, [decodedSkillId, fetchSkillDetail, isGatewayRunning]);

  if (loading || detailLoading) {
    return <div data-testid="skills-detail-page" className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  if (!decodedSkillId || !detail) {
    return (
      <div data-testid="skills-detail-page" className="flex flex-col -m-6 bg-[#f5f7fb] dark:bg-background min-h-[calc(100vh-2.5rem)]">
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
    <div data-testid="skills-detail-page" className="flex flex-col -m-6 min-h-[calc(100vh-2.5rem)] bg-[#f5f7fb] dark:bg-background">
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
