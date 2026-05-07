import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, ExternalLink, Eye, EyeOff, ShieldAlert, Trash2 } from 'lucide-react';
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
import type { SkillConfigItem, SkillDetail, SkillMissingStatus } from '@/types/skill';
import { SkillDetailMarkdownContent } from './SkillDetailMarkdownContent';
import { SkillDetailOverviewCard } from './SkillDetailOverviewCard';

type SkillDetailContentProps = {
  detail: SkillDetail;
  onDeleted?: () => void;
  initialTab?: 'docs' | 'config';
};

function flattenMissingRequirements(
  missing: SkillMissingStatus | undefined,
  t: (key: string) => string,
): string[] {
  if (!missing) return [];
  return [
    ...(missing.bins ?? []).map((item) => `${t('detail.missingLabel.bin')}: ${item}`),
    ...(missing.anyBins ?? []).map((item) => `${t('detail.missingLabel.anyBin')}: ${item}`),
    ...(missing.env ?? []).map((item) => `${t('detail.missingLabel.env')}: ${item}`),
    ...(missing.config ?? []).map((item) => `${t('detail.missingLabel.config')}: ${item}`),
    ...(missing.os ?? []).map((item) => `${t('detail.missingLabel.os')}: ${item}`),
  ];
}

function toEditableString(value: SkillConfigItem['value']): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

function buildStorageHint(item: SkillConfigItem, t: (key: string, options?: Record<string, unknown>) => string): string {
  const hints = item.storageTargets.map((target) => {
    if (target.kind === 'file-env') {
      return t('detail.storage.envFile', { path: target.path });
    }
    if (target.kind === 'file-json') {
      return t('detail.storage.configFile', { path: target.path });
    }
    return '';
  }).filter(Boolean);

  return Array.from(new Set(hints)).join(' · ');
}

