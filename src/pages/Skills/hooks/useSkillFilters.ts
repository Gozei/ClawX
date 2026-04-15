import { useMemo } from 'react';
import type { SkillSnapshot, SkillSource } from '@/types/skill';
import {
  classifySkillSource,
  hasMissingRequirements,
  type MissingFilter,
  type SkillSourceCategory,
  type StatusFilter,
} from '../filters';
import { compareSkillsForDisplay } from '../sort';

type SkillFilterArgs = {
  skills: SkillSnapshot[];
  sources: SkillSource[];
  query: string;
  sourceCategory: SkillSourceCategory;
  statusFilter: StatusFilter;
  missingFilter: MissingFilter;
};

export function useSkillFilters({
  skills,
  sources,
  query,
  sourceCategory,
  statusFilter,
  missingFilter,
}: SkillFilterArgs) {
  const sourceCounts = useMemo(() => {
    return skills.reduce<Record<SkillSourceCategory, number>>((acc, skill) => {
      const category = classifySkillSource(skill, sources);
      acc.all += 1;
      acc[category] += 1;
      return acc;
    }, {
      all: 0,
      builtin: 0,
      market: 0,
      other: 0,
    });
  }, [skills, sources]);

  const filteredSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return skills
      .filter((skill) => {
        if (normalized.length > 0 && !`${skill.name} ${skill.description} ${skill.id}`.toLowerCase().includes(normalized)) {
          return false;
        }
        if (sourceCategory !== 'all' && classifySkillSource(skill, sources) !== sourceCategory) {
          return false;
        }
        if (statusFilter === 'enabled' && !skill.enabled) return false;
        if (statusFilter === 'disabled' && skill.enabled) return false;
        const hasMissing = hasMissingRequirements(skill);
        if (missingFilter === 'missing' && !hasMissing) return false;
        if (missingFilter === 'clean' && hasMissing) return false;
        return true;
      })
      .sort(compareSkillsForDisplay);
  }, [missingFilter, query, skills, sourceCategory, sources, statusFilter]);

  const activeFilterCount = Number(sourceCategory !== 'all') + Number(statusFilter !== 'all') + Number(missingFilter !== 'all');

  return { sourceCounts, filteredSkills, activeFilterCount };
}
