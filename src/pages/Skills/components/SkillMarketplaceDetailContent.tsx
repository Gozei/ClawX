import { useMemo, useState } from 'react';
import {
  ArrowLeft,
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
import { MarkdownRenderer } from '@/pages/Chat/MarkdownRenderer';
import { cn } from '@/lib/utils';
import { useSkillsStore } from '@/stores/skills';
import type { MarketplaceInstalledSkill, MarketplaceSkillDetail, SkillSnapshot } from '@/types/skill';

function normalizeSkillKey(value?: string): string {
  return value?.trim().toLowerCase() ?? '';
}

function getPathLeaf(value?: string): string {
  if (!value) return '';
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  return normalizeSkillKey(parts[parts.length - 1]);
}

function compareVersions(left?: string, right?: string) {
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
}

function resolveInstalledSkillId(slug: string, skills: SkillSnapshot[]): string {
  const targetKey = normalizeSkillKey(slug);
  if (!targetKey) return slug;

  const matchedSkill = skills.find((skill) => {
    if (!skill) return false;
    return normalizeSkillKey(skill.id) === targetKey
      || normalizeSkillKey(skill.slug) === targetKey
      || getPathLeaf(skill.baseDir) === targetKey
      || getPathLeaf(skill.filePath) === targetKey;
  });

  return matchedSkill?.id || slug;
}

type SkillMarketplaceDetailContentProps = {
  detail: MarketplaceSkillDetail;
  installedSkills: MarketplaceInstalledSkill[];
  sourceId?: string;
  showBackButton?: boolean;
  onBack?: () => void;
  backLabel?: string;
};

export function SkillMarketplaceDetailContent({
  detail,
  installedSkills,
  sourceId,
  showBackButton = true,
  onBack,
  backLabel,
}: SkillMarketplaceDetailContentProps) {
  const { t } = useTranslation('skills');
  const [installing, setInstalling] = useState(false);
  const installSkill = useSkillsStore((state) => state.installSkill);
  const enableSkill = useSkillsStore((state) => state.enableSkill);

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
  const currentInstalledSkill = installedSkills.find((entry) => {
    if (!entry || normalizeSkillKey(entry.slug) !== normalizeSkillKey(slug)) return false;
    return sourceId ? entry.sourceId === sourceId : true;
  });
  const installedOnCurrentSource = Boolean(currentInstalledSkill && sourceId && currentInstalledSkill.sourceId === sourceId);
  const occupiedByOtherSource = Boolean(currentInstalledSkill && sourceId && currentInstalledSkill.sourceId && currentInstalledSkill.sourceId !== sourceId);
  const hasUpdate = installedOnCurrentSource && compareVersions(version, currentInstalledSkill?.version) > 0;
  const detailStateLabel = occupiedByOtherSource
    ? t('marketplace.occupiedAction', { defaultValue: 'Provided by another source' })
    : installedOnCurrentSource && hasUpdate
      ? t('marketplace.updateAvailableState', { defaultValue: 'Update available' })
      : installedOnCurrentSource
        ? t('marketplace.installedState', { defaultValue: 'Installed' })
        : t('marketplace.notInstalledState', { defaultValue: 'Not installed' });

  const stats = useMemo(() => {
    const skillStats = detail.skill?.stats;
    return [
      typeof skillStats?.downloads === 'number' ? { label: t('marketplace.downloads', { defaultValue: 'Downloads' }), value: skillStats.downloads.toLocaleString() } : null,
      typeof skillStats?.stars === 'number' ? { label: t('marketplace.stars', { defaultValue: 'Stars' }), value: skillStats.stars.toLocaleString() } : null,
      typeof skillStats?.versions === 'number' ? { label: t('marketplace.versions', { defaultValue: 'Versions' }), value: skillStats.versions.toLocaleString() } : null,
    ].filter(Boolean) as Array<{ label: string; value: string }>;
  }, [detail.skill?.stats, t]);

  const onInstall = async () => {
    if (!slug) return;
    if (occupiedByOtherSource) return;
    setInstalling(true);
    try {
      await installSkill(slug, version, sourceId, hasUpdate);
      const installedSkillId = resolveInstalledSkillId(slug, useSkillsStore.getState().skills ?? []);
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
      <section className="rounded-[24px] bg-white p-6 shadow-[0_4px_24px_rgb(0,0,0,0.03)] dark:bg-card sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-2xl shadow-inner shadow-white/40 dark:bg-white/[0.05] dark:shadow-none">
                <Package className="h-6 w-6 text-slate-600 dark:text-white/80" />
              </div>
              <div className="min-w-0">
                <h1 data-testid="skills-marketplace-detail-title" className="truncate text-3xl font-semibold tracking-tight text-foreground">
                  {title}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-foreground/70">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1 font-medium dark:bg-white/[0.08]">
                    <User className="h-3.5 w-3.5" />
                    {authorLabel}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1 font-mono text-xs dark:bg-white/[0.08]">
                    {slug}
                  </span>
                  <span className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                    occupiedByOtherSource
                      ? 'bg-amber-500/12 text-amber-700 dark:bg-amber-500/15 dark:text-amber-100'
                      : installedOnCurrentSource
                        ? 'bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-100'
                        : 'bg-slate-500/12 text-slate-700 dark:bg-slate-500/15 dark:text-slate-100',
                  )}>
                    {detailStateLabel}
                  </span>
                </div>
              </div>
            </div>
            <p className="mt-5 max-w-3xl whitespace-pre-wrap text-[15px] leading-7 text-foreground/74">
              {description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {showBackButton && onBack && (
              <Button type="button" variant="outline" onClick={onBack} className="rounded-full border-black/10 bg-transparent text-foreground/80 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {backLabel || t('detail.backToList')}
              </Button>
            )}
            <Button
              type="button"
              onClick={() => void onInstall()}
              disabled={installing || !slug || occupiedByOtherSource || (installedOnCurrentSource && !hasUpdate)}
              className="rounded-full bg-primary px-5 text-primary-foreground hover:bg-primary/90"
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
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Badge variant="secondary" className="border-0 bg-blue-500/12 text-blue-700 dark:text-blue-100">
            v{version}
          </Badge>
          <Badge variant="secondary" className={cn(
            'border-0',
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
            <Badge variant="secondary" className="border-0 bg-amber-500/12 text-amber-700 dark:text-amber-100">
              {t('marketplace.pendingReview', { defaultValue: 'Pending review' })}
            </Badge>
          )}
          {detail.canonical && (
            <Badge variant="secondary" className="border-0 bg-black/5 text-foreground/70 dark:bg-white/[0.08] dark:text-white/78">
              {detail.canonical}
            </Badge>
          )}
        </div>

        {stats.length > 0 && (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {stats.map((item) => (
              <div key={item.label} className="rounded-2xl bg-black/3 p-4 dark:bg-white/[0.04]">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-foreground/45">{item.label}</div>
                <div className="mt-2 text-lg font-semibold text-foreground">{item.value}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-6">
        <div className="rounded-[24px] bg-white p-6 shadow-[0_4px_24px_rgb(0,0,0,0.03)] dark:bg-card sm:p-7">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground/85">
            <FileText className="h-4 w-4 text-violet-600" />
            {t('detail.rawSkillMd')}
          </div>
          <Separator className="my-4 bg-black/8 dark:bg-white/10" />
          <div data-testid="skills-marketplace-detail-docs" className="min-w-0 max-w-full overflow-x-hidden">
            <div className="prose prose-slate prose-sm max-w-none break-words [overflow-wrap:anywhere] prose-headings:font-semibold dark:prose-invert dark:prose-p:text-white/70 [&_img]:max-w-full [&_img]:h-auto [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:overflow-x-hidden [&_code]:break-all [&_table]:w-full [&_table]:table-fixed [&_table]:overflow-x-hidden [&_td]:break-words [&_th]:break-words">
              <MarkdownRenderer content={markdown || '*No documentation available.*'} />
            </div>
          </div>
        </div>

        <div className="rounded-[24px] bg-white p-6 shadow-[0_4px_24px_rgb(0,0,0,0.03)] dark:bg-card sm:p-7">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground/85">
            <Sparkles className="h-4 w-4 text-sky-600" />
            {t('marketplace.changelogTitle', { defaultValue: 'Changelog' })}
          </div>
          <Separator className="my-4 bg-black/8 dark:bg-white/10" />
          {latestChangelog ? (
            <p className="whitespace-pre-wrap text-[14px] leading-7 text-foreground/72">{latestChangelog}</p>
          ) : (
            <p className="text-[14px] leading-7 text-foreground/45">
              {t('marketplace.noChangelog', { defaultValue: 'No changelog provided.' })}
            </p>
          )}
        </div>

        <div className="rounded-[24px] bg-white p-6 shadow-[0_4px_24px_rgb(0,0,0,0.03)] dark:bg-card sm:p-7">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground/85">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            {t('marketplace.securityTitle', { defaultValue: 'Security' })}
          </div>
          <Separator className="my-4 bg-black/8 dark:bg-white/10" />
          <div className="grid gap-3 text-[14px] leading-7 text-foreground/72">
            <div className="flex items-start gap-3">
              {scanStatus === 'clean' ? <ShieldCheck className="mt-1 h-4 w-4 text-emerald-600" /> : <ShieldAlert className="mt-1 h-4 w-4 text-amber-600" />}
              <div>
                <div className="font-medium text-foreground">{scan?.summary || t('marketplace.staticScanSummary', { defaultValue: 'No scan summary available.' })}</div>
                <div className="text-foreground/52">
                  {scan?.engineVersion ? `${scan.engineVersion}` : ''}
                  {scan?.checkedAt ? ` · ${new Date(scan.checkedAt).toLocaleString()}` : ''}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <BadgeCheck className="mt-1 h-4 w-4 text-sky-600" />
              <div>
                <div className="font-medium text-foreground">{t('marketplace.licenseLabel', { defaultValue: 'License' })}</div>
                <div className="text-foreground/52">{license}</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ExternalLink className="mt-1 h-4 w-4 text-slate-500" />
              <div>
                <div className="font-medium text-foreground">{t('marketplace.identityLabel', { defaultValue: 'Identity' })}</div>
                <div className="text-foreground/52">
                  {detail.resolvedSlug || slug}
                  {detail.forkOf ? ` · forked from ${detail.forkOf}` : ''}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[24px] bg-white p-6 shadow-[0_4px_24px_rgb(0,0,0,0.03)] dark:bg-card sm:p-7">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground/85">
            <FileText className="h-4 w-4 text-violet-600" />
            {t('marketplace.filesTitle', { defaultValue: 'Files' })}
          </div>
          <Separator className="my-4 bg-black/8 dark:bg-white/10" />
          {fileCount > 0 ? (
            <div data-testid="skills-marketplace-detail-files" className="grid gap-2">
              {detail.latestVersion?.files?.map((file) => (
                <div key={file.path} className="flex items-start justify-between gap-4 rounded-2xl bg-black/3 px-4 py-3 text-[13px] dark:bg-white/[0.04]">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{file.path}</div>
                    <div className="mt-1 text-foreground/50">
                      {file.contentType || 'unknown'}
                      {typeof file.size === 'number' ? ` · ${file.size.toLocaleString()} bytes` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[14px] leading-7 text-foreground/45">
              {t('marketplace.noFiles', { defaultValue: 'No file metadata provided.' })}
            </p>
          )}
        </div>

      </section>
    </div>
  );
}
