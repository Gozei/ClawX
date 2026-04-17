import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef } from 'react';
import { AlertCircle, CheckCircle2, Download, LoaderCircle, Package, PackageMinus, RefreshCw, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  pageCompactControlClasses,
  pageDialogCardClasses,
  pageFormInputClasses,
  pageIconControlClasses,
  pageSectionCardClasses,
  pageSectionCardInteractiveClasses,
} from '@/components/layout/page-tokens';
import { modalCardClasses, modalOverlayClasses } from '@/components/ui/modal';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import type { MarketplaceInstalledSkill, MarketplaceSkill, SkillSource } from '@/types/skill';

type SkillMarketplaceSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installQuery: string;
  onInstallQueryChange: (value: string) => void;
  installSourceId: string;
  onInstallSourceIdChange: (value: string) => void;
  sources: SkillSource[];
  sourceCounts: Record<string, number | null>;
  searchError: string | null;
  searching: boolean;
  searchingMore: boolean;
  searchResults: MarketplaceSkill[];
  installedSkills: MarketplaceInstalledSkill[];
  installing: Record<string, boolean>;
  marketplaceNotice: { type: 'installing' | 'installed' | 'uninstalling' | 'uninstalled'; slug: string; name?: string } | null;
  onLoadMore: () => void;
  onInstall: (slug: string, version?: string, sourceId?: string, force?: boolean) => void;
  onUninstall: (slug: string, sourceId?: string) => void;
  onViewInstalledSkill: (slug: string) => void;
};

