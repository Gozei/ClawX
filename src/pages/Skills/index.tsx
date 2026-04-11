/**
 * Skills Page
 * Browse and manage AI skills
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Search,
  Puzzle,
  Lock,
  Package,
  X,
  AlertCircle,
  Plus,
  Key,
  Trash2,
  RefreshCw,
  FolderOpen,
  FileCode,
  Globe,
  Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useSkillsStore } from '@/stores/skills';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { trackUiEvent } from '@/lib/telemetry';
import { toast } from 'sonner';
import type { Skill } from '@/types/skill';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { PageHeader } from '@/components/layout/PageHeader';

type SkillSourceCategory = 'all' | 'claw-built-in' | 'hub-market' | 'custom';
type SkillKeyCategory = 'all' | 'requires-key' | 'no-key';
type SkillSection = {
  id: Exclude<SkillSourceCategory, 'all'>;
  label: string;
  count: number;
  requiresKeyCount: number;
  noKeyCount: number;
  skills: Skill[];
};

const headerActionButtonClasses = 'h-10 rounded-full px-4 text-[13px] font-medium border-[#d4dceb] bg-white text-[#223047] shadow-none hover:bg-[#f3f6fb] dark:border-white/10 dark:bg-transparent dark:text-white dark:hover:bg-white/6';
const actionButtonClasses = 'h-9 rounded-full border-black/10 bg-transparent px-4 text-[13px] font-medium text-muted-foreground shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5';
const iconOutlineButtonClasses = 'h-[36px] w-[36px] border-black/10 bg-transparent text-muted-foreground shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5';
const skillPanelClasses = 'rounded-[24px] border border-black/10 bg-transparent shadow-none dark:border-white/10';
const skillSectionClasses = 'rounded-[28px] border border-black/10 bg-transparent shadow-none dark:border-white/10';
const skillInsetCardClasses = 'rounded-2xl bg-black/5 shadow-none dark:bg-white/5';
const detailInputClasses = 'rounded-xl border-black/10 bg-white text-foreground shadow-none dark:border-white/10 dark:bg-card';
const skillMetaBadgeClasses = 'border-0 bg-black/[0.04] text-foreground/70 shadow-none dark:bg-white/[0.08] dark:text-white/72';

// Skill detail dialog component
interface SkillDetailDialogProps {
  skill: Skill | null;
  isOpen: boolean;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
  onUninstall?: (slug: string) => void;
  onOpenFolder?: (skill: Skill) => Promise<void> | void;
}

function resolveSkillSourceLabel(skill: Skill, t: TFunction<'skills'>): string {
  const category = resolveSkillSourceCategory(skill);
  if (category === 'claw-built-in') return t('source.badge.clawBuiltIn', { defaultValue: 'Claw Built-in' });
  if (category === 'hub-market') return t('source.badge.hubMarket', { defaultValue: 'Hub Market' });
  if (category === 'custom') return t('source.badge.custom', { defaultValue: 'Custom' });
  return t('source.badge.unknown', { defaultValue: 'Unknown source' });
}

function resolveSkillSourceCategory(skill: Skill): Exclude<SkillSourceCategory, 'all'> {
  const source = (skill.source || '').trim().toLowerCase();
  const baseDir = (skill.baseDir || '').trim().toLowerCase();

  if (skill.isBundled || skill.isCore || source === 'openclaw-bundled') {
    return 'claw-built-in';
  }

  if (
    source === 'openclaw-workspace'
    || source === 'openclaw-extra'
    || source === 'agents-skills-personal'
    || source === 'agents-skills-project'
    || baseDir.includes('/.agents/')
    || baseDir.includes('/workspace')
  ) {
    return 'custom';
  }

  if (source === 'openclaw-managed') {
    return 'hub-market';
  }

  return skill.isBundled ? 'claw-built-in' : 'hub-market';
}

function skillRequiresKey(skill: Skill): boolean {
  const config = skill.config || {};
  const env = (config.env && typeof config.env === 'object') ? config.env as Record<string, unknown> : {};
  const configKeys = Object.keys(config);
  const envKeys = Object.keys(env);
  const sensitivePattern = /(api.?key|token|secret|password|client.?id|client.?secret|access.?key)/i;
  const text = [skill.name, skill.slug, skill.description].filter(Boolean).join(' ').toLowerCase();

  if (typeof config.apiKey === 'string') return true;
  if (configKeys.some((key) => sensitivePattern.test(key))) return true;
  if (envKeys.some((key) => sensitivePattern.test(key))) return true;

  return /(api key|apikey|token|secret|oauth|browser auth|openai|anthropic|gemini|openrouter|deepseek|claude)/i.test(text);
}

function resolveSkillKeyLabel(skill: Skill, t: TFunction<'skills'>): string {
  return skillRequiresKey(skill)
    ? t('source.badge.requiresKey', { defaultValue: 'Requires Key' })
    : t('source.badge.noKey', { defaultValue: 'No Key' });
}

function getSourceFilterButtonClasses(selected: boolean): string {
  return cn(
    'inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-black/10 px-4 text-[13px] font-medium transition-colors dark:border-white/10',
    selected
      ? 'bg-black/5 text-[#1f2a37] dark:bg-white/10 dark:text-white'
      : 'bg-transparent text-[#6d7b8f] hover:bg-black/5 hover:text-[#1f2a37] dark:text-white/56 dark:hover:bg-white/5 dark:hover:text-white',
  );
}

function getKeyFilterButtonClasses(selected: boolean): string {
  return cn(
    'inline-flex h-8 items-center justify-center rounded-full border border-black/10 px-3 text-[13px] font-medium transition-colors dark:border-white/10',
    selected
      ? 'bg-black/5 text-[#1f2a37] dark:bg-white/10 dark:text-white'
      : 'bg-transparent text-[#6d7b8f] hover:bg-black/5 hover:text-[#1f2a37] dark:text-white/56 dark:hover:bg-white/5 dark:hover:text-white',
  );
}

function SkillDetailDialog({ skill, isOpen, onClose, onToggle, onUninstall, onOpenFolder }: SkillDetailDialogProps) {
  const { t } = useTranslation('skills');
  const { fetchSkills } = useSkillsStore();
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!skill) return;

    if (skill.config?.apiKey) {
      setApiKey(String(skill.config.apiKey));
    } else {
      setApiKey('');
    }

    if (skill.config?.env) {
      const vars = Object.entries(skill.config.env).map(([key, value]) => ({
        key,
        value: String(value),
      }));
      setEnvVars(vars);
    } else {
      setEnvVars([]);
    }
  }, [skill]);

  const handleOpenClawhub = async () => {
    if (!skill?.slug) return;
    await invokeIpc('shell:openExternal', `https://clawhub.ai/s/${skill.slug}`);
  };

  const handleOpenEditor = async () => {
    if (!skill?.id) return;
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/open-readme', {
        method: 'POST',
        body: JSON.stringify({ skillKey: skill.id, slug: skill.slug, baseDir: skill.baseDir }),
      });
      if (result.success) {
        toast.success(t('toast.openedEditor'));
      } else {
        toast.error(result.error || t('toast.failedEditor'));
      }
    } catch (err) {
      toast.error(t('toast.failedEditor') + ': ' + String(err));
    }
  };

  const handleCopyPath = async () => {
    if (!skill?.baseDir) return;
    try {
      await navigator.clipboard.writeText(skill.baseDir);
      toast.success(t('toast.copiedPath'));
    } catch (err) {
      toast.error(t('toast.failedCopyPath') + ': ' + String(err));
    }
  };

  const handleAddEnv = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const handleUpdateEnv = (index: number, field: 'key' | 'value', value: string) => {
    const newVars = [...envVars];
    newVars[index] = { ...newVars[index], [field]: value };
    setEnvVars(newVars);
  };

  const handleRemoveEnv = (index: number) => {
    const newVars = [...envVars];
    newVars.splice(index, 1);
    setEnvVars(newVars);
  };

  const handleSaveConfig = async () => {
    if (isSaving || !skill) return;
    setIsSaving(true);
    try {
      const envObj = envVars.reduce((acc, curr) => {
        const key = curr.key.trim();
        const value = curr.value.trim();
        if (key) acc[key] = value;
        return acc;
      }, {} as Record<string, string>);

      const result = await invokeIpc<{ success: boolean; error?: string }>('skill:updateConfig', {
        skillKey: skill.id,
        apiKey: apiKey || '',
        env: envObj,
      }) as { success: boolean; error?: string };

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      await fetchSkills();
      toast.success(t('detail.configSaved'));
    } catch (err) {
      toast.error(t('toast.failedSave') + ': ' + String(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (!skill) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        data-testid="skill-detail-sheet"
        className="flex w-full flex-col border-l border-black/10 bg-background p-0 shadow-[0_0_40px_rgba(0,0,0,0.14)] dark:border-white/10 dark:bg-card sm:max-w-[660px]"
        side="right"
      >
        <div className="flex-1 overflow-y-auto px-8 py-7">
          <div className="rounded-[28px] border border-black/10 bg-transparent px-6 py-6 shadow-none dark:border-white/10">
            <div className="flex items-start gap-4">
              <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-black/5 bg-black/5 shadow-none dark:border-white/10 dark:bg-white/5">
                <span className="text-3xl">{skill.icon || '🔧'}</span>
                {skill.isCore && (
                  <div className="absolute -right-1.5 -top-1.5 rounded-full border border-black/10 bg-background p-1 shadow-none dark:border-white/10 dark:bg-card">
                    <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 data-testid="skill-detail-title" className="text-[30px] leading-none font-semibold tracking-[-0.03em] text-foreground">
                    {skill.name}
                  </h2>
                  <Badge variant="secondary" className={cn(skillMetaBadgeClasses, 'h-7 rounded-full px-3 text-[11px] font-semibold')}>
                    {resolveSkillSourceLabel(skill, t)}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "h-7 rounded-full px-3 text-[11px] font-semibold",
                      skillRequiresKey(skill)
                        ? "bg-amber-500/12 text-amber-700 dark:text-amber-100"
                        : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-100",
                    )}
                  >
                    {resolveSkillKeyLabel(skill, t)}
                  </Badge>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                  <Badge variant="secondary" className="font-mono px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70">
                    v{skill.version}
                  </Badge>
                  <Badge variant="secondary" className="font-mono px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70">
                    {skill.isCore ? t('detail.coreSystem') : skill.isBundled ? t('detail.bundled') : t('detail.userInstalled')}
                  </Badge>
                  {skill.slug && (
                    <Badge variant="secondary" className="font-mono px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70">
                      {skill.slug}
                    </Badge>
                  )}
                </div>

                {skill.description && (
                  <p className="mt-4 max-w-2xl text-[14px] leading-7 text-muted-foreground">
                    {skill.description}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4">
            <div className={cn(skillPanelClasses, 'p-5')}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-semibold text-foreground">{t('detail.source')}</h3>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" className={iconOutlineButtonClasses} disabled={!skill.baseDir} onClick={handleCopyPath} title={t('detail.copyPath')}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="icon" className={iconOutlineButtonClasses} disabled={!skill.baseDir} onClick={() => onOpenFolder?.(skill)} title={t('detail.openActualFolder')}>
                    <FolderOpen className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <Input value={skill.baseDir || t('detail.pathUnavailable')} readOnly className={cn(detailInputClasses, 'h-[42px] font-mono text-[12px] text-foreground/70')} />
            </div>

            {!skill.isCore && (
              <div className={cn(skillPanelClasses, 'p-5')}>
                <div className="mb-2 flex items-center gap-2">
                  <Key className="h-4 w-4 text-blue-500" />
                  <h3 className="text-[15px] font-semibold text-foreground">{t('detail.apiKey')}</h3>
                </div>
                <p className="mb-3 text-[12px] leading-6 text-muted-foreground">
                  {t('detail.apiKeyDesc', 'The primary API key for this skill. Leave blank if not required or configured elsewhere.')}
                </p>
                <Input placeholder={t('detail.apiKeyPlaceholder', 'Enter API Key (optional)')} value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" className={cn(detailInputClasses, 'h-[44px] font-mono text-[13px] transition-all focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/50 placeholder:text-foreground/40')} />
              </div>
            )}

            {!skill.isCore && (
              <div className={cn(skillPanelClasses, 'p-5')}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[15px] font-semibold text-foreground">{t('detail.envVars')}</h3>
                    {envVars.length > 0 && (
                      <Badge variant="secondary" className={cn(skillMetaBadgeClasses, 'h-6 rounded-full px-2.5 text-[10px] font-medium')}>
                        {envVars.length}
                      </Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 rounded-full px-3 text-[12px] font-semibold text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5" onClick={handleAddEnv}>
                    <Plus className="mr-1 h-3 w-3" strokeWidth={3} />
                    {t('detail.addVariable', 'Add Variable')}
                  </Button>
                </div>

                <div className="space-y-2">
                  {envVars.length === 0 && (
                    <div className="rounded-xl border border-dashed border-black/10 bg-transparent px-4 py-3 text-[13px] italic text-muted-foreground dark:border-white/10">
                      {t('detail.noEnvVars', 'No environment variables configured.')}
                    </div>
                  )}

                  {envVars.map((env, index) => (
                    <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-3" key={index}>
                      <Input value={env.key} onChange={(e) => handleUpdateEnv(index, 'key', e.target.value)} className={cn(detailInputClasses, 'h-[40px] font-mono text-[13px] focus-visible:ring-2 focus-visible:ring-blue-500/50')} placeholder={t('detail.keyPlaceholder', 'Key')} />
                      <Input value={env.value} onChange={(e) => handleUpdateEnv(index, 'value', e.target.value)} className={cn(detailInputClasses, 'h-[40px] font-mono text-[13px] focus-visible:ring-2 focus-visible:ring-blue-500/50')} placeholder={t('detail.valuePlaceholder', 'Value')} />
                      <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={() => handleRemoveEnv(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {skill.slug && !skill.isBundled && !skill.isCore && (
              <div className={cn(skillPanelClasses, 'p-5')}>
                <h3 className="mb-3 text-[15px] font-semibold text-foreground">{t('detail.openManual')}</h3>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className={cn(actionButtonClasses, 'h-9 px-4 text-[12px]')} onClick={handleOpenClawhub}>
                    <Globe className="mr-1.5 h-[13px] w-[13px]" />
                    ClawHub
                  </Button>
                  <Button variant="outline" size="sm" className={cn(actionButtonClasses, 'h-9 px-4 text-[12px]')} onClick={handleOpenEditor}>
                    <FileCode className="mr-1.5 h-[13px] w-[13px]" />
                    {t('detail.openManual')}
                  </Button>
                </div>
              </div>
            )}

            <div className="sticky bottom-0 z-10 mt-2 flex items-center justify-end gap-3 rounded-[24px] border border-black/10 bg-background/92 px-5 py-4 shadow-none backdrop-blur dark:border-white/10 dark:bg-card/92">
              {!skill.isCore && (
                <Button onClick={handleSaveConfig} className="h-[42px] rounded-full px-5 text-[13px] font-semibold shadow-none" disabled={isSaving}>
                  {isSaving ? t('detail.saving') : t('detail.saveConfig')}
                </Button>
              )}

              {!skill.isCore && (
                <Button
                  variant="outline"
                  className={cn(actionButtonClasses, 'h-[42px] px-5')}
                  onClick={() => {
                    if (!skill.isBundled && onUninstall && skill.slug) {
                      onUninstall(skill.slug);
                      onClose();
                    } else {
                      onToggle(!skill.enabled);
                    }
                  }}
                >
                  {!skill.isBundled && onUninstall
                    ? t('detail.uninstall')
                    : (skill.enabled ? t('detail.disable') : t('detail.enable'))}
                </Button>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function Skills() {
  const {
    skills,
    loading,
    refreshing,
    error,
    fetchSkills,
    enableSkill,
    disableSkill,
    searchResults,
    searchSkills,
    installSkill,
    uninstallSkill,
    searching,
    searchError,
    installing
  } = useSkillsStore();
  const { t } = useTranslation('skills');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [searchQuery, setSearchQuery] = useState('');
  const [installQuery, setInstallQuery] = useState('');
  const [installSheetOpen, setInstallSheetOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [selectedSource, setSelectedSource] = useState<SkillSourceCategory>('all');
  const [selectedKeyCategory, setSelectedKeyCategory] = useState<SkillKeyCategory>('all');

  const isGatewayRunning = gatewayStatus.state === 'running';
  const [showGatewayWarning, setShowGatewayWarning] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (!isGatewayRunning) {
      timer = setTimeout(() => {
        setShowGatewayWarning(true);
      }, 1500);
    } else {
      timer = setTimeout(() => {
        setShowGatewayWarning(false);
      }, 0);
    }
    return () => clearTimeout(timer);
  }, [isGatewayRunning]);

  useEffect(() => {
    if (isGatewayRunning) {
      fetchSkills();
    }
  }, [fetchSkills, isGatewayRunning]);

  const safeSkills = Array.isArray(skills) ? skills : [];
  const normalizedQuery = searchQuery.toLowerCase().trim();

  const skillMeta = useMemo(() => (
    safeSkills.map((skill) => ({
      skill,
      sourceCategory: resolveSkillSourceCategory(skill),
      requiresKey: skillRequiresKey(skill),
      searchText: [
        skill.name,
        skill.description,
        skill.id,
        skill.slug || '',
        skill.author || '',
      ].join(' ').toLowerCase(),
    }))
  ), [safeSkills]);

  const sourceStats = useMemo(() => ({
    all: skillMeta.length,
    clawBuiltIn: skillMeta.filter((entry) => entry.sourceCategory === 'claw-built-in').length,
    hubMarket: skillMeta.filter((entry) => entry.sourceCategory === 'hub-market').length,
    custom: skillMeta.filter((entry) => entry.sourceCategory === 'custom').length,
  }), [skillMeta]);

  const keyStats = useMemo(() => ({
    all: skillMeta.length,
    requiresKey: skillMeta.filter((entry) => entry.requiresKey).length,
    noKey: skillMeta.filter((entry) => !entry.requiresKey).length,
  }), [skillMeta]);

  const filteredSkills = useMemo(() => (
    skillMeta
      .filter(({ searchText, sourceCategory, requiresKey }) => {
        const matchesSearch = normalizedQuery.length === 0 || searchText.includes(normalizedQuery);
        const matchesSource = selectedSource === 'all' || selectedSource === sourceCategory;
        const matchesKeyCategory =
          selectedKeyCategory === 'all'
          || (selectedKeyCategory === 'requires-key' && requiresKey)
          || (selectedKeyCategory === 'no-key' && !requiresKey);
        return matchesSearch && matchesSource && matchesKeyCategory;
      })
      .map((entry) => entry.skill)
      .sort((a, b) => {
        if (a.enabled && !b.enabled) return -1;
        if (!a.enabled && b.enabled) return 1;
        if (a.isCore && !b.isCore) return -1;
        if (!a.isCore && b.isCore) return 1;
        return a.name.localeCompare(b.name);
      })
  ), [normalizedQuery, selectedKeyCategory, selectedSource, skillMeta]);

  const groupedSections: SkillSection[] = useMemo(() => [
    {
      id: 'claw-built-in' as const,
      label: t('filter.clawBuiltIn', { count: sourceStats.clawBuiltIn }),
      count: 0,
      requiresKeyCount: 0,
      noKeyCount: 0,
      skills: [],
    },
    {
      id: 'hub-market' as const,
      label: t('filter.hubMarket', { count: sourceStats.hubMarket }),
      count: 0,
      requiresKeyCount: 0,
      noKeyCount: 0,
      skills: [],
    },
    {
      id: 'custom' as const,
      label: t('filter.custom', { count: sourceStats.custom }),
      count: 0,
      requiresKeyCount: 0,
      noKeyCount: 0,
      skills: [],
    },
  ].map((section) => {
    const skillsInSection = filteredSkills.filter((skill) => resolveSkillSourceCategory(skill) === section.id);
    return {
      ...section,
      count: skillsInSection.length,
      requiresKeyCount: skillsInSection.filter((skill) => skillRequiresKey(skill)).length,
      noKeyCount: skillsInSection.filter((skill) => !skillRequiresKey(skill)).length,
      skills: skillsInSection,
    };
  }).filter((section) => section.skills.length > 0), [filteredSkills, sourceStats.clawBuiltIn, sourceStats.custom, sourceStats.hubMarket, t]);

  const bulkToggleVisible = useCallback(async (enable: boolean) => {
    const candidates = filteredSkills.filter((skill) => !skill.isCore && skill.enabled !== enable);
    if (candidates.length === 0) {
      toast.info(enable ? t('toast.noBatchEnableTargets') : t('toast.noBatchDisableTargets'));
      return;
    }

    let succeeded = 0;
    for (const skill of candidates) {
      try {
        if (enable) {
          await enableSkill(skill.id);
        } else {
          await disableSkill(skill.id);
        }
        succeeded += 1;
      } catch {
        // Continue to next skill and report final summary.
      }
    }

    trackUiEvent('skills.batch_toggle', { enable, total: candidates.length, succeeded });
    if (succeeded === candidates.length) {
      toast.success(enable ? t('toast.batchEnabled', { count: succeeded }) : t('toast.batchDisabled', { count: succeeded }));
      return;
    }
    toast.warning(t('toast.batchPartial', { success: succeeded, total: candidates.length }));
  }, [disableSkill, enableSkill, filteredSkills, t]);

  const handleToggle = useCallback(async (skillId: string, enable: boolean) => {
    try {
      if (enable) {
        await enableSkill(skillId);
        toast.success(t('toast.enabled'));
      } else {
        await disableSkill(skillId);
        toast.success(t('toast.disabled'));
      }
    } catch (err) {
      toast.error(String(err));
    }
  }, [enableSkill, disableSkill, t]);

  const hasInstalledSkills = safeSkills.some(s => !s.isBundled);

  const handleOpenSkillsFolder = useCallback(async () => {
    try {
      const skillsDir = await invokeIpc<string>('openclaw:getSkillsDir');
      if (!skillsDir) {
        throw new Error('Skills directory not available');
      }
      const result = await invokeIpc<string>('shell:openPath', skillsDir);
      if (result) {
        if (result.toLowerCase().includes('no such file') || result.toLowerCase().includes('not found') || result.toLowerCase().includes('failed to open')) {
          toast.error(t('toast.failedFolderNotFound'));
        } else {
          throw new Error(result);
        }
      }
    } catch (err) {
      toast.error(t('toast.failedOpenFolder') + ': ' + String(err));
    }
  }, [t]);

  const handleOpenSkillFolder = useCallback(async (skill: Skill) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/open-path', {
        method: 'POST',
        body: JSON.stringify({
          skillKey: skill.id,
          slug: skill.slug,
          baseDir: skill.baseDir,
        }),
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to open folder');
      }
    } catch (err) {
      toast.error(t('toast.failedOpenActualFolder') + ': ' + String(err));
    }
  }, [t]);

  const [skillsDirPath, setSkillsDirPath] = useState('~/.openclaw/skills');

  useEffect(() => {
    invokeIpc<string>('openclaw:getSkillsDir')
      .then((dir) => setSkillsDirPath(dir as string))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!installSheetOpen) {
      return;
    }

    const query = installQuery.trim();
    if (query.length === 0) {
      searchSkills('');
      return;
    }

    const timer = setTimeout(() => {
      searchSkills(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [installQuery, installSheetOpen, searchSkills]);

  const handleInstall = useCallback(async (slug: string) => {
    try {
      await installSkill(slug);
      await enableSkill(slug);
      toast.success(t('toast.installed'));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (['installTimeoutError', 'installRateLimitError'].includes(errorMessage)) {
        toast.error(t(`toast.${errorMessage}`, { path: skillsDirPath }), { duration: 10000 });
      } else {
        toast.error(t('toast.failedInstall') + ': ' + errorMessage);
      }
    }
  }, [installSkill, enableSkill, t, skillsDirPath]);

  const handleUninstall = useCallback(async (slug: string) => {
    try {
      await uninstallSkill(slug);
      toast.success(t('toast.uninstalled'));
    } catch (err) {
      toast.error(t('toast.failedUninstall') + ': ' + String(err));
    }
  }, [uninstallSkill, t]);

  if (loading) {
    return (
      <div data-testid="skills-page" className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div data-testid="skills-page" className="flex flex-col -m-6 h-[calc(100vh-2.5rem)] overflow-hidden dark:bg-background">
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">

        <PageHeader
          titleTestId="skills-page-title"
          title={t('title')}
          subtitle={t('subtitle')}
          actions={hasInstalledSkills ? (
            <button
              onClick={handleOpenSkillsFolder}
              className={cn(headerActionButtonClasses, 'shrink-0 transition-colors')}
            >
              <FolderOpen className="h-4 w-4 mr-2" />
              {t('openFolder')}
            </button>
          ) : undefined}
        />

        {/* Gateway Warning */}
        {showGatewayWarning && (
          <div className="mb-6 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
              {t('gatewayWarning')}
            </span>
          </div>
        )}

        <div data-testid="skills-toolbar-card" className={cn(skillPanelClasses, 'mb-4 shrink-0 px-5 py-4')}>
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div className="flex flex-wrap items-center gap-4 text-[14px]">
              <div className="relative group mr-2 flex items-center rounded-full border border-black/10 bg-black/5 px-3 py-1.5 transition-colors focus-within:border-black/20 dark:border-white/10 dark:bg-white/5 dark:focus-within:border-white/20">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  data-testid="skills-search-input"
                  placeholder={t('search')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ml-2 w-28 bg-transparent text-[13px] font-normal text-foreground outline-none placeholder:text-muted-foreground/70 dark:text-white dark:placeholder:text-white/35 md:w-40"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="ml-1 shrink-0 text-muted-foreground hover:text-foreground dark:text-white/35 dark:hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-4">
                <button
                  data-testid="skills-source-filter-all"
                  onClick={() => setSelectedSource('all')}
                  className={getSourceFilterButtonClasses(selectedSource === 'all')}
                >
                  {t('filter.all', { count: sourceStats.all })}
                </button>
                <button
                  data-testid="skills-source-filter-claw-built-in"
                  onClick={() => setSelectedSource('claw-built-in')}
                  className={getSourceFilterButtonClasses(selectedSource === 'claw-built-in')}
                >
                  {t('filter.clawBuiltIn', { count: sourceStats.clawBuiltIn })}
                </button>
                <button
                  data-testid="skills-source-filter-hub-market"
                  onClick={() => setSelectedSource('hub-market')}
                  className={getSourceFilterButtonClasses(selectedSource === 'hub-market')}
                >
                  {t('filter.hubMarket', { count: sourceStats.hubMarket })}
                </button>
                <button
                  data-testid="skills-source-filter-custom"
                  onClick={() => setSelectedSource('custom')}
                  className={getSourceFilterButtonClasses(selectedSource === 'custom')}
                >
                  {t('filter.custom', { count: sourceStats.custom })}
                </button>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => bulkToggleVisible(true)}
                className={actionButtonClasses}
              >
                {t('actions.enableVisible')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => bulkToggleVisible(false)}
                className={actionButtonClasses}
              >
                {t('actions.disableVisible')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setInstallQuery('');
                  setInstallSheetOpen(true);
                }}
                className={actionButtonClasses}
              >
                {t('actions.installSkill')}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={fetchSkills}
                disabled={!isGatewayRunning}
                className="ml-1 h-9 w-9 rounded-full border-black/10 bg-transparent text-muted-foreground shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
                title={t('refresh')}
              >
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              </Button>
            </div>
          </div>

          <div className="mt-4 flex shrink-0 items-center gap-3 border-t border-black/10 pt-4 text-[13px] dark:border-white/10">
            <span className="text-muted-foreground/70 dark:text-white/40">{t('filter.keyDivider')}</span>
            <button
              onClick={() => setSelectedKeyCategory('all')}
              className={getKeyFilterButtonClasses(selectedKeyCategory === 'all')}
            >
              {t('filter.keyAll', { count: keyStats.all })}
            </button>
            <button
              onClick={() => setSelectedKeyCategory('requires-key')}
              className={getKeyFilterButtonClasses(selectedKeyCategory === 'requires-key')}
            >
              {t('filter.requiresKey', { count: keyStats.requiresKey })}
            </button>
            <button
              onClick={() => setSelectedKeyCategory('no-key')}
              className={getKeyFilterButtonClasses(selectedKeyCategory === 'no-key')}
            >
              {t('filter.noKey', { count: keyStats.noKey })}
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {error && (
            <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>
                {['fetchTimeoutError', 'fetchRateLimitError', 'timeoutError', 'rateLimitError'].includes(error)
                  ? t(`toast.${error}`, { path: skillsDirPath })
                  : error}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-6">
            {filteredSkills.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Puzzle className="h-10 w-10 mb-4 opacity-50" />
                <p>{searchQuery ? t('noSkillsSearch') : t('noSkillsAvailable')}</p>
              </div>
            ) : (
              groupedSections.map((section) => (
                <section key={section.id} className={cn(skillSectionClasses, 'px-5 py-5')}>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-black/10 pb-4 dark:border-white/10">
                    <div>
                      <h2 className="text-[20px] font-semibold text-foreground">{section.label}</h2>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {t('group.summary', {
                          count: section.count,
                          requiresKey: section.requiresKeyCount,
                          noKey: section.noKeyCount,
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="h-6 rounded-full border-0 bg-amber-500/12 px-2.5 text-[11px] font-medium text-amber-700 dark:text-amber-100">
                        {t('group.requiresKey', { count: section.requiresKeyCount })}
                      </Badge>
                      <Badge variant="secondary" className="h-6 rounded-full border-0 bg-emerald-500/10 px-2.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-100">
                        {t('group.noKey', { count: section.noKeyCount })}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {section.skills.map((skill) => (
                      <div
                        key={skill.id}
                        data-testid={`skills-list-item-${skill.id}`}
                        className={cn(skillInsetCardClasses, 'group flex cursor-pointer flex-row items-center justify-between px-4 py-4 transition-colors hover:bg-black/10 dark:hover:bg-white/10')}
                        onClick={() => setSelectedSkill(skill)}
                      >
                        <div className="flex items-start gap-4 flex-1 overflow-hidden pr-4">
                          <div className="h-11 w-11 shrink-0 flex items-center justify-center overflow-hidden rounded-2xl border border-black/5 bg-black/5 text-2xl dark:border-white/10 dark:bg-white/5">
                            {skill.icon || '🧩'}
                          </div>
                          <div className="flex flex-col overflow-hidden">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-[16px] font-semibold text-foreground truncate">{skill.name}</h3>
                              {skill.isCore ? (
                                <Lock className="h-3 w-3 text-muted-foreground" />
                              ) : skill.isBundled ? (
                                <Puzzle className="h-3 w-3 text-blue-500/70" />
                              ) : null}
                              {skill.slug && skill.slug !== skill.name ? (
                                <span className="rounded border border-black/10 bg-white px-1.5 py-0.5 text-[11px] font-mono text-foreground/60 dark:border-white/10 dark:bg-card dark:text-white/55">
                                  {skill.slug}
                                </span>
                              ) : null}
                            </div>
                            <p className="line-clamp-2 pr-6 text-[14px] leading-relaxed text-muted-foreground">
                              {skill.description}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <Badge variant="secondary" className={cn(skillMetaBadgeClasses, 'h-5 px-2 py-0 text-[10px] font-medium')}>
                                {resolveSkillSourceLabel(skill, t)}
                              </Badge>
                              <Badge
                                variant="secondary"
                                className={cn(
                                  "px-2 py-0 h-5 text-[10px] font-medium border-0 shadow-none",
                                  skillRequiresKey(skill)
                                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-100"
                                    : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-100",
                                )}
                              >
                                {resolveSkillKeyLabel(skill, t)}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-6 shrink-0" onClick={e => e.stopPropagation()}>
                          {skill.version && (
                            <span className="text-[13px] font-mono text-muted-foreground">
                              v{skill.version}
                            </span>
                          )}
                          <Switch
                            checked={skill.enabled}
                            onCheckedChange={(checked) => handleToggle(skill.id, checked)}
                            disabled={skill.isCore}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>
      </div>

      <Sheet open={installSheetOpen} onOpenChange={setInstallSheetOpen}>
        <SheetContent
          className="w-full sm:max-w-[560px] p-0 flex flex-col border-l border-black/10 dark:border-white/10 bg-background dark:bg-card shadow-[0_0_40px_rgba(0,0,0,0.2)]"
          side="right"
        >
          <div className="px-7 py-6 border-b border-black/10 dark:border-white/10">
            <h2 className="text-[24px] font-serif text-foreground font-normal tracking-tight">{t('marketplace.installDialogTitle')}</h2>
            <p className="mt-1 text-[13px] text-foreground/70">{t('marketplace.installDialogSubtitle')}</p>
            <div className="mt-4 flex flex-col md:flex-row gap-2">
              <div className="relative flex items-center bg-black/5 dark:bg-white/5 rounded-xl px-3 py-2 border border-black/10 dark:border-white/10 flex-1">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  placeholder={t('searchMarketplace')}
                  value={installQuery}
                  onChange={(e) => setInstallQuery(e.target.value)}
                  className="ml-2 h-auto border-0 bg-transparent p-0 shadow-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 text-[13px]"
                />
                {installQuery && (
                  <button
                    type="button"
                    onClick={() => setInstallQuery('')}
                    className="text-foreground/50 hover:text-foreground shrink-0 ml-1"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Button
                variant="outline"
                disabled
                className="h-10 rounded-xl border-black/10 dark:border-white/10 bg-transparent text-muted-foreground"
              >
                {t('marketplace.sourceLabel')}: {t('marketplace.sourceClawHub')}
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {searchError && (
              <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>
                  {['searchTimeoutError', 'searchRateLimitError', 'timeoutError', 'rateLimitError'].includes(searchError.replace('Error: ', ''))
                    ? t(`toast.${searchError.replace('Error: ', '')}`, { path: skillsDirPath })
                    : t('marketplace.searchError')}
                </span>
              </div>
            )}

            {searching && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <LoadingSpinner size="lg" />
                <p className="mt-4 text-sm">{t('marketplace.searching')}</p>
              </div>
            )}

            {!searching && searchResults.length > 0 && (
              <div className="flex flex-col gap-1">
                {searchResults.map((skill) => {
                  const isInstalled = safeSkills.some(s => s.id === skill.slug || s.name === skill.name);
                  const isInstallLoading = !!installing[skill.slug];

                  return (
                    <div
                      key={skill.slug}
                      className="group flex flex-row items-center justify-between py-3.5 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer border-b border-black/5 dark:border-white/5 last:border-0"
                      onClick={() => invokeIpc('shell:openExternal', `https://clawhub.ai/s/${skill.slug}`)}
                    >
                      <div className="flex items-start gap-4 flex-1 overflow-hidden pr-4">
                        <div className="h-10 w-10 shrink-0 flex items-center justify-center text-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-xl overflow-hidden">
                          📦
                        </div>
                        <div className="flex flex-col overflow-hidden">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-[15px] font-semibold text-foreground truncate">{skill.name}</h3>
                            {skill.author && (
                              <span className="text-xs text-muted-foreground">• {skill.author}</span>
                            )}
                          </div>
                          <p className="text-[13.5px] text-muted-foreground line-clamp-1 pr-6 leading-relaxed">
                            {skill.description}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0" onClick={e => e.stopPropagation()}>
                        {skill.version && (
                          <span className="text-[13px] font-mono text-muted-foreground mr-2">
                            v{skill.version}
                          </span>
                        )}
                        {isInstalled ? (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleUninstall(skill.slug)}
                            disabled={isInstallLoading}
                            className="h-8 shadow-none"
                          >
                            {isInstallLoading ? <LoadingSpinner size="sm" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleInstall(skill.slug)}
                            disabled={isInstallLoading}
                            className="h-8 px-4 rounded-full shadow-none font-medium text-xs"
                          >
                            {isInstallLoading ? <LoadingSpinner size="sm" /> : t('marketplace.install', 'Install')}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!searching && searchResults.length === 0 && !searchError && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Package className="h-10 w-10 mb-4 opacity-50" />
                <p>{installQuery.trim() ? t('marketplace.noResults') : t('marketplace.emptyPrompt')}</p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Skill Detail Dialog */}
      <SkillDetailDialog
        skill={selectedSkill}
        isOpen={!!selectedSkill}
        onClose={() => setSelectedSkill(null)}
        onToggle={(enabled) => {
          if (!selectedSkill) return;
          handleToggle(selectedSkill.id, enabled);
          setSelectedSkill({ ...selectedSkill, enabled });
        }}
        onUninstall={handleUninstall}
        onOpenFolder={handleOpenSkillFolder}
      />
    </div>
  );
}

export default Skills;
