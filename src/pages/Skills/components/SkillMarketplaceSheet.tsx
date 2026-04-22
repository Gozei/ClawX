import { useEffect, useMemo, useRef } from 'react';
import { AlertCircle, Download, LoaderCircle, Package, PackageMinus, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  pageCompactControlClasses,
  pageSectionCardClasses,
  pageSectionCardInteractiveClasses,
} from '@/components/layout/page-tokens';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import type { MarketplaceInstalledSkill, MarketplaceSkill, SkillSnapshot, SkillSource } from '@/types/skill';
import { compareMarketplaceVersions, resolveMarketplaceAvailability } from '../marketplace-state';

type SkillMarketplaceSheetProps = {
  open: boolean;
  installQuery: string;
  sources: SkillSource[];
  skills: SkillSnapshot[];
  searchError: string | null;
  searching: boolean;
  searchingMore: boolean;
  searchResults: MarketplaceSkill[];
  installedSkills: MarketplaceInstalledSkill[];
  installing: Record<string, boolean>;
  selectedMarketplaceSkill: { slug: string; sourceId?: string } | null;
  onLoadMore: () => void;
  onInstall: (slug: string, version?: string, sourceId?: string, force?: boolean) => void;
  onUninstall: (slug: string, sourceId?: string) => void;
  onSelectMarketplaceSkill: (slug: string, sourceId?: string) => void;
};