export function SkillMarketplaceSheet({
  open,
  onOpenChange,
  installQuery,
  onInstallQueryChange,
  installSourceId,
  onInstallSourceIdChange,
  sources,
  sourceCounts,
  searchError,
  searching,
  searchingMore,
  searchResults,
  installedSkills,
  installing,
  marketplaceNotice,
  onLoadMore,
  onInstall,
  onUninstall,
  onViewInstalledSkill,
}: SkillMarketplaceSheetProps) {
  const { t } = useTranslation('skills');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const normalizeSkillKey = (value?: string) => value?.trim().toLowerCase() ?? '';

  const compareVersions = (left?: string, right?: string) => {
    const normalize = (value?: string) => (value || '')
      .replace(/^v/i, '')
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map((part) => Number.parseInt(part, 10));

    const leftParts = normalize(left);
    const rightParts = normalize(right);
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
      const leftPart = leftParts[index] ?? 0;
      const rightPart = rightParts[index] ?? 0;
      if (leftPart > rightPart) return 1;
      if (leftPart < rightPart) return -1;
    }

    return 0;
  };

  const formatSourceCount = (value: number | null | undefined) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toLocaleString();
    }
    if (value === null) {
      return 'N/A';
    }
    return '...';
  };

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
    const element = scrollContainerRef.current;
    if (!element) return;

    const handleScroll = () => {
      const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      if (distanceToBottom < 320) {
        onLoadMore();
      }
    };

    element.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', handleScroll);
    };
  }, [onLoadMore, searchResults.length]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={modalOverlayClasses} />
        <Dialog.Content
          data-testid="skills-marketplace-modal"
          className={cn(
            modalCardClasses,
            pageDialogCardClasses,
            'fixed left-1/2 top-1/2 z-50 h-[min(780px,calc(100dvh-2rem))] w-[min(1120px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2'
          )}
        >
          <div className="pointer-events-none absolute left-1/2 top-7 z-10 -translate-x-1/2">
            {marketplaceNotice && (
              <div
                data-testid="skills-marketplace-success-banner"
                className="pointer-events-auto flex max-w-[min(760px,calc(100vw-6rem))] items-center justify-center gap-2.5 rounded-full bg-white/96 px-5 py-2.5 text-center text-[15px] font-medium text-primary shadow-[0_8px_28px_rgba(59,130,246,0.16)] ring-1 ring-primary/14 backdrop-blur dark:bg-[#171c26]/96 dark:text-primary dark:ring-primary/20"
              >
                {marketplaceNotice.type === 'installed' || marketplaceNotice.type === 'uninstalled' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />
                )}
                <span className="truncate">
                  {marketplaceNotice.type === 'installed'
                    ? t('marketplace.installSuccessDescription', {
                      skill: marketplaceNotice.name || marketplaceNotice.slug,
                    })
                    : marketplaceNotice.type === 'uninstalled'
                      ? t('marketplace.uninstallSuccessDescription', {
                        skill: marketplaceNotice.name || marketplaceNotice.slug,
                      })
                      : marketplaceNotice.type === 'uninstalling'
                        ? t('marketplace.uninstallingDescription', {
                          skill: marketplaceNotice.name || marketplaceNotice.slug,
                        })
                        : t('marketplace.installingDescription', {
                      skill: marketplaceNotice.name || marketplaceNotice.slug,
                    })}
                </span>
                {marketplaceNotice.type === 'installed' && (
                  <button
                    type="button"
                    onClick={() => onViewInstalledSkill(marketplaceNotice.slug)}
                    className="shrink-0 font-medium text-primary underline decoration-primary/45 underline-offset-4 transition-opacity hover:opacity-85"
                  >
                    {t('marketplace.viewInstalledSkill')}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="px-7 pb-5 pt-7">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-6">
              <div className="min-w-0">
                <Dialog.Title className="text-2xl font-serif font-normal tracking-tight text-foreground">
                  {t('marketplace.title')}
                </Dialog.Title>
                <Dialog.Description className="mt-1 max-w-2xl text-[15px] leading-6 text-foreground/70">
                  {t('marketplace.subtitle')}
                </Dialog.Description>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className={cn(
                  pageIconControlClasses,
                  'h-11 w-11 shrink-0 border border-black/8 bg-white text-foreground/70 hover:bg-black/5 dark:border-white/10 dark:bg-transparent dark:text-white/72 dark:hover:bg-white/5'
                )}
                aria-label={t('marketplace.close')}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="border-b border-black/6 px-7 pb-3 dark:border-white/10">
            <div className="grid gap-3 bg-transparent px-4 pt-4 pb-2">
              <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="skills-marketplace-search-input"
                value={installQuery}
                onChange={(event) => onInstallQueryChange(event.target.value)}
                placeholder={t('searchMarketplace')}
                className={cn(
                  pageFormInputClasses,
                  'rounded-full border-2 border-black/8 bg-transparent pl-11 shadow-none focus-visible:border-black/8 focus-visible:ring-0 dark:border-white/10 dark:bg-transparent dark:focus-visible:border-white/10'
                )}
              />
              </div>

              <div data-testid="skills-marketplace-source-chips" className="flex flex-wrap gap-2">
                {sources.map((source) => (
                  <Button
                    key={source.id}
                    type="button"
                    variant="outline"
                    onClick={() => onInstallSourceIdChange(source.id)}
                    aria-pressed={installSourceId === source.id}
                    data-testid={`skills-marketplace-source-chip-${source.id}`}
                    className={cn(
                      pageCompactControlClasses,
                      'rounded-full border px-4',
                      installSourceId === source.id
                        ? 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'border-black/10 bg-background text-foreground/78 hover:bg-black/5 dark:border-white/10 dark:bg-muted dark:text-white/78 dark:hover:bg-white/5'
                    )}
                  >
                    <span className="truncate">{source.label}</span>
                    <span
                      data-testid={`skills-marketplace-source-count-${source.id}`}
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        installSourceId === source.id
                          ? 'bg-primary-foreground/18 text-primary-foreground'
                          : 'bg-black/5 text-foreground/62 dark:bg-white/10 dark:text-white/68'
                      )}
                    >
                      {formatSourceCount(sourceCounts[source.id])}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {searchError && (
            <div className="mx-7 mt-5 flex items-center gap-2 rounded-2xl border border-destructive/50 bg-destructive/10 p-4 text-sm font-medium text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{searchError}</span>
            </div>
          )}

          {searching ? (
            <div className="flex flex-1 items-center justify-center px-7 py-10"><LoadingSpinner size="lg" /></div>
          ) : (
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-7 pb-7 pt-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {searchResults.map((skill) => {
                  const effectiveInstalledSkill = findEffectiveInstalledSkill(skill);
                  const installedOnCurrentSource = Boolean(
                    effectiveInstalledSkill
                    && effectiveInstalledSkill.sourceId === skill.sourceId
                  );
                  const occupiedByOtherSource = Boolean(
                    effectiveInstalledSkill
                    && effectiveInstalledSkill.sourceId
                    && effectiveInstalledSkill.sourceId !== skill.sourceId
                  );
                  const hasUpdate = installedOnCurrentSource
                    && compareVersions(skill.version, effectiveInstalledSkill?.version) > 0;
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
                      className={cn(
                        pageSectionCardClasses,
                        pageSectionCardInteractiveClasses,
                        'group flex min-h-[236px] flex-col justify-between p-4'
                      )}
                    >
                      <div>
                        <div className="flex min-w-0 items-start gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-black/5 text-[22px] font-semibold text-foreground/78 dark:bg-white/[0.08] dark:text-white/86">
                            {skill.icon ? (
                              <img
                                src={skill.icon}
                                alt=""
                                className="h-7 w-7 rounded-lg object-cover"
                              />
                            ) : (
                              <span>{(skill.name || skill.slug).slice(0, 1).toUpperCase()}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1 pt-1">
                            <h3 className="truncate text-[16px] font-semibold tracking-tight text-foreground">{skill.name}</h3>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="truncate font-medium text-foreground/62">
                                @{skill.author || 'community'}
                              </span>
                              <span className="rounded-full bg-black/5 px-3 py-1 font-mono dark:bg-white/[0.08]">
                                {skill.slug}
                              </span>
                            </div>
                          </div>
                        </div>

                        <p className="mt-5 line-clamp-4 text-[13px] leading-6 text-foreground/72">{skill.description}</p>
                      </div>

                      <div className="mt-6 flex items-end justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={cn(
                              'text-[13px] font-medium text-foreground/82',
                              hasUpdate && 'text-[#d65a00] dark:text-[#ffb14a]'
                            )}>
                              {`v${installedOnCurrentSource ? (effectiveInstalledSkill?.version || skill.version || '0.0.0') : (skill.version || '0.0.0')}`}
                            </p>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {occupiedByOtherSource
                              ? t('marketplace.occupiedDetail', {
                                source: effectiveInstalledSkill?.sourceLabel || effectiveInstalledSkill?.sourceId || t('marketplace.unknownSource'),
                              })
                              : hasUpdate
                              ? t('marketplace.updateVersionLabel', {
                                current: effectiveInstalledSkill?.version || '0.0.0',
                                latest: skill.version || '0.0.0',
                              })
                              : skill.sourceLabel || sources.find((source) => source.id === skill.sourceId)?.label || t('marketplace.unknownSource')}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {hasUpdate && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => onInstall(skill.slug, skill.version, skill.sourceId, true)}
                              disabled={busy}
                              aria-label={updateActionLabel}
                              className="h-9 rounded-full px-4 border-black/10 bg-transparent text-foreground/80 shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
                            >
                              {busy ? (
                                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="mr-2 h-4 w-4" />
                              )}
                              {updateActionLabel}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant={installedOnCurrentSource && !hasUpdate ? 'outline' : 'default'}
                            onClick={() => {
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
                              'gap-2 rounded-full px-4',
                              occupiedByOtherSource
                                ? 'border border-black/8 bg-black/5 text-foreground/35 hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/35 dark:hover:bg-white/[0.05]'
                                : installedOnCurrentSource
                                  ? 'border border-black/10 bg-transparent text-foreground/80 hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:text-white/80 dark:hover:bg-white/5'
                                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
                            )}
                          >
                            {busy ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : installedOnCurrentSource ? (
                              <PackageMinus className="h-4 w-4" />
                            ) : (
                              <Download className="h-4 w-4" />
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
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
