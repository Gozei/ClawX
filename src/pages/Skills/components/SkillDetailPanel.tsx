import { useEffect, useState } from 'react';
import { ShieldAlert, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { MarkdownRenderer } from '@/pages/Chat/MarkdownRenderer';
import { useSkillsStore } from '@/stores/skills';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { SkillDetail, SkillMissingStatus } from '@/types/skill';
import { skillCardClasses, skillInputClasses, skillPrimaryControlClasses } from './constants';

type SkillDetailPanelProps = {
  detail?: SkillDetail;
  loading: boolean;
  onClose: () => void;
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

export function SkillDetailPanel({ detail, loading, onClose }: SkillDetailPanelProps) {
  const { t } = useTranslation('skills');
  const { fetchSkillDetail, saveSkillConfig, enableSkill, disableSkill, deleteSkill, deleting } = useSkillsStore();
  const [apiKey, setApiKey] = useState('');
  const [envRows, setEnvRows] = useState<Array<{ key: string; value: string }>>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const missingItems = flattenMissingRequirements(detail?.runtime.missing);

  useEffect(() => {
    if (!detail) return;
    setApiKey(detail.config.apiKey || '');
    const primaryEnv = detail.spec.primaryEnv;
    const requiredKeys = new Set(detail.spec.requires?.env || []);
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
    if (!detail) return;
    try {
      if (enabled) await enableSkill(detail.skill.id);
      else await disableSkill(detail.skill.id);
      await fetchSkillDetail(detail.skill.id, true);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const onSave = async () => {
    if (!detail || saving) return;
    setSaving(true);
    try {
      const env = envRows.reduce<Record<string, string>>((acc, row) => {
        const key = row.key.trim();
        const value = row.value.trim();
        if (key && value) acc[key] = value;
        return acc;
      }, {});
      await saveSkillConfig(detail.skill.id, { apiKey, env });
      await fetchSkillDetail(detail.skill.id, true);
      toast.success(t('detail.configSaved', { defaultValue: 'Config saved' }));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!detail) return;
    await deleteSkill(detail.skill.id);
    setConfirmDelete(false);
    onClose();
  };

  return (
    <>
      <Sheet open={Boolean(detail) || loading} onOpenChange={(open) => !open && onClose()}>
        <SheetContent data-testid="skills-detail-sheet" side="right" className="w-full overflow-y-auto border-l border-black/10 bg-background p-6 dark:border-white/10 dark:bg-card sm:max-w-[720px]">
          {loading && <div className="flex min-h-[240px] items-center justify-center"><LoadingSpinner size="lg" /></div>}
          {!loading && detail && (
            <div className="grid gap-4">
              <section data-testid="skills-detail-overview" className={cn(skillCardClasses, 'p-5')}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[28px] font-semibold tracking-[-0.03em]">{detail.skill.name}</h2>
                    <p className="mt-2 text-[14px] text-muted-foreground">{detail.skill.description}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="secondary" className="border-0 bg-black/[0.04] text-foreground/70 dark:bg-white/[0.08] dark:text-white/72">v{detail.skill.version || '1.0.0'}</Badge>
                      <Badge variant="secondary" className={detail.skill.ready ? 'border-0 bg-emerald-500/12 text-emerald-700 dark:text-emerald-100' : 'border-0 bg-amber-500/12 text-amber-700 dark:text-amber-100'}>
                        {detail.skill.ready ? t('list.ready') : t('list.notReady')}
                      </Badge>
                    </div>
                  </div>
                  <Switch checked={detail.skill.enabled} onCheckedChange={onToggle} />
                </div>
              </section>

              <section data-testid="skills-detail-config" className={cn(skillCardClasses, 'p-5')}>
                <h3 className="text-[15px] font-semibold">{t('detail.configuration')}</h3>
                {detail.spec.primaryEnv && (
                  <div className="mt-3">
                    <label className="mb-2 block text-[12px] font-medium text-muted-foreground">{t('detail.primaryCredential', { env: detail.spec.primaryEnv })}</label>
                    <Input data-testid="skills-detail-primary-env-input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} className={cn(skillInputClasses, 'h-10 rounded-full font-mono text-[13px]')} />
                  </div>
                )}
                <div className="mt-3 space-y-2">
                  {envRows.map((row, index) => (
                    <div key={`${row.key}-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-3">
                      <Input value={row.key} onChange={(event) => setEnvRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} className={cn(skillInputClasses, 'h-10 rounded-full font-mono text-[13px]')} placeholder={t('detail.keyPlaceholder')} />
                      <Input value={row.value} onChange={(event) => setEnvRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} className={cn(skillInputClasses, 'h-10 rounded-full font-mono text-[13px]')} placeholder={t('detail.valuePlaceholder')} />
                      <Button variant="ghost" size="icon" onClick={() => setEnvRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="h-10 w-10 rounded-full">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <Button data-testid="skills-detail-add-env-button" variant="outline" onClick={() => setEnvRows((current) => [...current, { key: '', value: '' }])} className={cn(skillPrimaryControlClasses, 'border-black/10 dark:border-white/10')}>
                    {t('detail.addVariable')}
                  </Button>
                  <Button data-testid="skills-detail-save-config" onClick={onSave} disabled={saving} className={skillPrimaryControlClasses}>
                    {saving ? t('detail.saving') : t('detail.saveConfig')}
                  </Button>
                </div>
              </section>

              <section data-testid="skills-detail-runtime" className={cn(skillCardClasses, 'p-5')}>
                <h3 className="text-[15px] font-semibold">{t('detail.runtimeStatus')}</h3>
                <div className="mt-3 text-[13px] text-muted-foreground">{t('detail.readyValue', { value: detail.skill.ready ? 'true' : 'false' })}</div>
                {missingItems.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                    <div className="mb-2 flex items-center gap-2 text-amber-700 dark:text-amber-100">
                      <ShieldAlert className="h-4 w-4" />
                      <span className="text-[13px] font-medium">{t('detail.missingRuntimeRequirements')}</span>
                    </div>
                    <ul className="space-y-1 text-[13px] text-muted-foreground">
                      {missingItems.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                )}
              </section>

              <section data-testid="skills-detail-spec" className={cn(skillCardClasses, 'p-5')}>
                <h3 className="text-[15px] font-semibold">{t('detail.skillSpec')}</h3>
                {detail.spec.parseError && <div className="mt-3 rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive">{t('detail.parseFailed', { error: detail.spec.parseError })}</div>}
                <div className="mt-3 grid gap-2 text-[13px]">
                  {detail.spec.homepage && <p><span className="font-medium">{t('detail.homepageLabel')}</span> {detail.spec.homepage}</p>}
                  {detail.spec.primaryEnv && <p><span className="font-medium">{t('detail.primaryEnvLabel')}</span> {detail.spec.primaryEnv}</p>}
                  {detail.spec.requires?.env && detail.spec.requires.env.length > 0 && <p><span className="font-medium">{t('detail.requiresEnvLabel')}</span> {detail.spec.requires.env.join(', ')}</p>}
                  {detail.spec.requires?.config && detail.spec.requires.config.length > 0 && <p><span className="font-medium">{t('detail.requiresConfigLabel')}</span> {detail.spec.requires.config.join(', ')}</p>}
                  {detail.spec.requires?.bins && detail.spec.requires.bins.length > 0 && <p><span className="font-medium">{t('detail.requiresBinsLabel')}</span> {detail.spec.requires.bins.join(', ')}</p>}
                  {detail.spec.requires?.anyBins && detail.spec.requires.anyBins.length > 0 && <p><span className="font-medium">{t('detail.requiresAnyBinsLabel')}</span> {detail.spec.requires.anyBins.join(', ')}</p>}
                </div>
                {detail.spec.rawMarkdown && (
                  <details className="mt-4 rounded-2xl border border-black/10 px-4 py-3 dark:border-white/10">
                    <summary className="cursor-pointer text-[13px] font-medium">{t('detail.rawSkillMd')}</summary>
                    <div className="prose prose-sm mt-4 max-w-none dark:prose-invert">
                      <MarkdownRenderer content={detail.spec.rawMarkdown} />
                    </div>
                  </details>
                )}
              </section>

              <section data-testid="skills-detail-danger-zone" className={cn(skillCardClasses, 'border-destructive/20 p-5')}>
                <h3 className="text-[15px] font-semibold text-destructive">{t('detail.dangerZone')}</h3>
                <p className="mt-1 text-[12px] text-muted-foreground">{t('detail.deleteHint')}</p>
                <div className="mt-4 flex justify-end">
                  <Button data-testid="skills-detail-delete-button" variant="destructive" onClick={() => setConfirmDelete(true)} disabled={Boolean(detail && deleting[detail.skill.id])} className={skillPrimaryControlClasses}>
                    {detail && deleting[detail.skill.id] ? t('detail.deleting') : t('detail.deleteSkill')}
                  </Button>
                </div>
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>

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
