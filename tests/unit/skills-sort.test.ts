import { describe, expect, it } from 'vitest';
import { compareSkillsForDisplay } from '@/pages/Skills/sort';
import type { SkillSnapshot } from '@/types/skill';

function makeSkill(id: string, name: string): SkillSnapshot {
  return {
    id,
    name,
    description: '',
    enabled: false,
    ready: false,
    icon: '',
  } as SkillSnapshot;
}

describe('skills sort', () => {
  it('sorts skills by name A-Z and keeps the order stable for equal names', () => {
    const skills = [
      makeSkill('zeta', 'Zeta'),
      makeSkill('alpha-2', 'alpha'),
      makeSkill('alpha-1', 'Alpha'),
      makeSkill('beta', 'Beta'),
    ];

    const sorted = [...skills].sort(compareSkillsForDisplay);

    expect(sorted.map((skill) => skill.id)).toEqual(['alpha-1', 'alpha-2', 'beta', 'zeta']);
  });
});
