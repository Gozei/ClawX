import { withConfigLock } from './config-mutex';
import {
  readOpenClawRuntimeConfig,
  writeOpenClawRuntimeConfig,
  type OpenClawConfigRecord,
} from './openclaw-config-assembler';

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

export async function syncDreamModeToOpenClawConfig(enabled: boolean): Promise<boolean> {
  return await withConfigLock(async () => {
    const runtimeConfig = await readOpenClawRuntimeConfig();
    const nextConfig = applyDreamModeToOpenClawConfig(runtimeConfig, enabled);
    if (nextConfig === runtimeConfig || sameJson(nextConfig, runtimeConfig)) {
      return false;
    }
    await writeOpenClawRuntimeConfig(nextConfig);
    return true;
  });
}
