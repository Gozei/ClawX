import { app } from 'electron';
import path from 'path';
import { existsSync, readFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, type Dirent } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

function fsPath(filePath: string): string {
  if (process.platform !== 'win32') return filePath;
  if (!filePath) return filePath;
  if (filePath.startsWith('\\\\?\\')) return filePath;
  const windowsPath = filePath.replace(/\//g, '\\');
  if (!path.win32.isAbsolute(windowsPath)) return windowsPath;
  if (windowsPath.startsWith('\\\\')) {
    return `\\\\?\\UNC\\${windowsPath.slice(2)}`;
  }
  return `\\\\?\\${windowsPath}`;
}
import { getAllSettings } from '../utils/store';
import { getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getProviderEnvVar, getKeyableProviderTypes } from '../utils/provider-registry';
import { getOpenClawDir, getOpenClawEntryPath, getOpenClawStatus, isOpenClawPresent } from '../utils/paths';
import { getUvMirrorEnv } from '../utils/uv-env';
import { cleanupDanglingWeChatPluginState, listConfiguredChannels, readOpenClawConfig } from '../utils/channel-config';
import { syncGatewayTokenToConfig, syncBrowserConfigToOpenClaw, syncSessionIdleMinutesToOpenClaw, sanitizeOpenClawConfig } from '../utils/openclaw-auth';
import { buildProxyEnv, resolveProxySettings } from '../utils/proxy';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import { syncDreamModeToOpenClawConfig } from '../utils/dream-mode';
import { logger } from '../utils/logger';
import { prependPathEntry } from '../utils/env-path';
import { copyPluginFromNodeModules, fixupPluginManifest, cpSyncSafe } from '../utils/plugin-install';
import {
  resolveChannelStartupPolicyForConfiguredChannels,
  stripSystemdSupervisorEnv,
  withUtf8RuntimeEnv,
} from './config-sync-env';
import { shouldDisableManagedGatewayBonjour, summarizeManagedGatewayDiscovery } from './discovery-defaults';


export interface GatewayLaunchContext {
  appSettings: Awaited<ReturnType<typeof getAllSettings>>;
  openclawDir: string;
  entryScript: string;
  gatewayArgs: string[];
  forkEnv: Record<string, string | undefined>;
  mode: 'dev' | 'packaged';
  binPathExists: boolean;
  loadedProviderKeyCount: number;
  proxySummary: string;
  channelStartupSummary: string;
  discoverySummary: string;
}

function isLocalOpenClawOverrideActive(): boolean {
  return !app.isPackaged && Boolean(process.env.CLAWX_OPENCLAW_LOCAL_DIR?.trim());
}

function assertLocalOpenClawBuildReady(openclawDir: string): void {
  if (!isLocalOpenClawOverrideActive()) {
    return;
  }

  const requiredFiles = [
    join(openclawDir, 'package.json'),
    join(openclawDir, 'openclaw.mjs'),
    join(openclawDir, 'dist', 'entry.js'),
    join(openclawDir, 'dist', 'control-ui', 'index.html'),
  ];
  const missing = requiredFiles.filter((file) => !existsSync(fsPath(file)));
  const buildHint =
    `Local OpenClaw override is not ready at ${openclawDir}. ` +
    'Run `pnpm build` and `pnpm ui:build` in the OpenClaw checkout, then restart ClawX.';

  if (missing.length > 0) {
    throw new Error(`${buildHint} Missing: ${missing.join(', ')}`);
  }

  const distEntry = join(openclawDir, 'dist', 'entry.js');
  const sourceFilesToCheck = [
    join(openclawDir, 'src', 'gateway', 'server-startup-post-attach.ts'),
    join(openclawDir, 'src', 'gateway', 'server-startup-memory.ts'),
    join(openclawDir, 'src', 'agents', 'session-write-lock.ts'),
  ];

  let distEntryMtime = 0;
  try {
    distEntryMtime = statSync(fsPath(distEntry)).mtimeMs;
  } catch {
    throw new Error(`${buildHint} Missing or unreadable: ${distEntry}`);
  }

  const staleSource = sourceFilesToCheck.find((file) => {
    try {
      return existsSync(fsPath(file)) && statSync(fsPath(file)).mtimeMs > distEntryMtime + 1000;
    } catch {
      return false;
    }
  });

  if (staleSource) {
    throw new Error(
      `${buildHint} Source appears newer than dist output: ${staleSource}`,
    );
  }
}

// ── Auto-upgrade bundled plugins on startup ──────────────────────

const CHANNEL_PLUGIN_MAP: Record<string, { dirName: string; npmName: string }> = {
  dingtalk: { dirName: 'dingtalk', npmName: '@soimy/dingtalk' },
  wecom: { dirName: 'wecom', npmName: '@wecom/wecom-openclaw-plugin' },
  feishu: { dirName: 'feishu-openclaw-plugin', npmName: '@larksuite/openclaw-lark' },

  'openclaw-weixin': { dirName: 'openclaw-weixin', npmName: '@tencent-weixin/openclaw-weixin' },
};

/**
 * OpenClaw 3.22+ ships Discord, Telegram, and other channels as built-in
 * extensions.  If a previous ClawX version copied one of these into
 * ~/.openclaw/extensions/, the broken copy overrides the working built-in
 * plugin and must be removed.
 */
const BUILTIN_CHANNEL_EXTENSIONS = ['discord', 'telegram', 'qqbot'];

function cleanupStaleBuiltInExtensions(): void {
  for (const ext of BUILTIN_CHANNEL_EXTENSIONS) {
    const extDir = join(homedir(), '.openclaw', 'extensions', ext);
    if (existsSync(fsPath(extDir))) {
      logger.info(`[plugin] Removing stale built-in extension copy: ${ext}`);
      try {
        rmSync(fsPath(extDir), { recursive: true, force: true });
      } catch (err) {
        logger.warn(`[plugin] Failed to remove stale extension ${ext}:`, err);
      }
    }
  }
}

function dingtalkExtensionReferencesLegacyTelegramCore(extRoot: string): boolean {
  const channelPaths = [
    join(extRoot, 'src', 'channel.ts'),
    join(extRoot, 'src', 'channel.tsx'),
    join(extRoot, 'channel.ts'),
    join(extRoot, 'index.ts'),
    join(extRoot, 'index.js'),
  ];
  for (const ch of channelPaths) {
    if (!existsSync(fsPath(ch))) continue;
    try {
      const text = readFileSync(fsPath(ch), 'utf8');
      if (text.includes('telegram-core')) {
        return true;
      }
    } catch {
      // ignore per-file read failures
    }
  }

  const stack: string[] = [extRoot];
  let scanned = 0;
  const maxFiles = 120;
  while (stack.length > 0 && scanned < maxFiles) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(fsPath(dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const entryName = String(ent.name);
      if (entryName === 'node_modules' || entryName === '.git') continue;
      const full = join(dir, entryName);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(entryName)) continue;
      scanned++;
      let text: string;
      try {
        text = readFileSync(fsPath(full), 'utf8');
      } catch {
        continue;
      }
      if (text.includes('root-alias.cjs/telegram-core') || text.includes('root-alias.cjs\\telegram-core')) {
        return true;
      }
    }
  }
  return false;
}