export function SkillMarketplaceSheet({
  open,
  installQuery,
  sources,
  skills,
  searchError,
  searching,
  searchingMore,
  searchResults,
  installedSkills,
  installing,
  selectedMarketplaceSkill,
  onLoadMore,
  onInstall,
  onUninstall,
  onSelectMarketplaceSkill,
}: SkillMarketplaceSheetProps) {
  const { t } = useTranslation('skills');
  const loadMoreTriggerRef = useRef<HTMLDivElement | null>(null);
  const normalizeSkillKey = (value?: string) => value?.trim().toLowerCase() ?? '';

  const sourcePriorityIndex = useMemo(() => {
    return new Map(sources.map((source, index) => [source.id, index]));
  }, [sources]);

  const findEffectiveInstalledSkill = (skill: MarketplaceSkill) => {
    const targetKey = normalizeSkillKey(skill.slug);
    if (!targetKey) return undefined;

    const matches = installedSkills.filter((entry) => normalizeSkillKey(entry.slug) === targetKey);
    if (matches.length === 0) return undefined;

    return matches.reduce((best, entry) => {
      const bestPriority = sourcePriorityIndex.get(best.sourceId ?? '') ?? Number.MAX_SAFE_INTEGER;
      const entryPriority = sourcePriorityIndex.get(entry.sourceId ?? '') ?? Number.MAX_SAFE_INTEGER;
      return entryPriority < bestPriority ? entry : best;
    });
  };

  useEffect(() => {
    const target = loadMoreTriggerRef.current;
    if (!target || selectedMarketplaceSkill) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          onLoadMore();
        }
      },
      {
        root: null,
        rootMargin: '320px 0px',
        threshold: 0,
      }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [onLoadMore, searchResults.length, selectedMarketplaceSkill]);

  if (!open) {
    return null;
  }

  return (
    <section data-testid="skills-marketplace-panel" className="flex min-h-0 flex-col">
      {!selectedMarketplaceSkill && searchError && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm font-medium text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{searchError}</span>
        </div>
      )}

      {!selectedMarketplaceSkill && searching ? (
        <div className="flex min-h-[320px] items-center justify-center py-10"><LoadingSpinner size="lg" /></div>
      ) : (
        <div className="min-h-0">
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
          >
              {searchResults.map((skill) => {
                const effectiveInstalledSkill = findEffectiveInstalledSkill(skill);
                const { installedOnCurrentSource, occupiedByOtherSource } = resolveMarketplaceAvailability({
                  slug: skill.slug,
                  sourceId: skill.sourceId,
                  installedSkills,
                  skills,
                  sources,
                });
                const hasUpdate = installedOnCurrentSource
                  && compareMarketplaceVersions(skill.version, effectiveInstalledSkill?.version) > 0;
                const installKey = skill.sourceId ? `${skill.sourceId}:${skill.slug}` : skill.slug;
                const busy = Boolean(installing[installKey]);
                const primaryActionLabel = busy
                  ? t('marketplace.working')
                  : occupiedByOtherSource
                    ? t('marketplace.occupiedAction')
                    : installedOnCurrentSource
                      ? t('marketplace.uninstallAction')
                      : t('marketplace.installAction');
                const updateActionLabel = busy
                  ? t('marketplace.working')
                  : t('marketplace.updateAction');

                return (
                  <article
                    key={`${skill.sourceId || 'default'}:${skill.slug}`}
                    data-testid={`skills-marketplace-item-${skill.sourceId || 'default'}-${skill.slug}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectMarketplaceSkill(skill.slug, skill.sourceId)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectMarketplaceSkill(skill.slug, skill.sourceId);
                      }
                    }}
                    className={cn(
                      pageSectionCardClasses,
                      pageSectionCardInteractiveClasses,
                      'group flex aspect-[4/3] min-w-0 cursor-pointer flex-col justify-between overflow-hidden p-3.5 outline-none'
                    )}
                  >
                    <div>
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/5 text-[18px] font-semibold text-foreground/78 dark:bg-white/[0.08] dark:text-white/86">
                          {skill.icon ? (
                            <img
                              src={skill.icon}
                              alt=""
                              className="h-6 w-6 rounded-lg object-cover"
                            />
                          ) : (
                            <span>{(skill.name || skill.slug).slice(0, 1).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <h3 className="truncate text-[14px] font-semibold leading-5 tracking-tight text-foreground">{skill.name}</h3>
                          <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
                            <span className="truncate font-medium text-foreground/62">
                              @{skill.author || 'community'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <p className="mt-4 line-clamp-2 text-[11px] leading-6 text-foreground/72">{skill.description}</p>
                    </div>

                    <div className="mt-4 flex items-end justify-between gap-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={cn(
                            'text-[11px] font-medium text-foreground/82',
                            hasUpdate && 'text-[#d65a00] dark:text-[#ffb14a]'
                          )}>
                            {`v${installedOnCurrentSource ? (effectiveInstalledSkill?.version || skill.version || '0.0.0') : (skill.version || '0.0.0')}`}
                          </p>
                        </div>
                        {hasUpdate && (
                          <p className="mt-1 truncate text-[12px] text-muted-foreground">
                            {t('marketplace.updateVersionLabel', {
                              current: effectiveInstalledSkill?.version || '0.0.0',
                              latest: skill.version || '0.0.0',
                            })}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {hasUpdate && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={(event) => {
                              event.stopPropagation();
                              onInstall(skill.slug, skill.version, skill.sourceId, true);
                            }}
                            disabled={busy}
                            aria-label={updateActionLabel}
                            className="h-8 rounded-full px-3 border-black/10 bg-transparent text-[11px] text-foreground/80 shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
                          >
                            {busy ? (
                              <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-1 h-3 w-3" />
                            )}
                            {updateActionLabel}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant={installedOnCurrentSource && !hasUpdate ? 'outline' : 'default'}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (occupiedByOtherSource) {
                              return;
                            }
                            if (hasUpdate || !installedOnCurrentSource) {
                              onInstall(skill.slug, skill.version, skill.sourceId, hasUpdate);
                              return;
                            }
                            onUninstall(skill.slug, skill.sourceId);
                          }}
                          disabled={busy || occupiedByOtherSource}
                          aria-label={primaryActionLabel}
                          className={cn(
                            pageCompactControlClasses,
                            'h-8 gap-1 rounded-full px-3 text-[11px]',
                            occupiedByOtherSource
                              ? 'border border-black/8 bg-black/5 text-foreground/35 hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/35 dark:hover:bg-white/[0.05]'
                              : installedOnCurrentSource
                                ? 'border border-black/10 bg-transparent text-foreground/80 hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:text-white/80 dark:hover:bg-white/5'
                                : 'bg-primary text-primary-foreground hover:bg-primary/90'
                          )}
                        >
                          {busy ? (
                            <LoaderCircle className="h-3 w-3 animate-spin" />
                          ) : installedOnCurrentSource ? (
                            <PackageMinus className="h-3 w-3" />
                          ) : (
                            <Download className="h-3 w-3" />
                          )}
                          <span>{primaryActionLabel}</span>
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

          {!searchError && searchResults.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
              <Package className="mb-4 h-10 w-10 opacity-50" />
              <p>{installQuery.trim() ? t('marketplace.noResults') : t('marketplace.emptyPrompt')}</p>
            </div>
          )}

          {searchingMore && (
            <div className="flex justify-center py-6">
              <LoadingSpinner size="md" />
            </div>
          )}
          <div ref={loadMoreTriggerRef} className="h-px w-full" aria-hidden="true" />
        </div>
      )}
    </section>
  );
}
