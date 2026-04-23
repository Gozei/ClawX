import { useCallback, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
  Package,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useSkillsStore } from '@/stores/skills';
import type { MarketplaceInstalledSkill, MarketplaceSkillDetail, SkillSnapshot, SkillSource } from '@/types/skill';
import { SkillDetailMarkdownContent } from './SkillDetailMarkdownContent';
import { SkillDetailOverviewCard } from './SkillDetailOverviewCard';
import { compareMarketplaceVersions, resolveInstalledSkillId, resolveMarketplaceAvailability } from '../marketplace-state';

type SkillMarketplaceDetailContentProps = {
  detail: MarketplaceSkillDetail;
  installedSkills: MarketplaceInstalledSkill[];
  skills: SkillSnapshot[];
  sources: SkillSource[];
  sourceId?: string;
};

export function SkillMarketplaceDetailContent({
  detail,
  installedSkills,
  skills,
  sources,
  sourceId,
}: SkillMarketplaceDetailContentProps) {
  const { t, i18n } = useTranslation('skills');
  const [installing, setInstalling] = useState(false);
  const [activeTab, setActiveTab] = useState<'docs' | 'details'>('docs');
  const installSkill = useSkillsStore((state) => state.installSkill);
  const enableSkill = useSkillsStore((state) => state.enableSkill);
  const language = i18n?.resolvedLanguage || i18n?.language || 'en';

  const formatInteger = useCallback(
    (value: number) => new Intl.NumberFormat(language).format(value),
    [language],
  );
  const formatDateTime = (value: number) => new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

  const slug = detail.skill?.slug || detail.requestedSlug || detail.resolvedSlug || '';
  const title = detail.skill?.displayName || slug || t('marketplace.unknownSkill', { defaultValue: 'Unknown skill' });
  const version = detail.latestVersion?.version || detail.skill?.tags?.latest || 'latest';
  const description = detail.skill?.description || detail.skill?.summary || t('marketplace.noDescription', { defaultValue: 'No description provided.' });
  const authorLabel = detail.owner?.displayName || detail.owner?.handle || t('marketplace.unknownAuthor', { defaultValue: 'Unknown author' });
  const fileCount = detail.latestVersion?.files?.length ?? 0;
  const latestChangelog = detail.latestVersion?.changelog?.trim() || '';
  const license = detail.latestVersion?.parsed?.license?.trim() || t('marketplace.licenseUnknown', { defaultValue: 'Unknown' });
  const scan = detail.latestVersion?.staticScan;
  const scanStatus = scan?.status || 'unknown';
  const markdown = detail.latestVersion?.rawMarkdown?.trim() || '';
  const { currentInstalledSkill, installedOnCurrentSource, occupiedByOtherSource } = resolveMarketplaceAvailability({
    slug,
    sourceId,
    installedSkills,
    skills,
    sources,
  });
  const hasUpdate = installedOnCurrentSource && compareMarketplaceVersions(version, currentInstalledSkill?.version) > 0;

  const stats = useMemo(() => {
    const skillStats = detail.skill?.stats;
    return [
      typeof skillStats?.downloads === 'number' ? { label: t('marketplace.downloads'), value: formatInteger(skillStats.downloads) } : null,
      typeof skillStats?.stars === 'number' ? { label: t('marketplace.stars'), value: formatInteger(skillStats.stars) } : null,
      typeof skillStats?.versions === 'number' ? { label: t('marketplace.versions'), value: formatInteger(skillStats.versions) } : null,
    ].filter(Boolean) as Array<{ label: string; value: string }>;
  }, [detail.skill?.stats, formatInteger, t]);

  const onInstall = async () => {
    if (!slug) return;
    if (occupiedByOtherSource) return;
    setInstalling(true);
    try {
      await installSkill(slug, version, sourceId, hasUpdate);
      const installedSkillId = resolveInstalledSkillId(slug, useSkillsStore.getState().skills ?? [], sourceId);
      await enableSkill(installedSkillId);
      toast.success(t('marketplace.installSuccessDescription', {
        skill: title,
        defaultValue: `${title} is now installed.`,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div data-testid="skills-marketplace-detail-content" className="grid gap-6">
      <SkillDetailOverviewCard
        title={title}
        titleAs="h1"
        titleTestId="skills-marketplace-detail-title"
        description={description}
        icon={<Package className="h-7 w-7" />}
        iconClassName="text-sky-700 dark:text-sky-200"
        badges={(
          <>
            <Badge variant="secondary" className="rounded-md border-0 bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-white/70">
              v{version}
            </Badge>
            {sourceId && (
              <Badge variant="secondary" className="rounded-md border-0 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200">
                {sourceId}
              </Badge>
            )}
            <Badge variant="secondary" className={cn(
              'rounded-md border-0',
              scanStatus === 'clean'
                ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-100'
                : scanStatus === 'unknown'
                  ? 'bg-slate-500/12 text-slate-700 dark:text-slate-100'
                  : 'bg-amber-500/12 text-amber-700 dark:text-amber-100',
            )}>
              {scanStatus === 'clean'
                ? t('marketplace.staticScanClean', { defaultValue: 'Security scan clean' })
                : scanStatus === 'unknown'
                  ? t('marketplace.staticScanUnknown', { defaultValue: 'Security scan unknown' })
                  : t('marketplace.staticScanReview', { defaultValue: 'Review recommended' })}
            </Badge>
            {detail.pendingReview && (
              <Badge variant="secondary" className="rounded-md border-0 bg-amber-500/12 text-amber-700 dark:text-amber-100">
                {t('marketplace.pendingReview', { defaultValue: 'Pending review' })}
              </Badge>
            )}
          </>
        )}
        actions={(
          <>
            <Button
              type="button"
              onClick={() => void onInstall()}
              disabled={installing || !slug || occupiedByOtherSource || (installedOnCurrentSource && !hasUpdate)}
              className="rounded-full bg-sky-600 px-5 text-white hover:bg-sky-700 dark:bg-sky-600 dark:hover:bg-sky-500"
            >
              {installing ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {occupiedByOtherSource
                ? t('marketplace.occupiedAction', { defaultValue: 'Provided by another source' })
                : installedOnCurrentSource && hasUpdate
                  ? t('marketplace.updateAction')
                  : installedOnCurrentSource
                    ? t('marketplace.installedState', { defaultValue: 'Installed' })
                    : t('marketplace.installAction')}
            </Button>
          </>
        )}
        metadata={(
          <>
            <span className="flex items-center gap-1.5">
              <span className="font-medium text-slate-500 dark:text-white/60">{t('detail.author')}:</span>
              <span className="inline-flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                {authorLabel}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-medium text-slate-500 dark:text-white/60">{t('marketplace.identityLabel', { defaultValue: 'Identity' })}:</span>
              <span className="font-mono text-slate-500 dark:text-white/60">
                {detail.resolvedSlug || slug}
                {detail.forkOf ? ` · ${t('marketplace.forkedFrom', { source: detail.forkOf })}` : ''}
              </span>
            </span>
            {detail.canonical && (
              <span className="flex items-center gap-1.5">
                <span className="font-medium text-slate-500 dark:text-white/60">{t('marketplace.canonicalLabel')}:</span>
                {detail.canonical}
              </span>
            )}
          </>
        )}
      />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'docs' | 'details')}>
        <section className="overflow-hidden rounded-[24px] bg-white shadow-[0_4px_24px_rgb(0,0,0,0.03)] dark:bg-card">
          <div className="border-b border-slate-200 px-6 pt-2 dark:border-white/10 sm:px-8">
            <TabsList variant="page">
              <TabsTrigger data-testid="skills-marketplace-detail-tab-docs" value="docs" variant="page">{t('detail.docsTab')}</TabsTrigger>
              <TabsTrigger data-testid="skills-marketplace-detail-tab-details" value="details" variant="page">{t('marketplace.detailInfoTab', { defaultValue: 'Marketplace details' })}</TabsTrigger>
            </TabsList>
          </div>

          <div className="p-6 sm:p-8">
            <TabsContent value="docs" data-testid="skills-marketplace-detail-docs" className="mt-0">
              <SkillDetailMarkdownContent content={markdown} />
            </TabsContent>

            <TabsContent value="details" className="mt-0 space-y-10">
              {stats.length > 0 && (
                <div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {stats.map((item) => (
                      <div key={item.label} className="rounded-2xl bg-slate-50/70 p-4 dark:bg-white/[0.04]">
                        <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-400 dark:text-white/45">{item.label}</div>
                        <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">{item.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-8 h-px bg-slate-100 dark:bg-white/10" />
                </div>
              )}

              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white/85">
                  <Sparkles className="h-4 w-4 text-sky-600" />
                  {t('marketplace.changelogTitle', { defaultValue: 'Changelog' })}
                </div>
                <Separator className="my-4 bg-black/8 dark:bg-white/10" />
                {latestChangelog ? (
                  <p className="whitespace-pre-wrap text-[14px] leading-7 text-slate-600 dark:text-white/72">{latestChangelog}</p>
                ) : (
                  <p className="text-[14px] leading-7 text-slate-400 dark:text-white/45">
                    {t('marketplace.noChangelog', { defaultValue: 'No changelog provided.' })}
                  </p>
                )}
              </div>

              <div className="h-px bg-slate-100 dark:bg-white/10" />

              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white/85">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  {t('marketplace.securityTitle', { defaultValue: 'Security' })}
                </div>
                <Separator className="my-4 bg-black/8 dark:bg-white/10" />
                <div className="grid gap-3 text-[14px] leading-7 text-slate-600 dark:text-white/72">
                  <div className="flex items-start gap-3">
                    {scanStatus === 'clean' ? <ShieldCheck className="mt-1 h-4 w-4 text-emerald-600" /> : <ShieldAlert className="mt-1 h-4 w-4 text-amber-600" />}
                    <div>
                      <div className="font-medium text-slate-900 dark:text-white">{scan?.summary || t('marketplace.staticScanSummary', { defaultValue: 'No scan summary available.' })}</div>
                      <div className="text-slate-400 dark:text-white/52">
                        {scan?.engineVersion ? `${scan.engineVersion}` : ''}
                        {scan?.checkedAt ? ` · ${formatDateTime(scan.checkedAt)}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <BadgeCheck className="mt-1 h-4 w-4 text-sky-600" />
                    <div>
                      <div className="font-medium text-slate-900 dark:text-white">{t('marketplace.licenseLabel', { defaultValue: 'License' })}</div>
                      <div className="text-slate-400 dark:text-white/52">{license}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <ExternalLink className="mt-1 h-4 w-4 text-slate-500" />
                    <div>
                      <div className="font-medium text-slate-900 dark:text-white">{t('marketplace.identityLabel', { defaultValue: 'Identity' })}</div>
                      <div className="text-slate-400 dark:text-white/52">
                        {detail.resolvedSlug || slug}
                        {detail.forkOf ? ` · ${t('marketplace.forkedFrom', { source: detail.forkOf })}` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="h-px bg-slate-100 dark:bg-white/10" />

              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white/85">
                  <FileText className="h-4 w-4 text-violet-600" />
                  {t('marketplace.filesTitle', { defaultValue: 'Files' })}
                </div>
                <Separator className="my-4 bg-black/8 dark:bg-white/10" />
                {fileCount > 0 ? (
                  <div data-testid="skills-marketplace-detail-files" className="grid gap-2">
                    {detail.latestVersion?.files?.map((file) => (
                      <div key={file.path} className="flex items-start justify-between gap-4 rounded-2xl bg-slate-50/70 px-4 py-3 text-[13px] dark:bg-white/[0.04]">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900 dark:text-white">{file.path}</div>
                          <div className="mt-1 text-slate-400 dark:text-white/50">
                            {file.contentType || t('marketplace.unknownContentType')}
                            {typeof file.size === 'number' ? ` · ${t('marketplace.fileSizeBytes', { size: formatInteger(file.size) })}` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[14px] leading-7 text-slate-400 dark:text-white/45">
                    {t('marketplace.noFiles', { defaultValue: 'No file metadata provided.' })}
                  </p>
                )}
              </div>
            </TabsContent>
          </div>
        </section>
      </Tabs>
    </div>
  );
}
