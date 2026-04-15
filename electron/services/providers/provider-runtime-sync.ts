import type { GatewayManager } from '../../gateway/manager';
import { getProviderAccount, listProviderAccounts } from './provider-store';
import { getProviderSecret } from '../secrets/secret-store';
import type { ProviderConfig } from '../../utils/secure-storage';
import { getAllProviders, getApiKey, getDefaultProvider, getProvider } from '../../utils/secure-storage';
import { getProviderConfig, getProviderDefaultModel } from '../../utils/provider-registry';
import {
  removeProviderFromOpenClaw,
  removeProviderKeyFromOpenClaw,
  saveOAuthTokenToOpenClaw,
  saveProviderKeyToOpenClaw,
  setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride,
  syncProviderConfigToOpenClaw,
  updateAgentModelProvider,
  updateSingleAgentModelProvider,
} from '../../utils/openclaw-auth';
import { getOpenClawProviderKeyForType } from '../../utils/provider-keys';
import { logger } from '../../utils/logger';
import { listAgentsSnapshot } from '../../utils/agent-config';

const GOOGLE_OAUTH_RUNTIME_PROVIDER = 'google-gemini-cli';
const GOOGLE_OAUTH_DEFAULT_MODEL_REF = `${GOOGLE_OAUTH_RUNTIME_PROVIDER}/gemini-3-pro-preview`;
const OPENAI_OAUTH_RUNTIME_PROVIDER = 'openai-codex';
const OPENAI_OAUTH_DEFAULT_MODEL_REF = `${OPENAI_OAUTH_RUNTIME_PROVIDER}/gpt-5.4`;

function getProviderDeletionAliases(config: ProviderConfig): string[] {
  if (config.type === 'openai') {
    return [OPENAI_OAUTH_RUNTIME_PROVIDER];
  }
  if (config.type === 'google') {
    return [GOOGLE_OAUTH_RUNTIME_PROVIDER];
  }
  return [];
}

/**
 * Provider types that are not in the built-in provider registry (no `providerConfig.api`).
 * They require explicit api-protocol defaulting to `openai-completions`.
 */
function isUnregisteredProviderType(type: string): boolean {
  return type === 'custom' || type === 'ollama';
}

type RuntimeProviderSyncContext = {
  runtimeProviderKey: string;
  meta: ReturnType<typeof getProviderConfig>;
  api: string;
};
type ProviderProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages';
const SUPPORTED_PROVIDER_PROTOCOLS: ProviderProtocol[] = ['openai-completions', 'openai-responses', 'anthropic-messages'];

function getConfiguredModelProtocol(config: ProviderConfig, modelId?: string): ProviderProtocol | undefined {
  const normalizedModelId = (modelId || '').trim();
  const mapping = config.metadata?.modelProtocols;
  if (normalizedModelId && mapping && typeof mapping[normalizedModelId] === 'string') {
    const protocol = mapping[normalizedModelId];
    if (SUPPORTED_PROVIDER_PROTOCOLS.includes(protocol)) {
      return protocol;
    }
  }
  return undefined;
}

function resolveProviderApiProtocol(
  config: ProviderConfig,
  fallbackApi: string | undefined,
  modelId?: string,
): string | undefined {
  return getConfiguredModelProtocol(config, modelId) || fallbackApi;
}

function getConfiguredProviderModelIds(config: ProviderConfig): string[] {
  return Array.from(new Set([
    (config.model || '').trim(),
    ...((config.metadata?.customModels ?? []).map((modelId) => modelId.trim())),
  ].filter(Boolean)));
}

