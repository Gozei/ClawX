import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { pageCompactControlClasses, pagePrimaryControlClasses, pagePrimaryInputClasses } from '@/components/layout/page-tokens';
import { cn } from '@/lib/utils';
import {
  buildFilterButtonClass,
  type MissingFilter,
  type SkillSourceCategory,
  type StatusFilter,
} from '../filters';

type SourceOption = {
  id: SkillSourceCategory;
  label: string;
  count: number;
};

type SkillsToolbarProps = {
  query: string;
  onQueryChange: (value: string) => void;
  sourceOptions: SourceOption[];
  sourceCategory: SkillSourceCategory;
  onSourceCategoryChange: (value: SkillSourceCategory) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (value: StatusFilter) => void;
  missingFilter: MissingFilter;
  onMissingFilterChange: (value: MissingFilter) => void;
  activeFilterCount: number;
  onResetFilters: () => void;
};

export function SkillsToolbar({
  query,
  onQueryChange,
  sourceOptions,
  sourceCategory,
  onSourceCategoryChange,
  statusFilter,
  onStatusFilterChange,
  missingFilter,
  onMissingFilterChange,
  activeFilterCount,
  onResetFilters,
}: SkillsToolbarProps) {
  const { t } = useTranslation('skills');
  const [filterOpen, setFilterOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isComposingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isComposingRef.current && inputRef.current && inputRef.current.value !== query) {
      inputRef.current.value = query;
    }
  }, [query]);

  const scheduleClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setFilterOpen(false);
      closeTimerRef.current = null;
    }, 100);
  };

  const cancelClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  return (
    <div data-testid="skills-toolbar" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px_auto] lg:items-center">
      <div className="relative min-w-0">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          data-testid="skills-search-input"
          defaultValue={query}
          onChange={(e) => {
            const nextValue = e.target.value;
            if (!isComposingRef.current) {
              onQueryChange(nextValue);
            }
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            isComposingRef.current = false;
            const nextValue = e.currentTarget.value;
            onQueryChange(nextValue);
          }}
          className={cn(pagePrimaryInputClasses, 'border-[#d6deea] bg-white pl-10 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:border-white/12 dark:bg-transparent')}
          placeholder={t('search')}
        />
      </div>

      <div className="min-w-0">
        <div className="grid min-w-0 grid-cols-4 items-center gap-x-0.5" data-testid="skills-source-tabs">
          {sourceOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onSourceCategoryChange(option.id)}
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
                    sourceCategory === option.id ? 'text-primary/70 dark:text-primary-foreground/72' : 'text-[#607089] dark:text-white/44'
                  )}
                >
                  {option.count}
                </span>
              </span>
              <span
                className={cn(
                  'absolute bottom-0 left-1/2 h-[2px] -translate-x-1/2 rounded-full transition-all',
                  sourceCategory === option.id ? 'w-[64px] bg-primary' : 'w-0 bg-transparent'
                )}
              />
            </button>
          ))}
        </div>
      </div>

      <div
        className="relative shrink-0 justify-self-end self-start -mt-1"
        onMouseEnter={() => {
          cancelClose();
          setFilterOpen(true);
        }}
        onMouseLeave={scheduleClose}
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => setFilterOpen((open) => !open)}
          className={cn(pagePrimaryControlClasses, 'border-black/10 bg-transparent text-foreground/80 hover:bg-black/5 dark:border-white/10 dark:text-white/80 dark:hover:bg-white/5')}
          data-testid="skills-filter-button"
          aria-haspopup="menu"
          aria-expanded={filterOpen}
        >
          <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />
          {activeFilterCount > 0 ? t('toolbar.filtersWithCount', { count: activeFilterCount }) : t('toolbar.filters')}
          <ChevronDown className={cn('ml-2 h-3.5 w-3.5 transition-transform', filterOpen && 'rotate-180')} />
        </Button>

        {filterOpen && (
          <div
            data-testid="skills-filter-menu"
            className="absolute right-0 top-full z-20 mt-2 w-[320px] max-w-[calc(100vw-1rem)] rounded-2xl border border-black/8 bg-popover p-4 shadow-[0_16px_40px_rgba(15,23,42,0.14)] dark:border-white/10 dark:bg-[#12161f]"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">{t('toolbar.filters')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('toolbar.filtersSubtitle')}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                className={cn(pageCompactControlClasses, 'px-3 text-foreground/70 hover:bg-black/5 dark:hover:bg-white/10')}
                onClick={onResetFilters}
                data-testid="skills-filter-reset"
              >
                {t('toolbar.resetFilters')}
              </Button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-foreground/60">{t('toolbar.sources.title')}</h3>
                <div className="grid grid-cols-2 gap-2">
                  {sourceOptions.map((option) => (
                    <Button
                      key={option.id}
                      type="button"
                      aria-pressed={sourceCategory === option.id}
                      onClick={() => onSourceCategoryChange(option.id)}
                      className={cn(
                        pageCompactControlClasses,
                        'justify-start rounded-xl border px-3',
                        buildFilterButtonClass(sourceCategory === option.id)
                      )}
                      data-testid={`skills-filter-source-${option.id}`}
                    >
                      <span className="truncate">{option.label}</span>
                      <span className={cn('ml-auto text-[11px] font-semibold', sourceCategory === option.id ? 'text-white/70 dark:text-black/55' : 'text-muted-foreground')}>
                        {option.count}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-foreground/60">{t('toolbar.groups.status')}</h3>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['all', t('toolbar.status.all')],
                    ['enabled', t('toolbar.status.enabled')],
                    ['disabled', t('toolbar.status.disabled')],
                  ] as Array<[StatusFilter, string]>).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      aria-pressed={statusFilter === value}
                      onClick={() => onStatusFilterChange(value)}
                      className={cn(pageCompactControlClasses, 'justify-center rounded-xl border px-3', buildFilterButtonClass(statusFilter === value))}
                      data-testid={`skills-filter-status-${value}`}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-foreground/60">{t('toolbar.groups.dependencies')}</h3>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['all', t('toolbar.missing.all')],
                    ['missing', t('toolbar.missing.missing')],
                    ['clean', t('toolbar.missing.clean')],
                  ] as Array<[MissingFilter, string]>).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      aria-pressed={missingFilter === value}
                      onClick={() => onMissingFilterChange(value)}
                      className={cn(pageCompactControlClasses, 'justify-center rounded-xl border px-3', buildFilterButtonClass(missingFilter === value))}
                      data-testid={`skills-filter-missing-${value}`}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
