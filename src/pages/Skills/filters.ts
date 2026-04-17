import type { SkillSnapshot, SkillSource } from '@/types/skill';

export type SkillSourceCategory = 'all' | 'builtin' | 'market' | 'other';
export type StatusFilter = 'all' | 'enabled' | 'disabled';
export type MissingFilter = 'all' | 'missing' | 'clean';

function normalizePath(value?: string): string {
  return (value || '').replace(/\\/g, '/').toLowerCase();
}

function isWithinDirectory(candidate: string, directory: string): boolean {
  if (!candidate || !directory) return false;
  return candidate === directory || candidate.startsWith(`${directory}/`);
}

export function hasMissingRequirements(skill?: SkillSnapshot | null): boolean {
  if (!skill) return false;
  const missing = skill.missing;
  if (!missing) return false;
  return (missing.bins?.length || 0) > 0
    || (missing.anyBins?.length || 0) > 0
    || (missing.env?.length || 0) > 0
    || (missing.config?.length || 0) > 0
    || (missing.os?.length || 0) > 0;
}

export function classifySkillSource(skill: SkillSnapshot, sources: SkillSource[]): SkillSourceCategory {
  const normalizedBaseDir = normalizePath(skill.baseDir);
  const normalizedFilePath = normalizePath(skill.filePath);

  if (
    skill.isBundled
    || isWithinDirectory(normalizedBaseDir, 'node_modules/openclaw/skills')
    || isWithinDirectory(normalizedBaseDir, '/skills/builtin')
    || isWithinDirectory(normalizedBaseDir, '/skills/core')
    || isWithinDirectory(normalizedFilePath, 'node_modules/openclaw/skills')
    || isWithinDirectory(normalizedFilePath, '/skills/builtin')
    || isWithinDirectory(normalizedFilePath, '/skills/core')
  ) {
    return 'builtin';
  }

  const installedInMarketDir = sources.some((source) => {
    const sourceSkillsRoot = normalizePath(`${source.workdir}/skills`);
    return isWithinDirectory(normalizedBaseDir, sourceSkillsRoot)
      || isWithinDirectory(normalizedFilePath, sourceSkillsRoot);
  });

  if (installedInMarketDir) return 'market';
  return 'other';
}

export function buildFilterButtonClass(active: boolean): string {
  return active
    ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
    : 'border-black/10 bg-transparent text-foreground/75 hover:bg-black/5 dark:border-white/10 dark:text-white/72 dark:hover:bg-white/5';
}