function normalizeProviderBaseUrl(
  config: ProviderConfig,
  baseUrl?: string,
  apiProtocol?: string,
): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  const normalized = baseUrl.trim().replace(/\/+$/, '');

  if (config.type === 'minimax-portal' || config.type === 'minimax-portal-cn') {
    return normalized.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
  }

  if (isUnregisteredProviderType(config.type)) {
    const protocol = apiProtocol || config.apiProtocol || 'openai-completions';
    if (protocol === 'openai-responses') {
      return normalized.replace(/\/responses?$/i, '');
    }
    if (protocol === 'openai-completions') {
      return normalized.replace(/\/chat\/completions$/i, '');
    }
    if (protocol === 'anthropic-messages') {
      return normalized.replace(/\/v1\/messages$/i, '').replace(/\/messages$/i, '');
    }
  }

  return normalized;
}

function shouldUseExplicitDefaultOverride(config: ProviderConfig, runtimeProviderKey: string): boolean {
  return Boolean(config.baseUrl || config.apiProtocol || runtimeProviderKey !== config.type);
}

export const getOpenClawProviderKey = getOpenClawProviderKeyForType;

async function resolveRuntimeProviderKey(config: ProviderConfig): Promise<string> {
  const account = await getProviderAccount(config.id);
  if (account?.authMode === 'oauth_browser') {
    if (config.type === 'google') {
      return GOOGLE_OAUTH_RUNTIME_PROVIDER;
    }
    if (config.type === 'openai') {
      return OPENAI_OAUTH_RUNTIME_PROVIDER;
    }
  }
  return getOpenClawProviderKey(config.type, config.id);
}

async function getBrowserOAuthRuntimeProvider(config: ProviderConfig): Promise<string | null> {
  const account = await getProviderAccount(config.id);
  if (account?.authMode !== 'oauth_browser') {
    return null;
  }

  const secret = await getProviderSecret(config.id);
  if (secret?.type !== 'oauth') {
    return null;
  }

  if (config.type === 'google') {
    return GOOGLE_OAUTH_RUNTIME_PROVIDER;
  }
  if (config.type === 'openai') {
    return OPENAI_OAUTH_RUNTIME_PROVIDER;
  }
  return null;
}

export function getProviderModelRef(config: ProviderConfig): string | undefined {
  const providerKey = getOpenClawProviderKey(config.type, config.id);

  if (config.model) {
    return config.model.startsWith(`${providerKey}/`)
      ? config.model
      : `${providerKey}/${config.model}`;
  }

  const defaultModel = getProviderDefaultModel(config.type);
  if (!defaultModel) {
    return undefined;
  }

  return defaultModel.startsWith(`${providerKey}/`)
    ? defaultModel
    : `${providerKey}/${defaultModel}`;
}

export async function getProviderFallbackModelRefs(config: ProviderConfig): Promise<string[]> {
  const allProviders = await getAllProviders();
  const providerMap = new Map(allProviders.map((provider) => [provider.id, provider]));
  const seen = new Set<string>();
  const results: string[] = [];
  const providerKey = getOpenClawProviderKey(config.type, config.id);

  for (const fallbackModel of config.fallbackModels ?? []) {
    const normalizedModel = fallbackModel.trim();
    if (!normalizedModel) continue;

    const modelRef = normalizedModel.startsWith(`${providerKey}/`)
      ? normalizedModel
      : `${providerKey}/${normalizedModel}`;

    if (seen.has(modelRef)) continue;
    seen.add(modelRef);
    results.push(modelRef);
  }

  for (const fallbackId of config.fallbackProviderIds ?? []) {
    if (!fallbackId || fallbackId === config.id) continue;

    const fallbackProvider = providerMap.get(fallbackId);
    if (!fallbackProvider) continue;

    const modelRef = getProviderModelRef(fallbackProvider);
    if (!modelRef || seen.has(modelRef)) continue;

    seen.add(modelRef);
    results.push(modelRef);
  }

  return results;
}

type GatewayRefreshMode = 'reload' | 'restart';

const PROVIDER_REFRESH_DEBOUNCE_MS = 2500;
let pendingGatewayRefreshTimer: NodeJS.Timeout | null = null;
let pendingGatewayRefreshRequest:
  | {
    message: string;
    mode: GatewayRefreshMode;
    onlyIfRunning: boolean;
    gatewayManager?: GatewayManager;
  }
  | null = null;

