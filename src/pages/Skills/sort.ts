import type { SkillSnapshot } from '@/types/skill';

export function compareSkillsForDisplay(a: SkillSnapshot, b: SkillSnapshot): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}
