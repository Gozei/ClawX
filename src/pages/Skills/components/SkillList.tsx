import { Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import type { SkillSnapshot } from '@/types/skill';

function hasMissingRequirements(skill: SkillSnapshot): boolean {
  const missing = skill.missing;
  if (!missing) return false;
  return (missing.bins?.length || 0) > 0
    || (missing.anyBins?.length || 0) > 0
    || (missing.env?.length || 0) > 0
    || (missing.config?.length || 0) > 0
    || (missing.os?.length || 0) > 0;
}

function MissingHint({ skill }: { skill: SkillSnapshot }) {
  const { t } = useTranslation('skills');
  if (!hasMissingRequirements(skill)) return null;
  return (
    <Badge variant="secondary" className="border-0 bg-amber-500/12 text-amber-700 dark:text-amber-100">
      {t('list.missingHint')}
    </Badge>
  );
}

function StatusBadge({ skill }: { skill: SkillSnapshot }) {
  const { t } = useTranslation('skills');
  if (hasMissingRequirements(skill)) {
    return <MissingHint skill={skill} />;
  }

  return (
    <Badge variant="secondary" className={skill.ready ? 'border-0 bg-emerald-500/12 text-emerald-700 dark:text-emerald-100' : 'border-0 bg-amber-500/12 text-amber-700 dark:text-amber-100'}>
      {skill.ready ? t('list.ready') : t('list.notReady')}
    </Badge>
  );
}

type SkillListProps = {
  skills: SkillSnapshot[];
  onSelect: (skillId: string) => void;
  onToggle: (skill: SkillSnapshot, enabled: boolean) => void;
};

export function SkillList({ skills, onSelect, onToggle }: SkillListProps) {
  const { t } = useTranslation('skills');
  if (skills.length === 0) {
    return (
      <div data-testid="skills-empty-state" className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Package className="mb-4 h-10 w-10 opacity-50" />
        <p>{t('noSkillsAvailable')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {skills.map((skill) => (
        <div
          key={skill.id}
          data-testid={`skills-list-item-${skill.id}`}
          className="flex cursor-pointer items-center justify-between rounded-2xl bg-black/5 px-4 py-4 transition-colors hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
          onClick={() => onSelect(skill.id)}
        >
          <div className="flex min-w-0 flex-1 items-start gap-4 pr-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-black/5 bg-black/5 text-2xl dark:border-white/10 dark:bg-white/5">
              {skill.icon || '📦'}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-[16px] font-semibold">{skill.name}</h3>
                <StatusBadge skill={skill} />
              </div>
              <p className="mt-1 line-clamp-2 text-[14px] text-muted-foreground">{skill.description}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-6" onClick={(event) => event.stopPropagation()}>
            <span className="text-[13px] font-mono text-muted-foreground">v{skill.version || '1.0.0'}</span>
            <Switch checked={skill.enabled} onCheckedChange={(checked) => onToggle(skill, checked)} />
          </div>
        </div>
      ))}
    </div>
  );
}
