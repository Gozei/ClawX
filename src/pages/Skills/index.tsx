import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useSkillsStore } from '@/stores/skills';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { SkillSnapshot, SkillSource } from '@/types/skill';
import { skillCompactControlClasses, skillIconControlClasses, skillPrimaryControlClasses, skillPrimaryInputClasses } from './components/constants';
import { SkillList } from './components/SkillList';
import { SkillDetailPanel } from './components/SkillDetailPanel';
import { SkillMarketplaceSheet } from './components/SkillMarketplaceSheet';

type SkillSourceCategory = 'all' | 'builtin' | 'market' | 'other';
type StatusFilter = 'all' | 'enabled' | 'disabled';
type MissingFilter = 'all' | 'missing' | 'clean';

function normalizePath(value?: string): string {
  return (value || '').replace(/\\/g, '/').toLowerCase();
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function hasMissingRequirements(skill: SkillSnapshot): boolean {
  const missing = skill.missing;
  if (!missing) return false;
  return (missing.bins?.length || 0) > 0
    || (missing.anyBins?.length || 0) > 0
    || (missing.env?.length || 0) > 0
    || (missing.config?.length || 0) > 0
    || (missing.os?.length || 0) > 0;
}

function classifySkillSource(skill: SkillSnapshot, sources: SkillSource[]): SkillSourceCategory {
  const normalizedBaseDir = normalizePath(skill.baseDir);
  const normalizedSource = normalizePath(skill.source);
  const normalizedSourceId = normalizePath(skill.sourceId);
  const normalizedSourceLabel = normalizePath(skill.sourceLabel);
  const combined = [normalizedBaseDir, normalizedSource, normalizedSourceId, normalizedSourceLabel].filter(Boolean).join(' ');

  if (skill.isBundled || includesAny(combined, ['node_modules/openclaw/skills', '/skills/builtin', '/skills/core'])) {
    return 'builtin';
  }

  const sourceByDir = sources.find((source) => {
    const workdir = normalizePath(source.workdir);
    return workdir.length > 0 && normalizedBaseDir.startsWith(workdir);
  });
  const matchedSourceId = sourceByDir?.id || skill.sourceId || (
    includesAny(combined, ['deepaiworker', 'deepskillhub']) ? 'deepaiworker' : (
      includesAny(combined, ['clawhub', 'openclaw-managed']) ? 'clawhub' : undefined
    )
  );

  if (matchedSourceId === 'deepaiworker' || matchedSourceId === 'clawhub') return 'market';
  return 'other';
}

function buildFilterButtonClass(active: boolean): string {
  return active
    ? 'border-[#111827] bg-[#111827] text-white hover:bg-[#1f2937] dark:border-white dark:bg-white dark:text-black dark:hover:bg-white/90'
    : 'border-black/10 bg-transparent text-foreground/75 hover:bg-black/5 dark:border-white/10 dark:text-white/72 dark:hover:bg-white/5';
}

export function Skills() {
  const { t } = useTranslation('skills');
  const {
    skills,
    loading,
    error,
    fetchSkills,
    fetchSkillDetail,
    skillDetailsById,
    detailLoadingId,
    enableSkill,
    disableSkill,
    searchResults,
    searching,
    searchError,
    searchSkills,
    installSkill,
    uninstallSkill,
    installing,
    sources,
    fetchSources,
  } = useSkillsStore();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [query, setQuery] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [installQuery, setInstallQuery] = useState('');
  const [installSourceId, setInstallSourceId] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sourceCategory, setSourceCategory] = useState<SkillSourceCategory>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [missingFilter, setMissingFilter] = useState<MissingFilter>('all');

  useEffect(() => {
    if (gatewayStatus.state === 'running') void fetchSkills(true);
  }, [fetchSkills, gatewayStatus.state]);

  useEffect(() => {
    void fetchSources();
  }, [fetchSources]);

  useEffect(() => {
    if (!selectedSkillId) return;
    void fetchSkillDetail(selectedSkillId).catch((error) => toast.error(String(error)));
  }, [fetchSkillDetail, selectedSkillId]);

  useEffect(() => {
    if (!installOpen) return;
    const timer = setTimeout(() => {
      void searchSkills(installQuery.trim(), installSourceId === 'all' ? undefined : installSourceId);
    }, 300);
    return () => clearTimeout(timer);
  }, [installOpen, installQuery, installSourceId, searchSkills]);

  const sourceCounts = useMemo(() => {
    return skills.reduce<Record<SkillSourceCategory, number>>((acc, skill) => {
      const category = classifySkillSource(skill, sources);
      acc.all += 1;
      acc[category] += 1;
      return acc;
    }, {
      all: 0,
      builtin: 0,
      market: 0,
      other: 0,
    });
  }, [skills, sources]);

  const filteredSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return skills
      .filter((skill) => {
        if (normalized.length > 0 && !`${skill.name} ${skill.description} ${skill.id}`.toLowerCase().includes(normalized)) {
          return false;
        }
        if (sourceCategory !== 'all' && classifySkillSource(skill, sources) !== sourceCategory) {
          return false;
        }
        if (statusFilter === 'enabled' && !skill.enabled) return false;
        if (statusFilter === 'disabled' && skill.enabled) return false;
        const hasMissing = hasMissingRequirements(skill);
        if (missingFilter === 'missing' && !hasMissing) return false;
        if (missingFilter === 'clean' && hasMissing) return false;
        return true;
      })
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  }, [missingFilter, query, skills, sourceCategory, sources, statusFilter]);
  const selectedDetail = selectedSkillId ? skillDetailsById[selectedSkillId] : undefined;
  const detailLoading = Boolean(selectedSkillId) && detailLoadingId === selectedSkillId && !selectedDetail;
  const activeFilterCount = Number(statusFilter !== 'all') + Number(missingFilter !== 'all');
  const sourceOptions: Array<{ id: SkillSourceCategory; label: string; count: number }> = [
    { id: 'all', label: t('toolbar.sources.all'), count: sourceCounts.all },
    { id: 'builtin', label: t('toolbar.sources.builtin'), count: sourceCounts.builtin },
    { id: 'market', label: t('toolbar.sources.market'), count: sourceCounts.market },
    { id: 'other', label: t('toolbar.sources.other'), count: sourceCounts.other },
  ];
  const onToggle = useCallback(async (skill: SkillSnapshot, enabled: boolean) => {
    try {
      if (enabled) await enableSkill(skill.id);
      else await disableSkill(skill.id);
    } catch (error) {
      toast.error(String(error));
    }
  }, [disableSkill, enableSkill]);

  const onInstall = useCallback(async (slug: string, sourceId?: string) => {
    try {
      await installSkill(slug, undefined, sourceId);
      await enableSkill(slug);
      toast.success(t('toast.installed'));
    } catch (error) {
      toast.error(String(error));
    }
  }, [enableSkill, installSkill, t]);

  const onMarketplaceUninstall = useCallback(async (slug: string, sourceId?: string) => {
    try {
      await uninstallSkill(slug, sourceId);
      toast.success(t('toast.uninstalled'));
    } catch (error) {
      toast.error(String(error));
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
                onClick={() => setInstallOpen(true)}
                className={cn(skillIconControlClasses, 'h-14 w-14 border-0 bg-transparent text-[#223047] hover:bg-transparent dark:text-white dark:hover:bg-transparent')}
              >
                <Plus className="h-10 w-10" />
              </Button>
            </>
          )}
        />

        <section className="shrink-0 pb-6">
          <div data-testid="skills-toolbar" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px_auto] lg:items-center">
            <div className="relative min-w-0">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="skills-search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={cn(skillPrimaryInputClasses, 'border-[#d6deea] bg-white pl-10 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:border-white/12 dark:bg-transparent')}
                placeholder={t('search')}
              />
            </div>

            <div className="min-w-0">
              <div className="grid min-w-0 grid-cols-4 items-center gap-x-0.5" data-testid="skills-source-tabs">
                {sourceOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSourceCategory(option.id)}
                    className={cn(
                      'relative min-w-0 border-0 bg-transparent px-2 pb-3 pt-1 text-[14px] font-semibold leading-none shadow-none outline-none transition-colors',
                      sourceCategory === option.id
                        ? 'text-[#0f172a] dark:text-white'
                        : 'text-[#415168] hover:text-[#243247] dark:text-white/58 dark:hover:text-white/82'
                    )}
                    data-testid={`skills-source-tab-${option.id}`}
                  >
                    <span className="flex items-center justify-center gap-1 whitespace-nowrap">
                      <span className="truncate">{option.label}</span>
                      <span
                        className={cn(
                          'text-[11px] font-semibold leading-none',
                          sourceCategory === option.id ? 'text-[#0f172a]/56 dark:text-white/60' : 'text-[#607089] dark:text-white/44'
                        )}
                      >
                        {option.count}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'absolute bottom-0 left-1/2 h-[2px] -translate-x-1/2 rounded-full transition-all',
                        sourceCategory === option.id ? 'w-[64px] bg-[#0f172a] dark:bg-white' : 'w-0 bg-transparent'
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() => setFilterOpen(true)}
              className={cn(skillPrimaryControlClasses, 'justify-self-end shrink-0 border-black/10 bg-transparent text-foreground/80 hover:bg-black/5 dark:border-white/10 dark:text-white/80 dark:hover:bg-white/5')}
              data-testid="skills-filter-button"
            >
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              {activeFilterCount > 0 ? t('toolbar.filtersWithCount', { count: activeFilterCount }) : t('toolbar.filters')}
            </Button>
          </div>
        </section>

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">

          {error && (
            <div className="mt-6 flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm font-medium text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <section>
            <SkillList skills={filteredSkills} onSelect={setSelectedSkillId} onToggle={(skill, enabled) => void onToggle(skill, enabled)} />
          </section>
        </div>
      </div>

      <SkillDetailPanel detail={selectedDetail} loading={detailLoading} onClose={() => setSelectedSkillId(null)} />

      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="right" className="w-full border-l border-black/10 bg-background p-6 dark:border-white/10 dark:bg-card sm:max-w-[420px]" data-testid="skills-filter-sheet">
          <SheetHeader>
            <SheetTitle>{t('toolbar.filters')}</SheetTitle>
            <SheetDescription>{t('toolbar.filtersSubtitle')}</SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            <div>
              <h3 className="mb-3 text-[13px] font-semibold text-foreground/80">{t('toolbar.groups.status')}</h3>
              <div className="flex flex-wrap gap-2">
                {([
                  ['all', t('toolbar.status.all')],
                  ['enabled', t('toolbar.status.enabled')],
                  ['disabled', t('toolbar.status.disabled')],
                ] as Array<[StatusFilter, string]>).map(([value, label]) => (
                  <Button key={value} type="button" variant="outline" onClick={() => setStatusFilter(value)} className={cn(skillCompactControlClasses, buildFilterButtonClass(statusFilter === value))}>
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-[13px] font-semibold text-foreground/80">{t('toolbar.groups.dependencies')}</h3>
              <div className="flex flex-wrap gap-2">
                {([
                  ['all', t('toolbar.missing.all')],
                  ['missing', t('toolbar.missing.missing')],
                  ['clean', t('toolbar.missing.clean')],
                ] as Array<[MissingFilter, string]>).map(([value, label]) => (
                  <Button key={value} type="button" variant="outline" onClick={() => setMissingFilter(value)} className={cn(skillCompactControlClasses, buildFilterButtonClass(missingFilter === value))}>
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStatusFilter('all');
                  setMissingFilter('all');
                }}
                className={cn(skillPrimaryControlClasses, 'border-black/10 dark:border-white/10')}
              >
                {t('toolbar.resetFilters')}
              </Button>
              <Button type="button" onClick={() => setFilterOpen(false)} className={skillPrimaryControlClasses}>
                {t('toolbar.applyFilters')}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <SkillMarketplaceSheet
        open={installOpen}
        onOpenChange={setInstallOpen}
        installQuery={installQuery}
        onInstallQueryChange={setInstallQuery}
        installSourceId={installSourceId}
        onInstallSourceIdChange={setInstallSourceId}
        sources={sources}
        searchError={searchError}
        searching={searching}
        searchResults={searchResults}
        installedSkills={skills}
        installing={installing}
        onInstall={(slug, sourceId) => void onInstall(slug, sourceId)}
        onUninstall={(slug, sourceId) => void onMarketplaceUninstall(slug, sourceId)}
      />
    </div>
  );
}

export default Skills;
