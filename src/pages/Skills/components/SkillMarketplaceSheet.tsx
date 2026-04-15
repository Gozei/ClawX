import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef } from 'react';
import { AlertCircle, Download, LoaderCircle, Package, PackageMinus, RefreshCw, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { modalCardClasses, modalOverlayClasses } from '@/components/ui/modal';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import type { MarketplaceInstalledSkill, MarketplaceSkill, SkillSource } from '@/types/skill';
import { skillCardClasses, skillCompactControlClasses, skillInputClasses, skillPrimaryInputClasses } from './constants';

type SkillMarketplaceSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installQuery: string;
  onInstallQueryChange: (value: string) => void;
  installSourceId: string;
  onInstallSourceIdChange: (value: string) => void;
  sources: SkillSource[];
  searchError: string | null;
  searching: boolean;
  searchingMore: boolean;
  searchResults: MarketplaceSkill[];
  installedSkills: MarketplaceInstalledSkill[];
  installing: Record<string, boolean>;
  onLoadMore: () => void;
  onInstall: (slug: string, version?: string, sourceId?: string, force?: boolean) => void;
  onUninstall: (slug: string, sourceId?: string) => void;
};

export function SkillMarketplaceSheet({
  open,
  onOpenChange,
  installQuery,
  onInstallQueryChange,
  installSourceId,
  onInstallSourceIdChange,
  sources,
  searchError,
  searching,
  searchingMore,
  searchResults,
  installedSkills,
  installing,
  onLoadMore,
  onInstall,
  onUninstall,
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
        <Dialog.Overlay className={cn(modalOverlayClasses, 'bg-slate-950/42')} />
        <Dialog.Content
          data-testid="skills-marketplace-modal"
          className={cn(
            modalCardClasses,
            'fixed left-1/2 top-1/2 z-50 h-[min(780px,calc(100dvh-2rem))] w-[min(1120px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[30px] border border-[#d7deea] bg-[#f8fafc] shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-[#0f131b]'
          )}
        >
          <div className="flex items-start justify-between gap-6 border-b border-black/6 px-7 pb-5 pt-7 dark:border-white/10">
            <div className="min-w-0">
              <Dialog.Title className="text-[28px] font-semibold tracking-tight text-foreground">
                {t('marketplace.title')}
              </Dialog.Title>
              <Dialog.Description className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {t('marketplace.subtitle')}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0 rounded-full border border-black/8 bg-white text-foreground/70 hover:bg-slate-50 dark:border-white/10 dark:bg-[#171c26] dark:text-white/72 dark:hover:bg-[#1c2230]"
                aria-label={t('marketplace.close')}
              >
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="grid gap-4 border-b border-black/6 px-7 py-5 dark:border-white/10">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="skills-marketplace-search-input"
                value={installQuery}
                onChange={(event) => onInstallQueryChange(event.target.value)}
                placeholder={t('searchMarketplace')}
                className={cn(
                  skillPrimaryInputClasses,
                  skillInputClasses,
                  'h-11 rounded-full border-[#d7dfeb] bg-white pl-11 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:border-white/12 dark:bg-white/[0.04]'
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
                    skillCompactControlClasses,
                    'rounded-full border px-4',
                    installSourceId === source.id
                      ? 'border-transparent bg-foreground text-background hover:bg-foreground/90'
                      : 'border-black/10 bg-white text-foreground/78 hover:bg-black/5 dark:border-white/10 dark:bg-[#171c26] dark:text-white/78 dark:hover:bg-[#1c2230]'
                  )}
                >
                  {source.label}
                </Button>
              ))}
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
                        skillCardClasses,
                        'group flex min-h-[240px] flex-col justify-between rounded-[26px] border border-black/8 bg-white p-5 transition-[box-shadow,border-color,background-color] hover:border-black/12 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)] dark:bg-[#161b25] dark:hover:border-white/16 dark:hover:bg-[#1b2130]'
                      )}
                    >
                      <div>
                        <div className="flex min-w-0 items-start gap-4">
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-[28px] font-semibold text-slate-700 shadow-inner shadow-white/60 dark:bg-white/[0.06] dark:text-white/86 dark:shadow-none">
                            {skill.icon ? (
                              <img
                                src={skill.icon}
                                alt=""
                                className="h-8 w-8 rounded-lg object-cover"
                              />
                            ) : (
                              <span>{(skill.name || skill.slug).slice(0, 1).toUpperCase()}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1 pt-1">
                            <h3 className="truncate text-[18px] font-semibold tracking-tight text-foreground">{skill.name}</h3>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="truncate font-medium text-foreground/62">
                                @{skill.author || 'community'}
                              </span>
                              <span className="rounded-full bg-slate-100 px-3 py-1 font-mono dark:bg-white/[0.06]">
                                {skill.slug}
                              </span>
                            </div>
                          </div>
                        </div>

                        <p className="mt-6 line-clamp-4 text-sm leading-6 text-foreground/72">{skill.description}</p>
                      </div>

                      <div className="mt-6 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2.5">
                            <p className={cn(
                              'text-sm font-medium text-foreground/82',
                              hasUpdate && 'text-[#d65a00] dark:text-[#ffb14a]'
                            )}>
                            {`v${installedOnCurrentSource ? (effectiveInstalledSkill?.version || skill.version || '0.0.0') : (skill.version || '0.0.0')}`}
                            </p>
                            {hasUpdate && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    size="icon"
                                    onClick={() => onInstall(skill.slug, skill.version, skill.sourceId, true)}
                                    disabled={busy}
                                    aria-label={updateActionLabel}
                                    className="h-9 w-9 rounded-full border border-[#f7b26a] bg-[#ff7a00] text-white shadow-[0_8px_20px_rgba(255,122,0,0.28)] transition-colors hover:bg-[#ea6e00] dark:border-[#ffb866] dark:bg-[#ff9a1f] dark:hover:bg-[#ff8c00]"
                                  >
                                    {busy ? (
                                      <LoaderCircle className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <RefreshCw className="h-4 w-4" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{updateActionLabel}</TooltipContent>
                              </Tooltip>
                            )}
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

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant={installedOnCurrentSource && !hasUpdate ? 'outline' : 'default'}
                              size="icon"
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
                                'h-10 w-10 shrink-0 rounded-full shadow-none',
                                occupiedByOtherSource
                                  ? 'border-black/8 bg-slate-100 text-foreground/35 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/35'
                                  : installedOnCurrentSource
                                    ? 'border-black/10 bg-white text-foreground/80 hover:bg-slate-50 dark:border-white/10 dark:bg-[#171c26] dark:text-white/80 dark:hover:bg-[#1c2230]'
                                    : 'bg-foreground text-background hover:bg-foreground/90',
                                installedOnCurrentSource
                                  ? 'border-black/10'
                                  : null
                              )}
                            >
                              {busy ? (
                                <LoaderCircle className="h-4 w-4 animate-spin" />
                              ) : installedOnCurrentSource ? (
                                <PackageMinus className="h-4 w-4" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{primaryActionLabel}</TooltipContent>
                        </Tooltip>
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