function quarantineLegacyDingtalkExtensionIfNeeded(openclawDir: string): void {
  const extRoot = join(homedir(), '.openclaw', 'extensions', 'dingtalk');
  if (!existsSync(fsPath(extRoot))) {
    return;
  }
  const legacyTelegramCore = join(openclawDir, 'dist', 'plugin-sdk', 'root-alias.cjs', 'telegram-core');
  if (existsSync(fsPath(legacyTelegramCore))) {
    return;
  }
  if (!dingtalkExtensionReferencesLegacyTelegramCore(extRoot)) {
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(homedir(), '.openclaw', 'extensions', `dingtalk.disabled-by-clawx-${stamp}`);
  if (existsSync(fsPath(dest))) {
    return;
  }
  try {
    renameSync(fsPath(extRoot), fsPath(dest));
    logger.warn(`[plugin] Quarantined incompatible dingtalk extension that still references telegram-core. Backup path: ${dest}`);
  } catch (err) {
    logger.warn('[plugin] Failed to quarantine incompatible dingtalk extension at ~/.openclaw/extensions/dingtalk', err);
  }
}

function cleanupStalePluginInstallArtifacts(): void {
  const extensionsRoot = join(homedir(), '.openclaw', 'extensions');
  if (!existsSync(fsPath(extensionsRoot))) {
    return;
  }

  try {
    for (const entry of readdirSync(fsPath(extensionsRoot), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith('.openclaw-install-')) continue;
      const targetDir = join(extensionsRoot, entry.name);
      logger.info(`[plugin] Removing stale plugin install artifact: ${entry.name}`);
      rmSync(fsPath(targetDir), { recursive: true, force: true });
    }
  } catch (err) {
    logger.warn('[plugin] Failed to remove stale plugin install artifacts:', err);
  }
}

function readPluginVersion(pkgJsonPath: string): string | null {
  try {
    const raw = readFileSync(fsPath(pkgJsonPath), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

function buildBundledPluginSources(pluginDirName: string): string[] {
  return app.isPackaged
    ? [
      join(process.resourcesPath, 'openclaw-plugins', pluginDirName),
      join(process.resourcesPath, 'app.asar.unpacked', 'build', 'openclaw-plugins', pluginDirName),
      join(process.resourcesPath, 'app.asar.unpacked', 'openclaw-plugins', pluginDirName),
    ]
    : [
      join(app.getAppPath(), 'build', 'openclaw-plugins', pluginDirName),
      join(process.cwd(), 'build', 'openclaw-plugins', pluginDirName),
    ];
}

/**
 * Auto-upgrade all configured channel plugins before Gateway start.
 * - Packaged mode: uses bundled plugins from resources/ (includes deps)
 * - Dev mode: falls back to node_modules/ with pnpm-aware dep collection
 */
function ensureConfiguredPluginsUpgraded(configuredChannels: string[]): void {
  for (const channelType of configuredChannels) {
    const pluginInfo = CHANNEL_PLUGIN_MAP[channelType];
    if (!pluginInfo) continue;
    const { dirName, npmName } = pluginInfo;

    const targetDir = join(homedir(), '.openclaw', 'extensions', dirName);
    const targetManifest = join(targetDir, 'openclaw.plugin.json');
    const isInstalled = existsSync(fsPath(targetManifest));
    const installedVersion = isInstalled ? readPluginVersion(join(targetDir, 'package.json')) : null;

    // Try bundled sources first (packaged mode or if bundle-plugins was run)
    const bundledSources = buildBundledPluginSources(dirName);
    const bundledDir = bundledSources.find((dir) => existsSync(fsPath(join(dir, 'openclaw.plugin.json'))));

    if (bundledDir) {
      const sourceVersion = readPluginVersion(join(bundledDir, 'package.json'));
      // Install or upgrade if version differs or plugin not installed
      if (!isInstalled || (sourceVersion && installedVersion && sourceVersion !== installedVersion)) {
        logger.info(`[plugin] ${isInstalled ? 'Auto-upgrading' : 'Installing'} ${channelType} plugin${isInstalled ? `: ${installedVersion} → ${sourceVersion}` : `: ${sourceVersion}`} (bundled)`);
        try {
          mkdirSync(fsPath(join(homedir(), '.openclaw', 'extensions')), { recursive: true });
          rmSync(fsPath(targetDir), { recursive: true, force: true });
          cpSyncSafe(bundledDir, targetDir);
          fixupPluginManifest(targetDir);
        } catch (err) {
          logger.warn(`[plugin] Failed to ${isInstalled ? 'auto-upgrade' : 'install'} ${channelType} plugin:`, err);
        }
      } else if (isInstalled) {
        // Same version already installed — still patch manifest ID in case it was
        // never corrected (e.g. installed before MANIFEST_ID_FIXES included this plugin).
        fixupPluginManifest(targetDir);
      }
      continue;
    }

    // Dev mode fallback: copy from node_modules/ with pnpm dep resolution
    if (!app.isPackaged) {
      const npmPkgPath = join(process.cwd(), 'node_modules', ...npmName.split('/'));
      if (!existsSync(fsPath(join(npmPkgPath, 'openclaw.plugin.json')))) continue;
      const sourceVersion = readPluginVersion(join(npmPkgPath, 'package.json'));
      if (!sourceVersion) continue;
      // Skip only if installed AND same version — but still patch manifest ID.
      if (isInstalled && installedVersion && sourceVersion === installedVersion) {
        fixupPluginManifest(targetDir);
        continue;
      }

      logger.info(`[plugin] ${isInstalled ? 'Auto-upgrading' : 'Installing'} ${channelType} plugin${isInstalled ? `: ${installedVersion} → ${sourceVersion}` : `: ${sourceVersion}`} (dev/node_modules)`);

      try {
        mkdirSync(fsPath(join(homedir(), '.openclaw', 'extensions')), { recursive: true });
        copyPluginFromNodeModules(npmPkgPath, targetDir, npmName);
        fixupPluginManifest(targetDir);
      } catch (err) {
        logger.warn(`[plugin] Failed to ${isInstalled ? 'auto-upgrade' : 'install'} ${channelType} plugin from node_modules:`, err);
      }
    }
  }
}

// ── Pre-launch sync ──────────────────────────────────────────────

export async function syncGatewayConfigBeforeLaunch(
  appSettings: Awaited<ReturnType<typeof getAllSettings>>,
): Promise<void> {
  await syncProxyConfigToOpenClaw(appSettings, { preserveExistingWhenDisabled: true });
  await syncDreamModeToOpenClawConfig(appSettings.dreamModeEnabled);

  try {
    await sanitizeOpenClawConfig();
  } catch (err) {
    logger.warn('Failed to sanitize openclaw.json:', err);
  }

  try {
    await cleanupDanglingWeChatPluginState();
  } catch (err) {
    logger.warn('Failed to clean dangling WeChat plugin state before launch:', err);
  }

  // Remove stale copies of built-in extensions (Discord, Telegram) that
  // override OpenClaw's working built-in plugins and break channel loading.
  try {
    cleanupStaleBuiltInExtensions();
  } catch (err) {
    logger.warn('Failed to clean stale built-in extensions:', err);
  }

  try {
    quarantineLegacyDingtalkExtensionIfNeeded(getOpenClawDir());
  } catch (err) {
    logger.warn('Failed to quarantine legacy dingtalk extension:', err);
  }

  try {
    cleanupStalePluginInstallArtifacts();
  } catch (err) {
    logger.warn('Failed to clean stale plugin install artifacts:', err);
  }

  // Auto-upgrade installed plugins before Gateway starts so that
  // the plugin manifest ID matches what sanitize wrote to the config.
  try {
    const configuredChannels = await listConfiguredChannels();

    // Also ensure plugins referenced in plugins.allow are installed even if
    // they have no channels.X section yet (e.g. qqbot added via plugins.allow
    // but never fully saved through ClawX UI).
    try {
      const rawCfg = await readOpenClawConfig();
      const allowList = Array.isArray(rawCfg.plugins?.allow) ? (rawCfg.plugins!.allow as string[]) : [];
      // Build reverse maps: dirName → channelType AND known manifest IDs → channelType
      const pluginIdToChannel: Record<string, string> = {};
      for (const [channelType, info] of Object.entries(CHANNEL_PLUGIN_MAP)) {
        pluginIdToChannel[info.dirName] = channelType;
      }
      // Known manifest IDs that differ from their dirName/channelType

      pluginIdToChannel['openclaw-lark'] = 'feishu';
      pluginIdToChannel['feishu-openclaw-plugin'] = 'feishu';

      for (const pluginId of allowList) {
        const channelType = pluginIdToChannel[pluginId] ?? pluginId;
        if (CHANNEL_PLUGIN_MAP[channelType] && !configuredChannels.includes(channelType)) {
          configuredChannels.push(channelType);
        }
      }

    } catch (err) {
      logger.warn('[plugin] Failed to augment channel list from plugins.allow:', err);
    }

    ensureConfiguredPluginsUpgraded(configuredChannels);
  } catch (err) {
    logger.warn('Failed to auto-upgrade plugins:', err);
  }

  try {
    quarantineLegacyDingtalkExtensionIfNeeded(getOpenClawDir());
  } catch (err) {
    logger.warn('Failed to quarantine legacy dingtalk extension (post-upgrade):', err);
  }

  try {
    await syncGatewayTokenToConfig(appSettings.gatewayToken);
  } catch (err) {
    logger.warn('Failed to sync gateway token to openclaw.json:', err);
  }

  try {
    await syncBrowserConfigToOpenClaw();
  } catch (err) {
    logger.warn('Failed to sync browser config to openclaw.json:', err);
  }

  try {
    await syncSessionIdleMinutesToOpenClaw();
  } catch (err) {
    logger.warn('Failed to sync session idle minutes to openclaw.json:', err);
  }

  try {
    await sanitizeOpenClawConfig();
  } catch (err) {
    logger.warn('Failed to re-sanitize openclaw.json after launch sync:', err);
  }
}

async function loadProviderEnv(): Promise<{ providerEnv: Record<string, string>; loadedProviderKeyCount: number }> {
  const providerEnv: Record<string, string> = {};
  const providerTypes = getKeyableProviderTypes();
  let loadedProviderKeyCount = 0;

  try {
    const defaultProviderId = await getDefaultProvider();
    if (defaultProviderId) {
      const defaultProvider = await getProvider(defaultProviderId);
      const defaultProviderType = defaultProvider?.type;
      const defaultProviderKey = await getApiKey(defaultProviderId);
      if (defaultProviderType && defaultProviderKey) {
        const envVar = getProviderEnvVar(defaultProviderType);
        if (envVar) {
          providerEnv[envVar] = defaultProviderKey;
          loadedProviderKeyCount++;
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load default provider key for environment injection:', err);
  }

  for (const providerType of providerTypes) {
    try {
      const key = await getApiKey(providerType);
      if (key) {
        const envVar = getProviderEnvVar(providerType);
        if (envVar) {
          providerEnv[envVar] = key;
          loadedProviderKeyCount++;
        }
      }
    } catch (err) {
      logger.warn(`Failed to load API key for ${providerType}:`, err);
    }
  }

  return { providerEnv, loadedProviderKeyCount };
}

async function resolveChannelStartupPolicy(): Promise<{
  skipChannels: boolean;
  channelStartupSummary: string;
}> {
  try {
    const configuredChannels = await listConfiguredChannels();
    return resolveChannelStartupPolicyForConfiguredChannels(configuredChannels);
  } catch (error) {
    logger.warn('Failed to determine configured channels for gateway launch:', error);
    return {
      skipChannels: false,
      channelStartupSummary: 'enabled(unknown)',
    };
  }
}

export async function prepareGatewayLaunchContext(port: number): Promise<GatewayLaunchContext> {
  const openclawDir = getOpenClawDir();
  const entryScript = getOpenClawEntryPath();
  const openclawVersion = getOpenClawStatus().version?.trim();

  if (!isOpenClawPresent()) {
    throw new Error(`OpenClaw package not found at: ${openclawDir}`);
  }
  assertLocalOpenClawBuildReady(openclawDir);

  const appSettings = await getAllSettings();
  await syncGatewayConfigBeforeLaunch(appSettings);

  if (!existsSync(entryScript)) {
    throw new Error(`OpenClaw entry script not found at: ${entryScript}`);
  }

  const gatewayArgs = ['gateway', '--port', String(port), '--token', appSettings.gatewayToken, '--allow-unconfigured'];
  const mode = app.isPackaged ? 'packaged' : 'dev';

  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binPath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(process.cwd(), 'resources', 'bin', target);
  const binPathExists = existsSync(binPath);

  const { providerEnv, loadedProviderKeyCount } = await loadProviderEnv();
  const { skipChannels, channelStartupSummary } = await resolveChannelStartupPolicy();
  const runtimeConfig = await readOpenClawConfig().catch((error) => {
    logger.warn('Failed to read OpenClaw config while preparing Gateway discovery defaults:', error);
    return {} as Record<string, unknown>;
  });
  const disableBonjour = shouldDisableManagedGatewayBonjour(runtimeConfig);
  const discoverySummary = summarizeManagedGatewayDiscovery(runtimeConfig);
  const uvEnv = await getUvMirrorEnv();
  const proxyEnv = buildProxyEnv(appSettings);
  const resolvedProxy = resolveProxySettings(appSettings);
  const proxySummary = appSettings.proxyEnabled
    ? `http=${resolvedProxy.httpProxy || '-'}, https=${resolvedProxy.httpsProxy || '-'}, all=${resolvedProxy.allProxy || '-'}`
    : 'disabled';

  const { NODE_OPTIONS: _nodeOptions, ...baseEnv } = process.env;
  const baseEnvRecord = baseEnv as Record<string, string | undefined>;
  const baseEnvPatched = binPathExists
    ? prependPathEntry(baseEnvRecord, binPath).env
    : baseEnvRecord;
  const forkEnv: Record<string, string | undefined> = withUtf8RuntimeEnv({
    ...stripSystemdSupervisorEnv(baseEnvPatched),
    ...providerEnv,
    ...uvEnv,
    ...proxyEnv,
    // UtilityProcess can occasionally lose the package-version signal under
    // pnpm/Electron dev startup. Export the resolved version explicitly so the
    // Gateway and any nested runtime helpers agree on the same release label.
    ...(openclawVersion ? {
      OPENCLAW_VERSION: openclawVersion,
      OPENCLAW_SERVICE_VERSION: openclawVersion,
      OPENCLAW_BUNDLED_VERSION: openclawVersion,
    } : {}),
    // Some bundled/external plugins still import the transitional compat entry.
    // Keep the runtime quiet here so genuine Gateway failures remain visible.
    OPENCLAW_SUPPRESS_PLUGIN_SDK_COMPAT_WARNING: '1',
    OPENCLAW_GATEWAY_TOKEN: appSettings.gatewayToken,
    OPENCLAW_SKIP_CHANNELS: skipChannels ? '1' : '',
    CLAWDBOT_SKIP_CHANNELS: skipChannels ? '1' : '',
    OPENCLAW_NO_RESPAWN: '1',
    ...(disableBonjour ? { OPENCLAW_DISABLE_BONJOUR: '1' } : {}),
  });

  return {
    appSettings,
    openclawDir,
    entryScript,
    gatewayArgs,
    forkEnv,
    mode,
    binPathExists,
    loadedProviderKeyCount,
    proxySummary,
    channelStartupSummary,
    discoverySummary,
  };
}
