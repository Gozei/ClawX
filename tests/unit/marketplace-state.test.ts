import { describe, expect, it } from 'vitest';
import type { MarketplaceInstalledSkill, SkillSnapshot, SkillSource } from '../../src/types/skill';
import { resolveInstalledSkillId, resolveMarketplaceAvailability } from '../../src/pages/Skills/marketplace-state';

const sources: SkillSource[] = [
  {
    id: 'clawhub',
    label: 'ClawHub',
    enabled: true,
    site: 'https://clawhub.ai',
    workdir: 'C:/Users/test/.openclaw/skill-sources/clawhub',
  },
];

describe('marketplace-state', () => {
  it('blocks installation when the same skill already exists from a non-market source', () => {
    const skills: SkillSnapshot[] = [
      {
        id: 'self-improving-agent',
        slug: 'self-improving-agent',
        name: 'Self Improving Agent',
        description: 'Preinstalled copy',
        enabled: true,
        baseDir: 'C:/Users/test/.openclaw/skills/self-improving-agent',
      },
    ];

    const availability = resolveMarketplaceAvailability({
      slug: 'self-improving-agent',
      sourceId: 'clawhub',
      installedSkills: [],
      skills,
      sources,
    });

    expect(availability.blockedByNonMarketSource).toBe(true);
    expect(availability.occupiedByOtherSource).toBe(true);
    expect(availability.installedOnCurrentSource).toBe(false);
  });

  it('prefers the requested marketplace source when resolving the installed skill id', () => {
    const skills: SkillSnapshot[] = [
      {
        id: 'self-improving-agent',
        slug: 'self-improving-agent',
        name: 'Global copy',
        description: 'Managed dir',
        enabled: true,
        baseDir: 'C:/Users/test/.openclaw/skills/self-improving-agent',
      },
      {
        id: 'clawhub:self-improving-agent',
        slug: 'self-improving-agent',
        name: 'Marketplace copy',
        description: 'Market dir',
        enabled: true,
        sourceId: 'clawhub',
        baseDir: 'C:/Users/test/.openclaw/skill-sources/clawhub/skills/self-improving-agent',
      },
    ];

    expect(resolveInstalledSkillId('self-improving-agent', skills, 'clawhub')).toBe('clawhub:self-improving-agent');
  });

  it('keeps same-source marketplace installs available for update or uninstall', () => {
    const installedSkills: MarketplaceInstalledSkill[] = [
      {
        slug: 'nano-pdf',
        version: '1.0.0',
        sourceId: 'clawhub',
      },
    ];

    const skills: SkillSnapshot[] = [
      {
        id: 'clawhub:nano-pdf',
        slug: 'nano-pdf',
        name: 'Nano PDF',
        description: 'Installed from marketplace',
        enabled: true,
        sourceId: 'clawhub',
        baseDir: 'C:/Users/test/.openclaw/skill-sources/clawhub/skills/nano-pdf',
      },
    ];

    const availability = resolveMarketplaceAvailability({
      slug: 'nano-pdf',
      sourceId: 'clawhub',
      installedSkills,
      skills,
      sources,
    });

    expect(availability.installedOnCurrentSource).toBe(true);
    expect(availability.occupiedByOtherSource).toBe(false);
  });
});