function scheduleGatewayRefresh(
  gatewayManager: GatewayManager | undefined,
  message: string,
  options?: { delayMs?: number; onlyIfRunning?: boolean; mode?: GatewayRefreshMode },
): void {
  if (!gatewayManager) {
    return;
  }

  if (options?.onlyIfRunning && gatewayManager.getStatus().state === 'stopped') {
    return;
  }

  const requestedMode = options?.mode === 'restart' ? 'restart' : 'reload';
  const requestedOnlyIfRunning = options?.onlyIfRunning === true;

  if (!pendingGatewayRefreshRequest) {
    pendingGatewayRefreshRequest = {
      message,
      mode: requestedMode,
      onlyIfRunning: requestedOnlyIfRunning,
      gatewayManager,
    };
  } else {
    pendingGatewayRefreshRequest = {
      message,
      mode: pendingGatewayRefreshRequest.mode === 'restart' || requestedMode === 'restart' ? 'restart' : 'reload',
      onlyIfRunning: pendingGatewayRefreshRequest.onlyIfRunning && requestedOnlyIfRunning,
      gatewayManager: pendingGatewayRefreshRequest.gatewayManager || gatewayManager,
    };
  }

  if (pendingGatewayRefreshTimer) {
    clearTimeout(pendingGatewayRefreshTimer);
  }

  const effectiveDelayMs = Math.max(options?.delayMs ?? 0, PROVIDER_REFRESH_DEBOUNCE_MS);
  pendingGatewayRefreshTimer = setTimeout(() => {
    const request = pendingGatewayRefreshRequest;
    pendingGatewayRefreshRequest = null;
    pendingGatewayRefreshTimer = null;

    if (!request?.gatewayManager) {
      return;
    }

    if (request.onlyIfRunning && request.gatewayManager.getStatus().state === 'stopped') {
      return;
    }

    logger.info(
      `[provider-runtime] Applying batched gateway ${request.mode}: ${request.message}`,
    );
    if (request.mode === 'restart') {
      request.gatewayManager.debouncedRestart();
      return;
    }
    request.gatewayManager.debouncedReload();
  }, effectiveDelayMs);
}

export async function syncProviderApiKeyToRuntime(
  providerType: string,
  providerId: string,
  apiKey: string,
): Promise<void> {
  const ock = getOpenClawProviderKey(providerType, providerId);
  await saveProviderKeyToOpenClaw(ock, apiKey);
}

export async function syncAllProviderAuthToRuntime(): Promise<void> {
  const accounts = await listProviderAccounts();

  for (const account of accounts) {
    const runtimeProviderKey = await resolveRuntimeProviderKey({
      id: account.id,
      name: account.label,
      type: account.vendorId,
      baseUrl: account.baseUrl,
      model: account.model,
      fallbackModels: account.fallbackModels,
      fallbackProviderIds: account.fallbackAccountIds,
      enabled: account.enabled,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    });

    const secret = await getProviderSecret(account.id);
    if (!secret) {
      continue;
    }

    if (secret.type === 'api_key') {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
      continue;
    }

    if (secret.type === 'local' && secret.apiKey) {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
      continue;
    }

    if (secret.type === 'oauth') {
      await saveOAuthTokenToOpenClaw(runtimeProviderKey, {
        access: secret.accessToken,
        refresh: secret.refreshToken,
        expires: secret.expiresAt,
        email: secret.email,
        projectId: secret.subject,
      });
    }
  }
}

