import { useEffect, useState } from 'react';
import { ExternalLink, ShieldAlert, Trash2, CheckCircle, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { MarkdownRenderer } from '@/pages/Chat/MarkdownRenderer';
import { useSkillsStore } from '@/stores/skills';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { SkillDetail, SkillMissingStatus } from '@/types/skill';
import { skillInputClasses } from './constants';

type SkillDetailContentProps = {
  detail: SkillDetail;
  onDeleted?: () => void;
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

export function SkillDetailContent({ detail, onDeleted }: SkillDetailContentProps) {
  const { t } = useTranslation('skills');
  const { fetchSkillDetail, saveSkillConfig, enableSkill, disableSkill, deleteSkill, deleting } = useSkillsStore();
  const [apiKey, setApiKey] = useState('');
  const [envRows, setEnvRows] = useState<Array<{ key: string; value: string }>>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  const [activeTab, setActiveTab] = useState<'docs' | 'config'>('docs');

  const missingItems = flattenMissingRequirements(detail.status.missing);
  const hasMissing = missingItems.length > 0;
  const isReady = detail.status.ready && !hasMissing;

  useEffect(() => {
    setApiKey(detail.config.apiKey || '');
    const primaryEnv = detail.requirements.primaryEnv;
    const requiredKeys = new Set(detail.requirements.requires?.env || []);
    const currentEnv = detail.config.env || {};
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
  }, [detail]);

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
        {/* === 统一且优雅的顶部概览卡片 === */}
        <section data-testid="skills-detail-overview" className="rounded-[24px] bg-white p-6 shadow-[0_4px_24px_rgb(0,0,0,0.03)] dark:bg-card sm:p-7">

          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            {/* 左侧：图标、标题、描述 */}
            <div className="flex min-w-0 items-start gap-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] bg-sky-50 text-3xl text-sky-700 shadow-sm shadow-sky-100/50 dark:bg-sky-500/10 dark:text-sky-200 dark:shadow-none">
                {detail.identity.icon || '📦'}
              </div>
              <div className="min-w-0 pt-0.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="truncate text-[24px] font-bold tracking-tight text-slate-900 dark:text-white">
                    {detail.identity.name}
                  </h2>
                  <Badge variant="secondary" className="rounded-md border-0 bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-white/70">
                    v{detail.identity.version || '1.0.0'}
                  </Badge>
                  {detail.identity.source && (
                    <Badge variant="secondary" className="rounded-md border-0 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200">
                      {detail.identity.source}
                    </Badge>
                  )}
                  {/* 精致的状态徽章，替代原来的横条 */}
                  <div className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-medium",
                    isReady
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                  )}>
                    {isReady ? <CheckCircle className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                    {isReady ? t('list.ready') : t('detail.missingRuntimeRequirements')}
                  </div>
                </div>
                <p className="mt-2.5 max-w-2xl text-[14px] leading-relaxed text-slate-500 dark:text-white/60">
                  {detail.identity.description}
                </p>
              </div>
            </div>

            {/* 右上侧：极简操作区 */}
            <div className="flex shrink-0 items-center justify-center gap-3 self-center">
              <div className="flex h-11 items-center justify-center">
                <Switch
                  checked={detail.status.enabled}
                  onCheckedChange={onToggle}
                  aria-label={detail.status.enabled ? t('detail.disable') : t('detail.enable')}
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
            </div>
          </div>

          {/* 底部元信息区域 - 去除多余背景色，仅用轻柔的顶边框区隔，保持呼吸感 */}
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-slate-100 pt-5 text-[12px] text-slate-400 dark:border-white/8 dark:text-white/45">
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
                <span className="font-medium text-slate-500 dark:text-white/60">Path:</span>
                <span className="truncate">{detail.identity.baseDir}</span>
              </button>
            )}
          </div>
        </section>

        {/* === 详情区域 (仅 文档 与 设置) === */}
        <section className="overflow-hidden rounded-[24px] bg-white shadow-[0_4px_24px_rgb(0,0,0,0.03)] dark:bg-card">
          <div className="flex gap-6 border-b border-slate-200 px-6 pt-2 dark:border-white/10 sm:px-8">
            {([
              ['docs', t('detail.docsTab')],
              ['config', t('detail.configTab', 'Configuration')],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={cn(
                  'border-b-2 px-1 pb-3 pt-4 text-[14px] font-medium transition-colors',
                  activeTab === key
                    ? 'border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-300'
                    : 'border-transparent text-slate-400 hover:border-slate-300 hover:text-slate-600 dark:text-white/40 dark:hover:border-white/20 dark:hover:text-white/70',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-6 sm:p-8">
            {/* --- 文档 Tab --- */}
            {activeTab === 'docs' && (
              <div data-testid="skills-detail-docs">
                {detail.requirements.parseError && (
                  <div className="mb-6 flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{t('detail.parseFailed', { error: detail.requirements.parseError })}</p>
                  </div>
                )}
                <div className="prose prose-slate prose-sm max-w-none prose-headings:font-semibold dark:prose-invert dark:prose-p:text-white/70">
                  <MarkdownRenderer content={detail.requirements.rawMarkdown || '*No documentation available.*'} />
                </div>
              </div>
            )}

            {/* --- 合并后的 设置(Config) + 依赖(Requirements) Tab --- */}
            {activeTab === 'config' && (
              <div data-testid="skills-detail-setup" className="max-w-3xl space-y-10">

                {/* 1. 运行依赖与状态反馈 (Requirements & Status) */}
                <div className="space-y-4">
                  <div>
                    <h3 className="text-[16px] font-semibold text-slate-900 dark:text-white">
                      {t('detail.requirementsTab', 'Runtime Requirements')}
                    </h3>
                    <p className="mt-1 text-[13px] text-slate-500 dark:text-white/60">
                      Dependencies and environments required for this skill to operate.
                    </p>
                  </div>

                  {/* 如果缺少依赖，在此处进行详细且醒目的提示 */}
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

                  {/* 依赖项列表 */}
                  <div className="flex flex-wrap gap-x-8 gap-y-3 rounded-xl bg-slate-50/50 p-4 text-[13px] dark:bg-white/[0.02]">
                    {detail.requirements.requires?.bins && detail.requirements.requires.bins.length > 0 && (
                      <div>
                        <span className="block text-[12px] font-medium text-slate-400 dark:text-white/50">Required Bins</span>
                        <span className="mt-0.5 block text-slate-700 dark:text-white/80">{detail.requirements.requires.bins.join(', ')}</span>
                      </div>
                    )}
                    {detail.requirements.requires?.env && detail.requirements.requires.env.length > 0 && (
                      <div>
                        <span className="block text-[12px] font-medium text-slate-400 dark:text-white/50">Required Env</span>
                        <span className="mt-0.5 block text-slate-700 dark:text-white/80">{detail.requirements.requires.env.join(', ')}</span>
                      </div>
                    )}
                    {detail.requirements.requires?.anyBins && detail.requirements.requires.anyBins.length > 0 && (
                      <div>
                        <span className="block text-[12px] font-medium text-slate-400 dark:text-white/50">Any Bins</span>
                        <span className="mt-0.5 block text-slate-700 dark:text-white/80">{detail.requirements.requires.anyBins.join(', ')}</span>
                      </div>
                    )}
                    {!(detail.requirements.requires?.bins?.length) && !(detail.requirements.requires?.env?.length) && (
                      <span className="text-slate-400 dark:text-white/40">No specific runtime requirements.</span>
                    )}
                  </div>
                </div>

                <div className="h-px bg-slate-100 dark:bg-white/10" />

                {/* 2. 具体的环境变量配置表单 */}
                <div className="space-y-6">
                  <div>
                    <h3 className="text-[16px] font-semibold text-slate-900 dark:text-white">
                      {t('detail.configuration')}
                    </h3>
                    <p className="mt-1 text-[13px] text-slate-500 dark:text-white/60">
                      {t('detail.setupSubtitle')}
                    </p>
                  </div>

                  {detail.requirements.primaryEnv && (
                    <div className="max-w-md">
                      <label className="mb-2 block text-[13px] font-medium text-slate-700 dark:text-white/70">
                        {t('detail.primaryCredential', { env: detail.requirements.primaryEnv })}
                      </label>
                      <Input
                        data-testid="skills-detail-primary-env-input"
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        className={cn(skillInputClasses, 'h-11 rounded-xl border-slate-300 bg-white font-mono text-[13px] dark:border-white/12 dark:bg-white/[0.03]')}
                      />
                    </div>
                  )}

                  <div className="space-y-3">
                    {envRows.map((row, index) => (
                      <div key={`${row.key}-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-3">
                        <Input
                          value={row.key}
                          onChange={(event) => setEnvRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))}
                          className={cn(skillInputClasses, 'h-11 rounded-xl border-slate-300 bg-white font-mono text-[13px] dark:border-white/12 dark:bg-white/[0.03]')}
                          placeholder={t('detail.keyPlaceholder')}
                        />
                        <Input
                          value={row.value}
                          onChange={(event) => setEnvRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))}
                          className={cn(skillInputClasses, 'h-11 rounded-xl border-slate-300 bg-white font-mono text-[13px] dark:border-white/12 dark:bg-white/[0.03]')}
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

              </div>
            )}
          </div>
        </section>
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
