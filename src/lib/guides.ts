export type GuidePlacement = 'top' | 'right' | 'bottom' | 'left' | 'center';

export type GuideStep = {
  id: string;
  route: string;
  targetId?: string;
  placement?: GuidePlacement;
  titleKey: string;
  descriptionKey: string;
};

export type GuideDefinition = {
  id: string;
  namespace: 'skills';
  version: number;
  titleKey: string;
  steps: GuideStep[];
};

export const SKILLS_PAGE_GUIDE_ID = 'skills-page-basics';
export const SKILLS_PAGE_GUIDE_VERSION = 1;

const GUIDE_DEFINITIONS: Record<string, GuideDefinition> = {
  [SKILLS_PAGE_GUIDE_ID]: {
    id: SKILLS_PAGE_GUIDE_ID,
    namespace: 'skills',
    version: SKILLS_PAGE_GUIDE_VERSION,
    titleKey: 'guide.title',
    steps: [
      {
        id: 'search',
        route: '/skills',
        targetId: 'skills-search',
        placement: 'bottom',
        titleKey: 'guide.steps.search.title',
        descriptionKey: 'guide.steps.search.description',
      },
      {
        id: 'create',
        route: '/skills',
        targetId: 'skills-create',
        placement: 'bottom',
        titleKey: 'guide.steps.create.title',
        descriptionKey: 'guide.steps.create.description',
      },
      {
        id: 'marketplace',
        route: '/skills',
        targetId: 'skills-marketplace',
        placement: 'bottom',
        titleKey: 'guide.steps.marketplace.title',
        descriptionKey: 'guide.steps.marketplace.description',
      },
    ],
  },
};

export function getGuideDefinition(guideId: string | null | undefined): GuideDefinition | null {
  if (!guideId) return null;
  return GUIDE_DEFINITIONS[guideId] ?? null;
}
