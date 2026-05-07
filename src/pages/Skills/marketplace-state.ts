import type { MarketplaceInstalledSkill, SkillSnapshot, SkillSource } from '@/types/skill';
import { classifySkillSource } from './filters';

function normalizeSkillKey(value?: string): string {
  return value?.trim().toLowerCase() ?? '';
}

function getPathLeaf(value?: string): string {
  if (!value) return '';
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  return normalizeSkillKey(parts[parts.length - 1]);
}

function matchesSkillSlug(skill: Pick<SkillSnapshot, 'id' | 'slug' | 'baseDir' | 'filePath'> | null | undefined, slug: string): boolean {
  const targetKey = normalizeSkillKey(slug);
  if (!skill || !targetKey) return false;

  return normalizeSkillKey(skill.id) === targetKey
    || normalizeSkillKey(skill.slug) === targetKey
    || getPathLeaf(skill.baseDir) === targetKey
    || getPathLeaf(skill.filePath) === targetKey;
}

export function resolveInstalledSkillId(slug: string, skills: SkillSnapshot[], preferredSourceId?: string): string {
  const targetKey = normalizeSkillKey(slug);
  if (!targetKey) return slug;

  const exactSourceMatch = preferredSourceId
    ? skills.find((skill) => skill?.sourceId === preferredSourceId && matchesSkillSlug(skill, slug))
    : undefined;
  if (exactSourceMatch?.id) {
    return exactSourceMatch.id;
  }

  const matchedSkill = skills.find((skill) => matchesSkillSlug(skill, slug));
  return matchedSkill?.id || slug;
}

export function compareMarketplaceVersions(left?: string, right?: string): number {
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

export function resolveMarketplaceAvailability(params: {
  slug: string;
  sourceId?: string;
  installedSkills: MarketplaceInstalledSkill[];
  skills: SkillSnapshot[];
  sources: SkillSource[];
}): {
  currentInstalledSkill?: MarketplaceInstalledSkill;
  installedOnCurrentSource: boolean;
  occupiedByOtherSource: boolean;
  blockedByNonMarketSource: boolean;
} {
  const { slug, sourceId, installedSkills, skills, sources } = params;
  const targetKey = normalizeSkillKey(slug);
  if (!targetKey) {
    return {
      currentInstalledSkill: undefined,
      installedOnCurrentSource: false,
      occupiedByOtherSource: false,
      blockedByNonMarketSource: false,
    };
  }

  const currentInstalledSkill = installedSkills.find((entry) => {
    if (!entry || normalizeSkillKey(entry.slug) !== targetKey) return false;
    return sourceId ? entry.sourceId === sourceId : true;
  });

  const blockedByNonMarketSource = skills.some((skill) => {
    if (!matchesSkillSlug(skill, slug)) return false;
    return classifySkillSource(skill, sources) !== 'market';
  });

  const occupiedByOtherMarketSource = installedSkills.some((entry) => {
    if (!entry || normalizeSkillKey(entry.slug) !== targetKey) return false;
    return Boolean(sourceId && entry.sourceId && entry.sourceId !== sourceId);
  });

  return {
    currentInstalledSkill,
    installedOnCurrentSource: Boolean(currentInstalledSkill && sourceId && currentInstalledSkill.sourceId === sourceId),
    occupiedByOtherSource: blockedByNonMarketSource || occupiedByOtherMarketSource,
    blockedByNonMarketSource,
  };
}

export function isMarketplaceSkillVisible(params: {
  slug: string;
  sourceId?: string;
  installedSkills: MarketplaceInstalledSkill[];
  skills: SkillSnapshot[];
  sources: SkillSource[];
}): boolean {
  return !resolveMarketplaceAvailability(params).occupiedByOtherSource;
}