async function syncProviderSecretToRuntime(
  config: ProviderConfig,
  runtimeProviderKey: string,
  apiKey: string | undefined,
): Promise<void> {
  const secret = await getProviderSecret(config.id);
  if (apiKey !== undefined) {
    const trimmedKey = apiKey.trim();
    if (trimmedKey) {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, trimmedKey);
    }
    return;
  }

  if (secret?.type === 'api_key') {
    await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
    return;
  }

  if (secret?.type === 'oauth') {
    await saveOAuthTokenToOpenClaw(runtimeProviderKey, {
      access: secret.accessToken,
      refresh: secret.refreshToken,
      expires: secret.expiresAt,
      email: secret.email,
      projectId: secret.subject,
    });
    return;
  }

  if (secret?.type === 'local' && secret.apiKey) {
    await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
  }
}

async function resolveRuntimeSyncContext(config: ProviderConfig): Promise<RuntimeProviderSyncContext | null> {
  const runtimeProviderKey = await resolveRuntimeProviderKey(config);
  const meta = getProviderConfig(config.type);
  const api = resolveProviderApiProtocol(
    config,
    isUnregisteredProviderType(config.type) ? 'openai-completions' : meta?.api,
    config.model,
  );
  if (!api) {
    return null;
  }

  return {
    runtimeProviderKey,
    meta,
    api,
  };
}

async function syncRuntimeProviderConfig(
  config: ProviderConfig,
  context: RuntimeProviderSyncContext,
): Promise<void> {
  const configuredModelIds = getConfiguredProviderModelIds(config);
  const override = {
    baseUrl: normalizeProviderBaseUrl(config, config.baseUrl || context.meta?.baseUrl, context.api),
    api: context.api,
    apiKeyEnv: context.meta?.apiKeyEnv,
    headers: config.headers ?? context.meta?.headers,
  };
  await syncProviderConfigToOpenClaw(context.runtimeProviderKey, configuredModelIds, override);
}

async function syncCustomProviderAgentModel(
  config: ProviderConfig,
  runtimeProviderKey: string,
  apiKey: string | undefined,
): Promise<void> {
  if (!isUnregisteredProviderType(config.type)) {
    return;
  }

  const resolvedKey = apiKey !== undefined ? (apiKey.trim() || null) : await getApiKey(config.id);
  if (!resolvedKey || !config.baseUrl) {
    return;
  }

  const modelId = config.model;
  const configuredModelIds = getConfiguredProviderModelIds(config);
  const api = resolveProviderApiProtocol(config, 'openai-completions', modelId) || 'openai-completions';
  await updateAgentModelProvider(runtimeProviderKey, {
    baseUrl: normalizeProviderBaseUrl(config, config.baseUrl, api),
    api,
    models: configuredModelIds.map((id) => ({ id, name: id })),
    apiKey: resolvedKey,
  });
}

async function syncProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
): Promise<RuntimeProviderSyncContext | null> {
  const context = await resolveRuntimeSyncContext(config);
  if (!context) {
    return null;
  }

  await syncProviderSecretToRuntime(config, context.runtimeProviderKey, apiKey);
  await syncRuntimeProviderConfig(config, context);
  await syncCustomProviderAgentModel(config, context.runtimeProviderKey, apiKey);
  return context;
}

async function removeDeletedProviderFromOpenClaw(
  provider: ProviderConfig,
  providerId: string,
  runtimeProviderKey?: string,
): Promise<void> {
  const keys = new Set<string>();
  if (runtimeProviderKey) {
    keys.add(runtimeProviderKey);
  } else {
    keys.add(await resolveRuntimeProviderKey({ ...provider, id: providerId }));
  }
  keys.add(providerId);
  for (const alias of getProviderDeletionAliases(provider)) {
    keys.add(alias);
  }

  for (const key of keys) {
    await removeProviderFromOpenClaw(key);
  }
}

function parseModelRef(modelRef: string): { providerKey: string; modelId: string } | null {
  const trimmed = modelRef.trim();
  const separatorIndex = trimmed.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return null;
  }

  return {
    providerKey: trimmed.slice(0, separatorIndex),
    modelId: trimmed.slice(separatorIndex + 1),
  };
}

