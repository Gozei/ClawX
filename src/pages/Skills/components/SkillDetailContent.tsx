import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, ExternalLink, ShieldAlert, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { pageInputSurfaceClasses } from '@/components/layout/page-tokens';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { useSkillsStore } from '@/stores/skills';
import { toast } from 'sonner';
import type { SkillDetail, SkillMissingStatus } from '@/types/skill';
import { SkillDetailMarkdownContent } from './SkillDetailMarkdownContent';
import { SkillDetailOverviewCard } from './SkillDetailOverviewCard';

type SkillDetailContentProps = {
  detail: SkillDetail;
  onDeleted?: () => void;
  initialTab?: 'docs' | 'config';
};

function flattenMissingRequirements(missing?: SkillMissingStatus): string[] {
  if (!missing) return [];
  return [
    ...(missing.bins ?? []).map((item) => `bin: ${item}`),
    ...(missing.anyBins ?? []).map((item) => `any bin: ${item}`),
    ...(missing.env ?? []).map((item) => `env: ${item}`),
    ...(missing.config ?? []).map((item) => `config: ${item}`),
    ...(missing.os ?? []).map((item) => `os: ${item}`),
  ];
}

export function SkillDetailContent({ detail, onDeleted, initialTab = 'docs' }: SkillDetailContentProps) {
  const { t } = useTranslation('skills');
  const { fetchSkillDetail, saveSkillConfig, enableSkill, disableSkill, deleteSkill, deleting } = useSkillsStore();
  const [apiKey, setApiKey] = useState('');
  const [envRows, setEnvRows] = useState<Array<{ key: string; value: string }>>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'docs' | 'config'>(initialTab);

  const status = detail.status ?? { enabled: false, ready: false };
  const requirements = detail.requirements ?? {};
  const config = detail.config ?? {};

  const missingItems = flattenMissingRequirements(status.missing);
  const hasMissing = missingItems.length > 0;
  const isReady = Boolean(status.ready) && !hasMissing;

  useEffect(() => {
    setApiKey(config.apiKey || '');
    const primaryEnv = requirements.primaryEnv;
    const requiredKeys = new Set(requirements.requires?.env || []);
    const currentEnv = config.env || {};
    const rows: Array<{ key: string; value: string }> = [];

    requiredKeys.forEach((key) => {
      if (key !== primaryEnv) {
        rows.push({ key, value: currentEnv[key] || '' });
      }
    });

    Object.entries(currentEnv).forEach(([key, value]) => {
      if (key !== primaryEnv && !requiredKeys.has(key)) {
        rows.push({ key, value });
      }
    });

    setEnvRows(rows);
  }, [config.apiKey, config.env, requirements.primaryEnv, requirements.requires]);

  const onToggle = async (enabled: boolean) => {
    try {
      if (enabled) await enableSkill(detail.identity.id);
      else await disableSkill(detail.identity.id);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const env = envRows.reduce<Record<string, string>>((acc, row) => {
        const key = row.key.trim();
        const value = row.value.trim();
        if (key && value) acc[key] = value;
        return acc;
      }, {});
      await saveSkillConfig(detail.identity.id, { apiKey, env });
      await fetchSkillDetail(detail.identity.id, true);
      toast.success(t('detail.configSaved', { defaultValue: 'Config saved' }));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    await deleteSkill(detail.identity.id);
    setConfirmDelete(false);
    toast.success(t('detail.deleted', { name: detail.identity.name }));
    onDeleted?.();
  };

  const openSkillFolder = async () => {
    if (!detail.identity.baseDir) return;
    try {
      await hostApiFetch('/api/clawhub/open-path', {
        method: 'POST',
        body: JSON.stringify({
          skillKey: detail.identity.id,
          baseDir: detail.identity.baseDir,
        }),
      });
    } catch (error) {
      toast.error(String(error));
    }
  };

  return (
    <>
      <div data-testid="skills-detail-page-content" className="grid gap-6">
        <SkillDetailOverviewCard
          testId="skills-detail-overview"
          title={detail.identity.name}
          description={detail.identity.description}
          icon={detail.identity.icon || '📦'}
          badges={(
            <>
              <Badge variant="secondary" className="rounded-md border-0 bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-white/70">
                v{detail.identity.version || '1.0.0'}
              </Badge>
              {detail.identity.source && (
                <Badge variant="secondary" className="rounded-md border-0 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200">
                  {detail.identity.source}
                </Badge>
              )}
              <div
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-medium',
                  isReady
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                    : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
                )}
              >
                {isReady ? <CheckCircle className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                {isReady ? t('list.ready') : t('detail.missingRuntimeRequirements')}
              </div>
            </>
          )}
          actions={(
            <>
              <div className="flex h-11 items-center justify-center">
                <Switch
                  checked={Boolean(status.enabled)}
                  onCheckedChange={onToggle}
                  aria-label={status.enabled ? t('detail.disable') : t('detail.enable')}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('detail.deleteSkill')}
                onClick={() => setConfirmDelete(true)}
                disabled={Boolean(deleting[detail.identity.id])}
                className="flex h-11 w-11 items-center justify-center rounded-full border-0 bg-transparent p-0 text-red-500 shadow-none outline-none ring-0 hover:bg-transparent hover:text-red-500 focus-visible:ring-0 focus-visible:ring-offset-0 active:bg-transparent dark:text-red-400 dark:hover:bg-transparent dark:hover:text-red-400"
              >
                <Trash2 className="h-5 w-5" />
              </Button>
            </>
          )}
          metadata={(
            <>
              {detail.identity.author && (
                <span className="flex items-center gap-1.5">
                  <span className="font-medium text-slate-500 dark:text-white/60">{t('detail.author')}:</span>
                  {detail.identity.author}
                </span>
              )}

              {detail.identity.homepage && (
                <a
                  className="flex items-center gap-1.5 text-sky-600 transition-colors hover:text-sky-700 hover:underline dark:text-sky-400 dark:hover:text-sky-300"
                  href={detail.identity.homepage}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t('detail.openManual')}
                </a>
              )}

              {detail.identity.baseDir && (
                <button
                  type="button"
                  onClick={() => void openSkillFolder()}
                  className="flex max-w-[200px] items-center gap-1.5 truncate text-left transition-colors hover:text-slate-600 hover:underline dark:hover:text-white/70 sm:max-w-md"
                  title={detail.identity.baseDir}
                >
                  <span className="font-medium text-slate-500 dark:text-white/60">{t('detail.baseDir')}:</span>
                  <span className="truncate">{detail.identity.baseDir}</span>
                </button>
              )}
            </>
          )}
        />

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'docs' | 'config')}>
          <section className="overflow-hidden rounded-[24px] bg-white shadow-[0_4px_24px_rgb(0,0,0,0.03)] dark:bg-card">
            <div className="border-b border-slate-200 px-6 pt-2 dark:border-white/10 sm:px-8">
              <TabsList variant="page">
                <TabsTrigger value="docs" variant="page">{t('detail.docsTab')}</TabsTrigger>
                <TabsTrigger value="config" variant="page">{t('detail.configTab', 'Configuration')}</TabsTrigger>
              </TabsList>
            </div>

            <div className="p-6 sm:p-8">
              <TabsContent value="docs" data-testid="skills-detail-docs" className="mt-0">
                {requirements.parseError && (
                  <div className="mb-6 flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{t('detail.parseFailed', { error: requirements.parseError })}</p>
                  </div>
                )}
                <SkillDetailMarkdownContent content={requirements.rawMarkdown} />
              </TabsContent>

              <TabsContent value="config" data-testid="skills-detail-setup" className="mt-0 max-w-3xl space-y-10">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-[16px] font-semibold text-slate-900 dark:text-white">
                      {t('detail.requirementsTab', 'Runtime Requirements')}
                    </h3>
                    <p className="mt-1 text-[13px] text-slate-500 dark:text-white/60">
                      {t('detail.runtimeRequirementsDescription')}
                    </p>
                  </div>

                  {hasMissing && (
                    <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 text-[13px] dark:bg-amber-500/10">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <div>
                        <p className="font-medium text-amber-800 dark:text-amber-300">
                          {t('detail.missingRuntimeRequirements')}
                        </p>
                        <ul className="mt-1.5 list-disc pl-4 text-amber-700/80 dark:text-amber-400/80">
                          {missingItems.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-x-8 gap-y-3 rounded-xl bg-slate-50/50 p-4 text-[13px] dark:bg-white/[0.02]">
                    {requirements.requires?.bins && requirements.requires.bins.length > 0 && (
                      <div>
                        <span className="block text-[12px] font-medium text-slate-400 dark:text-white/50">{t('detail.requiredBins')}</span>
                        <span className="mt-0.5 block text-slate-700 dark:text-white/80">{requirements.requires.bins.join(', ')}</span>
                      </div>
                    )}
                    {requirements.requires?.env && requirements.requires.env.length > 0 && (
                      <div>
                        <span className="block text-[12px] font-medium text-slate-400 dark:text-white/50">{t('detail.requiredEnv')}</span>
                        <span className="mt-0.5 block text-slate-700 dark:text-white/80">{requirements.requires.env.join(', ')}</span>
                      </div>
                    )}
                    {requirements.requires?.anyBins && requirements.requires.anyBins.length > 0 && (
                      <div>
                        <span className="block text-[12px] font-medium text-slate-400 dark:text-white/50">{t('detail.anyBins')}</span>
                        <span className="mt-0.5 block text-slate-700 dark:text-white/80">{requirements.requires.anyBins.join(', ')}</span>
                      </div>
                    )}
                    {!(requirements.requires?.bins?.length) && !(requirements.requires?.env?.length) && !(requirements.requires?.anyBins?.length) && (
                      <span className="text-slate-400 dark:text-white/40">{t('detail.noSpecificRuntimeRequirements')}</span>
                    )}
                  </div>
                </div>

                <div className="h-px bg-slate-100 dark:bg-white/10" />

                <div className="space-y-6">
                  <div>
                    <h3 className="text-[16px] font-semibold text-slate-900 dark:text-white">
                      {t('detail.configuration')}
                    </h3>
                    <p className="mt-1 text-[13px] text-slate-500 dark:text-white/60">
                      {t('detail.setupSubtitle')}
                    </p>
                  </div>

                  {requirements.primaryEnv && (
                    <div className="max-w-md">
                      <label className="mb-2 block text-[13px] font-medium text-slate-700 dark:text-white/70">
                        {t('detail.primaryCredential', { env: requirements.primaryEnv })}
                      </label>
                      <Input
                        data-testid="skills-detail-primary-env-input"
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        className={cn(pageInputSurfaceClasses, 'h-11 rounded-xl border-slate-300 bg-white font-mono text-[13px] dark:border-white/12 dark:bg-white/[0.03]')}
                      />
                    </div>
                  )}

                  <div className="space-y-3">
                    {envRows.map((row, index) => (
                      <div key={`${row.key}-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-3">
                        <Input
                          value={row.key}
                          onChange={(event) => setEnvRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))}
                          className={cn(pageInputSurfaceClasses, 'h-11 rounded-xl border-slate-300 bg-white font-mono text-[13px] dark:border-white/12 dark:bg-white/[0.03]')}
                          placeholder={t('detail.keyPlaceholder')}
                        />
                        <Input
                          value={row.value}
                          onChange={(event) => setEnvRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))}
                          className={cn(pageInputSurfaceClasses, 'h-11 rounded-xl border-slate-300 bg-white font-mono text-[13px] dark:border-white/12 dark:bg-white/[0.03]')}
                          placeholder={t('detail.valuePlaceholder')}
                        />
                        <Button variant="ghost" size="icon" onClick={() => setEnvRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="h-11 w-11 shrink-0 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-white/50 dark:hover:bg-white/[0.06] dark:hover:text-white">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-4 pt-2">
                    <Button
                      data-testid="skills-detail-add-env-button"
                      variant="outline"
                      onClick={() => setEnvRows((current) => [...current, { key: '', value: '' }])}
                      className="rounded-full border-slate-300 bg-white px-5 text-slate-700 hover:bg-slate-50 dark:border-white/12 dark:bg-white/[0.03] dark:text-white/80 dark:hover:bg-white/[0.06]"
                    >
                      {t('detail.addVariable')}
                    </Button>
                    <Button data-testid="skills-detail-save-config" onClick={onSave} disabled={saving} className="rounded-full bg-sky-600 px-6 text-white hover:bg-sky-700 dark:bg-sky-600 dark:hover:bg-sky-500">
                      {saving ? t('detail.saving') : t('detail.saveConfig')}
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </div>
          </section>
        </Tabs>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t('detail.deleteConfirmTitle')}
        message={t('detail.deleteConfirmMessage')}
        confirmLabel={t('detail.deleteSkill')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
        onError={(error) => toast.error(String(error))}
      />
    </>
  );
}
