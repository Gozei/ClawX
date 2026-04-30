import { withConfigLock } from './config-mutex';
import {
  readOpenClawRuntimeConfig,
  writeOpenClawRuntimeConfig,
  type OpenClawConfigRecord,
} from './openclaw-config-assembler';
import {
  DREAM_MEMORY_PROMOTION_PRESETS,
  normalizeDreamMemoryPromotionSpeed,
  type DreamMemoryPromotionSpeed,
} from '../../shared/dream-memory';

const DREAMING_PLUGIN_ID = 'memory-core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyDreamModeToOpenClawConfig(
  runtimeConfig: OpenClawConfigRecord,
  enabled: boolean,
  promotionSpeed: DreamMemoryPromotionSpeed = 'balanced',
): OpenClawConfigRecord {
  const plugins = isRecord(runtimeConfig.plugins)
    ? { ...runtimeConfig.plugins }
    : {};
  const entries = isRecord(plugins.entries)
    ? { ...plugins.entries }
    : {};

  const existingMemoryCore = isRecord(entries[DREAMING_PLUGIN_ID])
    ? entries[DREAMING_PLUGIN_ID] as Record<string, unknown>
    : {};

  if (!enabled && !entries[DREAMING_PLUGIN_ID]) {
    return runtimeConfig;
  }

  const memoryCore = { ...existingMemoryCore };
  const pluginConfig = isRecord(memoryCore.config)
    ? { ...memoryCore.config }
    : {};
  const dreaming = isRecord(pluginConfig.dreaming)
    ? { ...pluginConfig.dreaming }
    : {};

  dreaming.enabled = enabled;
  if (enabled) {
    const phases = isRecord(dreaming.phases)
      ? { ...dreaming.phases }
      : {};
    const light = isRecord(phases.light)
      ? { ...phases.light }
      : {};
    const deep = isRecord(phases.deep)
      ? { ...phases.deep }
      : {};
    const rem = isRecord(phases.rem)
      ? { ...phases.rem }
      : {};
    const preset = DREAM_MEMORY_PROMOTION_PRESETS[normalizeDreamMemoryPromotionSpeed(promotionSpeed)];

    dreaming.frequency = preset.frequency;
    light.lookbackDays = preset.light.lookbackDays;
    light.limit = preset.light.limit;
    deep.limit = preset.deep.limit;
    deep.minScore = preset.deep.minScore;
    deep.minRecallCount = preset.deep.minRecallCount;
    deep.minUniqueQueries = preset.deep.minUniqueQueries;
    deep.recencyHalfLifeDays = preset.deep.recencyHalfLifeDays;
    deep.maxAgeDays = preset.deep.maxAgeDays;
    rem.lookbackDays = preset.rem.lookbackDays;
    rem.limit = preset.rem.limit;
    rem.minPatternStrength = preset.rem.minPatternStrength;
    phases.light = light;
    phases.deep = deep;
    phases.rem = rem;
    dreaming.phases = phases;
  }
  pluginConfig.dreaming = dreaming;
  memoryCore.config = pluginConfig;

  if (enabled) {
    memoryCore.enabled = true;
  }

  entries[DREAMING_PLUGIN_ID] = memoryCore;
  plugins.entries = entries;

  const nextConfig: OpenClawConfigRecord = {
    ...runtimeConfig,
    plugins,
  };

  return sameJson(nextConfig, runtimeConfig) ? runtimeConfig : nextConfig;
}

export async function syncDreamModeToOpenClawConfig(
  enabled: boolean,
  promotionSpeed: DreamMemoryPromotionSpeed = 'balanced',
): Promise<boolean> {
  return await withConfigLock(async () => {
    const runtimeConfig = await readOpenClawRuntimeConfig();
    const nextConfig = applyDreamModeToOpenClawConfig(runtimeConfig, enabled, promotionSpeed);
    if (nextConfig === runtimeConfig || sameJson(nextConfig, runtimeConfig)) {
      return false;
    }
    await writeOpenClawRuntimeConfig(nextConfig);
    return true;
  });
}