async function buildRuntimeProviderConfigMap(): Promise<Map<string, ProviderConfig>> {
  const configs = await getAllProviders();
  const runtimeMap = new Map<string, ProviderConfig>();

  for (const config of configs) {
    const runtimeKey = await resolveRuntimeProviderKey(config);
    runtimeMap.set(runtimeKey, config);
  }

  return runtimeMap;
}

async function buildAgentModelProviderEntry(
  config: ProviderConfig,
  modelId: string,
): Promise<{
  baseUrl?: string;
  api?: string;
  models?: Array<{ id: string; name: string }>;
  apiKey?: string;
  authHeader?: boolean;
} | null> {
  const meta = getProviderConfig(config.type);
  const api = resolveProviderApiProtocol(
    config,
    isUnregisteredProviderType(config.type) ? 'openai-completions' : meta?.api,
    modelId,
  );
  const baseUrl = normalizeProviderBaseUrl(config, config.baseUrl || meta?.baseUrl, api);
  if (!api || !baseUrl) {
    return null;
  }

  let apiKey: string | undefined;
  let authHeader: boolean | undefined;

  if (isUnregisteredProviderType(config.type)) {
    apiKey = (await getApiKey(config.id)) || undefined;
  } else if (config.type === 'minimax-portal' || config.type === 'minimax-portal-cn') {
    const accountApiKey = await getApiKey(config.id);
    if (accountApiKey) {
      apiKey = accountApiKey;
    } else {
      authHeader = true;
      apiKey = 'minimax-oauth';
    }
  }

  return {
    baseUrl,
    api,
    models: [{ id: modelId, name: modelId }],
    apiKey,
    authHeader,
  };
}

async function syncAgentModelsToRuntime(agentIds?: Set<string>): Promise<void> {
  const snapshot = await listAgentsSnapshot();
  const runtimeProviderConfigs = await buildRuntimeProviderConfigMap();

  const targets = snapshot.agents.filter((agent) => {
    if (!agent.modelRef) return false;
    if (!agentIds) return true;
    return agentIds.has(agent.id);
  });

  for (const agent of targets) {
    const parsed = parseModelRef(agent.modelRef || '');
    if (!parsed) {
      continue;
    }

    const providerConfig = runtimeProviderConfigs.get(parsed.providerKey);
    if (!providerConfig) {
      logger.warn(
        `[provider-runtime] No provider account mapped to runtime key "${parsed.providerKey}" for agent "${agent.id}"`,
      );
      continue;
    }

    const entry = await buildAgentModelProviderEntry(providerConfig, parsed.modelId);
    if (!entry) {
      continue;
    }

    await updateSingleAgentModelProvider(agent.id, parsed.providerKey, entry);
  }
}

export async function syncAgentModelOverrideToRuntime(agentId: string): Promise<void> {
  await syncAgentModelsToRuntime(new Set([agentId]));
}

export async function syncSavedProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const context = await syncProviderToRuntime(config, apiKey);
  if (!context) {
    return;
  }

  try {
    await syncAgentModelsToRuntime();
  } catch (err) {
    logger.warn('[provider-runtime] Failed to sync per-agent model registries after provider save:', err);
  }

  scheduleGatewayRefresh(
    gatewayManager,
    `Scheduling Gateway reload after saving provider "${context.runtimeProviderKey}" config`,
  );
}

