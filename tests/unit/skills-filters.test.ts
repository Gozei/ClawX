import { describe, expect, it } from 'vitest';
import { classifySkillSource } from '../../src/pages/Skills/filters';
import type { SkillSnapshot, SkillSource } from '../../src/types/skill';

function makeSkill(overrides: Partial<SkillSnapshot> = {}): SkillSnapshot {
  return {
    id: 'demo-skill',
    name: 'Demo Skill',
    description: 'Demo description',
    enabled: true,
    ...overrides,
  };
}

const sources: SkillSource[] = [
  {
    id: 'clawhub',
    label: 'ClawHub',
    enabled: true,
    site: 'https://clawhub.ai',
    workdir: 'C:/Users/tester/.openclaw/skill-sources/clawhub',
  },
  {
    id: 'deepaiworker',
    label: 'deepaiworker',
    enabled: true,
    site: 'http://127.0.0.1:4000',
    registry: 'http://127.0.0.1:4011',
    workdir: 'C:/Users/tester/.openclaw/skill-sources/deepaiworker',
  },
];

describe('skills source classification', () => {
  it('treats bundled skills as builtin', () => {
    expect(classifySkillSource(makeSkill({
      isBundled: true,
      baseDir: 'C:/repo/node_modules/openclaw/skills/code-review',
    }), sources)).toBe('builtin');
  });

  it('treats skills under a source-scoped skills directory as market', () => {
    expect(classifySkillSource(makeSkill({
      baseDir: 'C:/Users/tester/.openclaw/skill-sources/deepaiworker/skills/weather',
      sourceId: 'deepaiworker',
    }), sources)).toBe('market');
  });

  it('does not treat source metadata alone as market', () => {
    expect(classifySkillSource(makeSkill({
      baseDir: 'C:/Users/tester/custom-skills/weather',
      sourceId: 'clawhub',
      sourceLabel: 'ClawHub',
      source: 'clawhub',
    }), sources)).toBe('other');
  });
});
