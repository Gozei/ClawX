import { AlertCircle, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import type { MarketplaceSkill, SkillSnapshot, SkillSource } from '@/types/skill';
import { skillCardClasses, skillCompactControlClasses, skillInputClasses } from './constants';

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
  searchResults: MarketplaceSkill[];
  installedSkills: SkillSnapshot[];
  installing: Record<string, boolean>;
  onInstall: (slug: string, sourceId?: string) => void;
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
  searchResults,
  installedSkills,
  installing,
  onInstall,
  onUninstall,
}: SkillMarketplaceSheetProps) {
  const { t } = useTranslation('skills');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-testid="skills-marketplace-sheet" side="right" className="w-full overflow-y-auto border-l-0 bg-background p-6 dark:bg-card sm:max-w-[640px]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold">{t('marketplace.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('marketplace.subtitle')}</p>
          </div>
        </div>
        <div className="grid gap-3">
          <Input data-testid="skills-marketplace-search-input" value={installQuery} onChange={(event) => onInstallQueryChange(event.target.value)} placeholder={t('searchMarketplace')} className="h-10 rounded-full" />
          <select data-testid="skills-marketplace-source-select" value={installSourceId} onChange={(event) => onInstallSourceIdChange(event.target.value)} className={cn(skillInputClasses, 'h-10 rounded-full px-4 text-[13px]')}>
            <option value="all">{t('marketplace.allSources')}</option>
            {sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
          </select>
        </div>

        {searchError && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm font-medium text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{searchError}</span>
          </div>
        )}

        {searching ? (
          <div className="mt-10 flex justify-center"><LoadingSpinner size="lg" /></div>
        ) : (
          <div className="mt-4 grid gap-3">
            {searchResults.map((skill) => {
              const installed = installedSkills.some((entry) => entry.id === skill.slug || entry.slug === skill.slug);
              const installKey = skill.sourceId ? `${skill.sourceId}:${skill.slug}` : skill.slug;
              return (
                <div key={`${skill.sourceId || 'default'}:${skill.slug}`} data-testid={`skills-marketplace-item-${skill.slug}`} className={cn(skillCardClasses, 'p-4')}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold">{skill.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{skill.description}</p>
                      <p className="mt-2 text-xs text-muted-foreground">@{skill.author || 'community'}/{skill.slug}</p>
                    </div>
                    {installed ? (
                      <Button variant="outline" onClick={() => onUninstall(skill.slug, skill.sourceId)} disabled={Boolean(installing[installKey])} className={cn(skillCompactControlClasses, 'border-black/10 dark:border-white/10')}>
                        {installing[installKey] ? t('marketplace.working') : t('marketplace.uninstall')}
                      </Button>
                    ) : (
                      <Button onClick={() => onInstall(skill.slug, skill.sourceId)} disabled={Boolean(installing[installKey])} className={skillCompactControlClasses}>
                        {installing[installKey] ? t('marketplace.working') : t('marketplace.install')}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {!searchError && searchResults.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Package className="mb-4 h-10 w-10 opacity-50" />
                <p>{installQuery.trim() ? t('marketplace.noResults') : t('marketplace.emptyPrompt')}</p>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