export async function syncUpdatedProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const context = await syncProviderToRuntime(config, apiKey);
  if (!context) {
    return;
  }

  const ock = context.runtimeProviderKey;
  const fallbackModels = await getProviderFallbackModelRefs(config);

  const defaultProviderId = await getDefaultProvider();
  if (defaultProviderId === config.id) {
    const modelOverride = config.model ? `${ock}/${config.model}` : undefined;
    if (!isUnregisteredProviderType(config.type)) {
      if (shouldUseExplicitDefaultOverride(config, ock)) {
        await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
          baseUrl: normalizeProviderBaseUrl(config, config.baseUrl || context.meta?.baseUrl, context.api),
          api: context.api,
          apiKeyEnv: context.meta?.apiKeyEnv,
          headers: config.headers ?? context.meta?.headers,
        }, fallbackModels);
      } else {
        await setOpenClawDefaultModel(ock, modelOverride, fallbackModels);
      }
    } else {
      const api = resolveProviderApiProtocol(config, 'openai-completions', config.model) || 'openai-completions';
      await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
        baseUrl: normalizeProviderBaseUrl(config, config.baseUrl, api),
        api,
        headers: config.headers,
      }, fallbackModels);
    }
  }

  try {
    await syncAgentModelsToRuntime();
  } catch (err) {
    logger.warn('[provider-runtime] Failed to sync per-agent model registries after provider update:', err);
  }

  scheduleGatewayRefresh(
    gatewayManager,
    `Scheduling Gateway reload after updating provider "${ock}" config`,
  );
}

export async function syncDeletedProviderToRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  gatewayManager?: GatewayManager,
  runtimeProviderKey?: string,
): Promise<void> {
  if (!provider?.type) {
    return;
  }

  const ock = runtimeProviderKey ?? await resolveRuntimeProviderKey({ ...provider, id: providerId });
  await removeDeletedProviderFromOpenClaw(provider, providerId, ock);

  scheduleGatewayRefresh(
    gatewayManager,
    `Scheduling Gateway restart after deleting provider "${ock}"`,
    { mode: 'restart' },
  );
}

export async function syncDeletedProviderApiKeyToRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  runtimeProviderKey?: string,
): Promise<void> {
  if (!provider?.type) {
    return;
  }

  const ock = runtimeProviderKey ?? await resolveRuntimeProviderKey({ ...provider, id: providerId });
  await removeProviderKeyFromOpenClaw(ock);
}