function ConfigField({
  item,
  value,
  onChange,
  t,
  dataTestId,
}: {
  item: SkillConfigItem;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  dataTestId?: string;
}) {
  const [showSecret, setShowSecret] = useState(false);
  const configured = typeof value === 'boolean'
    ? true
    : String(value ?? '').trim().length > 0;
  const configuredText = configured ? t('detail.configured') : t('detail.missingValue');
  const storageHint = buildStorageHint(item, t);
  const showKey = item.key && item.key !== item.label;

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-[14px] font-medium text-slate-900 dark:text-white">
          {item.required && <span className="text-red-500 dark:text-red-400">*</span>}
          <span>{item.label}</span>
        </div>
        {!configured && (
          <Badge variant="secondary" className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            {configuredText}
          </Badge>
        )}
      </div>
      {showKey && <div className="mt-1 text-[12px] text-slate-500 dark:text-white/50">{item.key}</div>}
      {storageHint && !configured && (
        <div className="mt-1 text-[12px] text-slate-500 dark:text-white/50">{storageHint}</div>
      )}

      <div className="mt-3">
        {item.type === 'boolean' ? (
          <div className="flex h-11 items-center justify-between rounded-xl border border-slate-300 bg-transparent px-3 dark:border-white/12">
            <span className="text-[13px] text-slate-600 dark:text-white/70">{t('detail.booleanLabel')}</span>
            <Switch checked={Boolean(value)} onCheckedChange={onChange} data-testid={dataTestId} />
          </div>
        ) : (
          <div className="relative">
            <Input
              data-testid={dataTestId}
              type={item.type === 'secret' ? (showSecret ? 'text' : 'password') : (item.type === 'number' ? 'number' : 'text')}
              value={typeof value === 'string' || typeof value === 'number' ? value : ''}
              onChange={(event) => onChange(item.type === 'number' ? event.target.value : event.target.value)}
              placeholder={item.type === 'url' ? 'https://example.com' : item.key}
              className={cn(
                pageInputSurfaceClasses,
                'h-11 rounded-xl border-slate-300 bg-transparent font-mono text-[13px] dark:border-white/12',
                item.type === 'secret' && 'pr-11',
              )}
            />
            {item.type === 'secret' && (
              <button
                type="button"
                data-testid={dataTestId ? `${dataTestId}-toggle-visibility` : undefined}
                aria-label={showSecret ? t('detail.hideValue', { defaultValue: 'Hide value' }) : t('detail.showValue', { defaultValue: 'Show value' })}
                onClick={() => setShowSecret((current) => !current)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700 dark:text-white/40 dark:hover:text-white/75"
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeConfigInputValue(item: SkillConfigItem, value: string | number | boolean): unknown {
  if (item.type === 'boolean') {
    return Boolean(value);
  }
  if (item.type === 'number') {
    const raw = typeof value === 'number' ? value : Number(String(value).trim());
    return Number.isNaN(raw) ? '' : raw;
  }
  return String(value);
}

export function SkillDetailContent({ detail, onDeleted, initialTab = 'docs' }: SkillDetailContentProps) {
  const { t } = useTranslation('skills');
  const { fetchSkillDetail, saveSkillConfig, enableSkill, disableSkill, deleteSkill, deleting } = useSkillsStore();
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [configValues, setConfigValues] = useState<Record<string, string | number | boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'docs' | 'config'>(initialTab);

  const status = detail.status ?? { enabled: false, ready: false };
  const requirements = detail.requirements ?? {};
  const configuration = detail.configuration ?? { credentials: [], optional: [], config: [], runtime: [] };
  const missingItems = flattenMissingRequirements(status.missing, t);
  const hasMissing = missingItems.length > 0;
  const isReady = Boolean(status.ready) && !hasMissing;
  const setupFields = useMemo(
    () => [...(configuration.credentials ?? []), ...(configuration.optional ?? [])],
    [configuration.credentials, configuration.optional],
  );

  useEffect(() => {
    const nextCredentialValues: Record<string, string> = {};
    for (const item of setupFields) {
      nextCredentialValues[item.key] = toEditableString(item.value);
    }
    setCredentialValues(nextCredentialValues);

    const nextConfigValues: Record<string, string | number | boolean> = {};
    for (const item of configuration.config ?? []) {
      nextConfigValues[item.key] = item.value ?? (item.type === 'boolean' ? false : '');
    }
    setConfigValues(nextConfigValues);
  }, [configuration.config, setupFields]);

  const hasSetupFields = setupFields.length > 0;
  const hasConfigFields = (configuration.config ?? []).length > 0;
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
      const credentialItems = setupFields;
      const primaryCredential = credentialItems.find((item) => item.source === 'apiKey');
      const apiKey = primaryCredential ? (credentialValues[primaryCredential.key] ?? '') : '';

      const env = credentialItems
        .filter((item) => item.source === 'env')
        .reduce<Record<string, string>>((acc, item) => {
          acc[item.key] = credentialValues[item.key] ?? '';
          return acc;
        }, {});

      const config = (configuration.config ?? []).reduce<Record<string, unknown>>((acc, item) => {
        const rawValue = configValues[item.key];
        const normalized = normalizeConfigInputValue(item, rawValue ?? '');
        acc[item.key] = normalized;
        return acc;
      }, {});

      await saveSkillConfig(detail.identity.id, {
        apiKey,
        env,
        config,
      });
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
                  onClick={(event) => {
                    event.preventDefault();
                    void window.electron?.openExternal?.(detail.identity.homepage!);
                  }}
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
                <TabsTrigger data-testid="skills-detail-tab-docs" value="docs" variant="page">{t('detail.docsTab')}</TabsTrigger>
                <TabsTrigger data-testid="skills-detail-tab-config" value="config" variant="page">{t('detail.configTab', 'Configuration')}</TabsTrigger>
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

              <TabsContent value="config" data-testid="skills-detail-setup" className="mt-0 space-y-6">
                <div className="space-y-8">
                  <section data-testid="skills-config-card-settings">
                    <div className="pb-2 text-[16px] font-semibold text-slate-900 dark:text-white">{t('detail.configTab', 'Configuration')}</div>

                    {!hasSetupFields && !hasConfigFields ? (
                      <div
                        data-testid="skills-config-card-settings-empty"
                        className="py-2 text-[14px] text-slate-600 dark:text-white/60"
                      >
                        {t('detail.noSetupRequired', { defaultValue: 'No configuration required.' })}
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {hasSetupFields && (
                          <div data-testid="skills-config-card-credentials">
                            <div className="pb-2 text-[14px] font-medium text-slate-700 dark:text-white/80">{t('detail.credentialsTitle')}</div>
                            <div className="divide-y divide-slate-200 dark:divide-white/10">
                              {setupFields.map((item, index) => (
                                <ConfigField
                                  key={item.key}
                                  item={item}
                                  value={credentialValues[item.key] ?? ''}
                                  onChange={(value) => setCredentialValues((current) => ({ ...current, [item.key]: String(value) }))}
                                  t={t}
                                  dataTestId={index === 0 ? 'skills-detail-primary-env-input' : undefined}
                                />
                              ))}
                            </div>
                          </div>
                        )}

                        {hasConfigFields && (
                          <div data-testid="skills-config-card-schema">
                            <div className="pb-2 text-[14px] font-medium text-slate-700 dark:text-white/80">{t('detail.configuration')}</div>
                            <div className="divide-y divide-slate-200 dark:divide-white/10">
                              {configuration.config.map((item) => (
                                <ConfigField
                                  key={item.key}
                                  item={item}
                                  value={configValues[item.key] ?? (item.type === 'boolean' ? false : '')}
                                  onChange={(value) => setConfigValues((current) => ({ ...current, [item.key]: value }))}
                                  t={t}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>

                    <section data-testid="skills-config-card-runtime">
                      <div className="pb-2 text-[16px] font-semibold text-slate-900 dark:text-white">{t('detail.requirementsTab', 'Runtime Requirements')}</div>

                      <div className="space-y-2 text-[14px] leading-6 text-slate-700 dark:text-white/75">
                        {!hasMissing && (
                          <div className="flex items-start gap-2">
                            <CheckCircle className="mt-1 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            <span>{t('detail.noMissingRequirements', { defaultValue: 'No missing requirements.' })}</span>
                          </div>
                        )}

                        {hasMissing && (
                          <div data-testid="skills-runtime-missing-list" className="space-y-2 pt-2 text-[13px] text-slate-700 dark:text-white/70">
                            <ul className="space-y-2">
                              {missingItems.map((item, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                                  <span>{t('detail.missingPrefix', { defaultValue: 'Missing' })} {item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                    </section>

                    {(configuration.mirrors?.envFilePath || configuration.mirrors?.configFilePath) && (
                      <section data-testid="skills-config-card-storage">
                        <div className="pb-2 text-[16px] font-semibold text-slate-900 dark:text-white">{t('detail.storageTitle', { defaultValue: 'Storage & mirrors' })}</div>
                        <div className="space-y-2 text-[12px] leading-5 text-slate-600 dark:text-white/55">
                          {configuration.mirrors?.envFilePath && <div>{t('detail.storage.envFile', { path: configuration.mirrors.envFilePath })}</div>}
                          {configuration.mirrors?.configFilePath && <div>{t('detail.storage.configFile', { path: configuration.mirrors.configFilePath })}</div>}
                        </div>
                      </section>
                    )}
                  </div>

                <section data-testid="skills-config-overview" className="flex justify-end pt-2">
                  <Button data-testid="skills-detail-save-config" onClick={onSave} disabled={saving} className="rounded-full px-5">
                    {saving ? t('detail.saving') : t('detail.saveConfig')}
                  </Button>
                </section>
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
