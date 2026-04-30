export const DREAM_MEMORY_PROMOTION_SPEEDS = ['conservative', 'balanced', 'aggressive'] as const;

export type DreamMemoryPromotionSpeed = typeof DREAM_MEMORY_PROMOTION_SPEEDS[number];

export const DEFAULT_DREAM_MEMORY_PROMOTION_SPEED: DreamMemoryPromotionSpeed = 'balanced';

export type DreamMemoryPromotionPreset = {
  frequency: string;
  light: {
    lookbackDays: number;
    limit: number;
  };
  deep: {
    limit: number;
    minScore: number;
    minRecallCount: number;
    minUniqueQueries: number;
    recencyHalfLifeDays: number;
    maxAgeDays: number;
  };
  rem: {
    lookbackDays: number;
    limit: number;
    minPatternStrength: number;
  };
};

export const DREAM_MEMORY_PROMOTION_PRESETS: Record<DreamMemoryPromotionSpeed, DreamMemoryPromotionPreset> = {
  conservative: {
    frequency: '0 3 * * *',
    light: {
      lookbackDays: 2,
      limit: 80,
    },
    deep: {
      limit: 6,
      minScore: 0.86,
      minRecallCount: 4,
      minUniqueQueries: 3,
      recencyHalfLifeDays: 10,
      maxAgeDays: 21,
    },
    rem: {
      lookbackDays: 7,
      limit: 8,
      minPatternStrength: 0.82,
    },
  },
  balanced: {
    frequency: '0 3 * * *',
    light: {
      lookbackDays: 2,
      limit: 100,
    },
    deep: {
      limit: 10,
      minScore: 0.8,
      minRecallCount: 3,
      minUniqueQueries: 3,
      recencyHalfLifeDays: 14,
      maxAgeDays: 30,
    },
    rem: {
      lookbackDays: 7,
      limit: 10,
      minPatternStrength: 0.75,
    },
  },
  aggressive: {
    frequency: '0 3 * * *',
    light: {
      lookbackDays: 7,
      limit: 240,
    },
    deep: {
      limit: 32,
      minScore: 0.42,
      minRecallCount: 1,
      minUniqueQueries: 1,
      recencyHalfLifeDays: 45,
      maxAgeDays: 120,
    },
    rem: {
      lookbackDays: 30,
      limit: 32,
      minPatternStrength: 0.45,
    },
  },
};

export function normalizeDreamMemoryPromotionSpeed(value: unknown): DreamMemoryPromotionSpeed {
  return DREAM_MEMORY_PROMOTION_SPEEDS.includes(value as DreamMemoryPromotionSpeed)
    ? value as DreamMemoryPromotionSpeed
    : DEFAULT_DREAM_MEMORY_PROMOTION_SPEED;
}