export async function syncDefaultProviderToRuntime(
  providerId: string,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const provider = await getProvider(providerId);
  if (!provider) {
    return;
  }

  const ock = await resolveRuntimeProviderKey(provider);
  const providerKey = await getApiKey(providerId);
  const fallbackModels = await getProviderFallbackModelRefs(provider);
  const oauthTypes = ['minimax-portal', 'minimax-portal-cn'];
  const browserOAuthRuntimeProvider = await getBrowserOAuthRuntimeProvider(provider);
  const isOAuthProvider = (oauthTypes.includes(provider.type) && !providerKey) || Boolean(browserOAuthRuntimeProvider);

  if (!isOAuthProvider) {
    const modelOverride = provider.model
      ? (provider.model.startsWith(`${ock}/`) ? provider.model : `${ock}/${provider.model}`)
      : undefined;

    if (isUnregisteredProviderType(provider.type)) {
      const api = resolveProviderApiProtocol(provider, 'openai-completions', provider.model) || 'openai-completions';
      await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
        baseUrl: normalizeProviderBaseUrl(provider, provider.baseUrl, api),
        api,
        headers: provider.headers,
      }, fallbackModels);
    } else if (shouldUseExplicitDefaultOverride(provider, ock)) {
      await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
        baseUrl: normalizeProviderBaseUrl(
          provider,
          provider.baseUrl || getProviderConfig(provider.type)?.baseUrl,
          resolveProviderApiProtocol(provider, getProviderConfig(provider.type)?.api, provider.model),
        ),
        api: resolveProviderApiProtocol(provider, getProviderConfig(provider.type)?.api, provider.model),
        apiKeyEnv: getProviderConfig(provider.type)?.apiKeyEnv,
        headers: provider.headers ?? getProviderConfig(provider.type)?.headers,
      }, fallbackModels);
    } else {
      await setOpenClawDefaultModel(ock, modelOverride, fallbackModels);
    }

    if (providerKey) {
      await saveProviderKeyToOpenClaw(ock, providerKey);
    }

    const context = await resolveRuntimeSyncContext(provider);
    if (context) {
      await syncRuntimeProviderConfig(provider, context);
    }
  } else {
    if (browserOAuthRuntimeProvider) {
      const secret = await getProviderSecret(provider.id);
      if (secret?.type === 'oauth') {
        await saveOAuthTokenToOpenClaw(browserOAuthRuntimeProvider, {
          access: secret.accessToken,
          refresh: secret.refreshToken,
          expires: secret.expiresAt,
          email: secret.email,
          projectId: secret.subject,
        });
      }

      const defaultModelRef = browserOAuthRuntimeProvider === GOOGLE_OAUTH_RUNTIME_PROVIDER
        ? GOOGLE_OAUTH_DEFAULT_MODEL_REF
        : OPENAI_OAUTH_DEFAULT_MODEL_REF;
      const modelOverride = provider.model
        ? (provider.model.startsWith(`${browserOAuthRuntimeProvider}/`)
          ? provider.model
          : `${browserOAuthRuntimeProvider}/${provider.model}`)
        : defaultModelRef;

      await setOpenClawDefaultModel(browserOAuthRuntimeProvider, modelOverride, fallbackModels);
      logger.info(`Configured openclaw.json for browser OAuth provider "${provider.id}"`);
      try {
        await syncAgentModelsToRuntime();
      } catch (err) {
        logger.warn('[provider-runtime] Failed to sync per-agent model registries after browser OAuth switch:', err);
      }
      scheduleGatewayRefresh(
        gatewayManager,
        `Scheduling Gateway reload after provider switch to "${browserOAuthRuntimeProvider}"`,
      );
      return;
    }

    const defaultBaseUrl = provider.type === 'minimax-portal'
      ? 'https://api.minimax.io/anthropic'
      : 'https://api.minimaxi.com/anthropic';
    const api = 'anthropic-messages' as const;

    let baseUrl = provider.baseUrl || defaultBaseUrl;
    if (baseUrl) {
      baseUrl = baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
    }

    const targetProviderKey = 'minimax-portal';

    await setOpenClawDefaultModelWithOverride(targetProviderKey, getProviderModelRef(provider), {
      baseUrl,
      api,
      authHeader: targetProviderKey === 'minimax-portal' ? true : undefined,
      apiKeyEnv: targetProviderKey === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
    }, fallbackModels);

    logger.info(`Configured openclaw.json for OAuth provider "${provider.type}"`);

    try {
      const defaultModelId = provider.model?.split('/').pop();
      await updateAgentModelProvider(targetProviderKey, {
        baseUrl,
        api,
        authHeader: targetProviderKey === 'minimax-portal' ? true : undefined,
        apiKey: targetProviderKey === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
        models: defaultModelId ? [{ id: defaultModelId, name: defaultModelId }] : [],
      });
    } catch (err) {
      logger.warn(`Failed to update models.json for OAuth provider "${targetProviderKey}":`, err);
    }
  }

  if (
    isUnregisteredProviderType(provider.type) &&
    providerKey &&
    provider.baseUrl
  ) {
    const configuredModelIds = getConfiguredProviderModelIds(provider);
    const api = resolveProviderApiProtocol(provider, 'openai-completions', provider.model) || 'openai-completions';
    await updateAgentModelProvider(ock, {
      baseUrl: normalizeProviderBaseUrl(provider, provider.baseUrl, api),
      api,
      models: configuredModelIds.map((id) => ({ id, name: id })),
      apiKey: providerKey,
    });
  }

  try {
    await syncAgentModelsToRuntime();
  } catch (err) {
    logger.warn('[provider-runtime] Failed to sync per-agent model registries after default provider switch:', err);
  }

  scheduleGatewayRefresh(
    gatewayManager,
    `Scheduling Gateway reload after provider switch to "${ock}"`,
    { onlyIfRunning: true },
  );
}
