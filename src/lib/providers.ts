/**
 * Provider Types & UI Metadata — single source of truth for the frontend.
 *
 * NOTE: Backend provider metadata is being refactored toward the new
 * account-based registry, but the renderer still keeps a local compatibility
 * layer so TypeScript project boundaries remain stable during the migration.
 */

export const PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'bigmodel',
  'openrouter',
  'ark',
  'moonshot',
  'siliconflow',
  'deepseek',
  'minimax-portal',
  'minimax-portal-cn',
  'modelstudio',
  'ollama',
  'custom',
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const BUILTIN_PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'bigmodel',
  'openrouter',
  'ark',
  'moonshot',
  'siliconflow',
  'deepseek',
  'minimax-portal',
  'minimax-portal-cn',
  'modelstudio',
  'ollama',
] as const;

export const OLLAMA_PLACEHOLDER_API_KEY = 'ollama-local';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  headers?: Record<string, string>;
  model?: string;
  fallbackModels?: string[];
  fallbackProviderIds?: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderWithKeyInfo extends ProviderConfig {
  hasKey: boolean;
  keyMasked: string | null;
}

export interface ProviderTypeInfo {
  id: ProviderType;
  name: string;
  icon: string;
  placeholder: string;
  model?: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  showBaseUrl?: boolean;
  showModelId?: boolean;
  showModelIdInDevModeOnly?: boolean;
  modelIdPlaceholder?: string;
  defaultModelId?: string;
  isOAuth?: boolean;
  supportsApiKey?: boolean;
  apiKeyUrl?: string;
  docsUrl?: string;
  docsUrlZh?: string;
  codePlanPresetBaseUrl?: string;
  codePlanPresetModelId?: string;
  codePlanDocsUrl?: string;
  /** If true, this provider is not shown in the "Add Provider" dialog. */
  hidden?: boolean;
}

export interface ProviderBackendConfig {
  baseUrl: string;
  api: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  apiKeyEnv?: string;
  models?: Array<Record<string, unknown>>;
  headers?: Record<string, string>;
}

export type ProviderAuthMode =
  | 'api_key'
  | 'oauth_device'
  | 'oauth_browser'
  | 'local';

export type ProviderVendorCategory =
  | 'official'
  | 'compatible'
  | 'local'
  | 'custom';

export interface ProviderVendorInfo extends ProviderTypeInfo {
  category: ProviderVendorCategory;
  envVar?: string;
  providerConfig?: ProviderBackendConfig;
  supportedAuthModes: ProviderAuthMode[];
  defaultAuthMode: ProviderAuthMode;
  supportsMultipleAccounts: boolean;
}

export interface ProviderModelOption {
  value: string;
  label: string;
}

export interface ProviderAccount {
  id: string;
  vendorId: ProviderType;
  label: string;
  authMode: ProviderAuthMode;
  baseUrl?: string;
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  headers?: Record<string, string>;
  model?: string;
  fallbackModels?: string[];
  fallbackAccountIds?: string[];
  enabled: boolean;
  isDefault: boolean;
  metadata?: {
    region?: string;
    email?: string;
    resourceUrl?: string;
    customModels?: string[];
    modelProtocols?: Record<string, 'openai-completions' | 'openai-responses' | 'anthropic-messages'>;
    modelUsageTags?: Record<string, string[]>;
  };
  createdAt: string;
  updatedAt: string;
}

import { providerIcons } from '@/assets/providers';

/** All supported provider types with UI metadata */
export const PROVIDER_TYPE_INFO: ProviderTypeInfo[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '🤖',
    placeholder: 'sk-ant-api03-...',
    model: 'Claude',
    requiresApiKey: true,
    docsUrl: 'https://platform.claude.com/docs/en/api/overview',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '💚',
    placeholder: 'sk-proj-...',
    model: 'GPT',
    requiresApiKey: true,
    isOAuth: true,
    supportsApiKey: true,
    defaultModelId: 'gpt-5.4',
    showModelId: true,
    showModelIdInDevModeOnly: true,
    modelIdPlaceholder: 'gpt-5.4',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'google',
    name: 'Google',
    icon: '🔷',
    placeholder: 'AIza...',
    model: 'Gemini',
    requiresApiKey: true,
    isOAuth: true,
    supportsApiKey: true,
    defaultModelId: 'gemini-3-pro-preview',
    showModelId: true,
    showModelIdInDevModeOnly: true,
    modelIdPlaceholder: 'gemini-3-pro-preview',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'bigmodel',
    name: 'Zhipu AI',
    icon: '智',
    placeholder: 'your-bigmodel-api-key',
    model: 'GLM',
    requiresApiKey: true,
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    showBaseUrl: true,
    showModelId: true,
    modelIdPlaceholder: 'glm-5-turbo',
    defaultModelId: 'glm-5-turbo',
    docsUrl: 'https://docs.bigmodel.cn/cn/api/introduction',
  },
  { id: 'openrouter', name: 'OpenRouter', icon: '🌐', placeholder: 'sk-or-v1-...', model: 'Multi-Model', requiresApiKey: true, showModelId: true, modelIdPlaceholder: 'openai/gpt-5.4', defaultModelId: 'openai/gpt-5.4', docsUrl: 'https://openrouter.ai/models' },
  { id: 'minimax-portal-cn', name: 'MiniMax (CN)', icon: '☁️', placeholder: 'sk-...', model: 'MiniMax', requiresApiKey: false, isOAuth: true, supportsApiKey: true, defaultModelId: 'MiniMax-M2.7', showModelId: true, showModelIdInDevModeOnly: true, modelIdPlaceholder: 'MiniMax-M2.7', apiKeyUrl: 'https://platform.minimaxi.com/' },
  { id: 'moonshot', name: 'Moonshot (CN)', icon: '🌙', placeholder: 'sk-...', model: 'Kimi', requiresApiKey: true, defaultBaseUrl: 'https://api.moonshot.cn/v1', defaultModelId: 'kimi-k2.5', docsUrl: 'https://platform.moonshot.cn/' },
  { id: 'siliconflow', name: 'SiliconFlow (CN)', icon: '🌊', placeholder: 'sk-...', model: 'Multi-Model', requiresApiKey: true, defaultBaseUrl: 'https://api.siliconflow.cn/v1', showModelId: true, showModelIdInDevModeOnly: true, modelIdPlaceholder: 'deepseek-ai/DeepSeek-V3', defaultModelId: 'deepseek-ai/DeepSeek-V3', docsUrl: 'https://docs.siliconflow.cn/cn/userguide/introduction' },
  { id: 'deepseek', name: 'DeepSeek', icon: 'D', placeholder: 'sk-...', model: 'DeepSeek', requiresApiKey: true, defaultBaseUrl: 'https://api.deepseek.com', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'deepseek-v4-pro', defaultModelId: 'deepseek-v4-pro', docsUrl: 'https://api-docs.deepseek.com/', docsUrlZh: 'https://api-docs.deepseek.com/zh-cn/' },
  { id: 'minimax-portal', name: 'MiniMax (Global)', icon: '☁️', placeholder: 'sk-...', model: 'MiniMax', requiresApiKey: false, isOAuth: true, supportsApiKey: true, defaultModelId: 'MiniMax-M2.7', showModelId: true, showModelIdInDevModeOnly: true, modelIdPlaceholder: 'MiniMax-M2.7', apiKeyUrl: 'https://platform.minimax.io' },
  { id: 'modelstudio', name: 'Model Studio', icon: '☁️', placeholder: 'sk-...', model: 'Qwen', requiresApiKey: true, defaultBaseUrl: 'https://coding.dashscope.aliyuncs.com/v1', showBaseUrl: true, defaultModelId: 'qwen3.5-plus', showModelId: true, showModelIdInDevModeOnly: true, modelIdPlaceholder: 'qwen3.5-plus', apiKeyUrl: 'https://bailian.console.aliyun.com/', hidden: true },
  { id: 'ark', name: 'ByteDance Ark', icon: 'A', placeholder: 'your-ark-api-key', model: 'Doubao', requiresApiKey: true, defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'ep-20260228000000-xxxxx', docsUrl: 'https://www.volcengine.com/', codePlanPresetBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3', codePlanPresetModelId: 'ark-code-latest', codePlanDocsUrl: 'https://www.volcengine.com/docs/82379/1928261?lang=zh' },
  { id: 'ollama', name: 'Ollama', icon: '🦙', placeholder: 'Not required', requiresApiKey: false, defaultBaseUrl: 'http://localhost:11434/v1', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'qwen3:latest' },
  {
    id: 'custom',
    name: 'Custom',
    icon: '⚙️',
    placeholder: 'API key...',
    requiresApiKey: true,
    showBaseUrl: true,
    showModelId: true,
    modelIdPlaceholder: 'your-provider/model-id',
    docsUrl: 'https://docs.qq.com/aio/p/scchzbdpjgz9ho4?p=5mPH8jZ09MQrPfAQhQhzUD',
    docsUrlZh: 'https://docs.qq.com/aio/p/scchzbdpjgz9ho4?p=5mPH8jZ09MQrPfAQhQhzUD',
  },
];

const PROVIDER_MODEL_OPTIONS: Record<string, ProviderModelOption[]> = {
  anthropic: [
    { value: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
    { value: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  ],
  openai: [
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  ],
  google: [
    { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
    { value: 'gemini-3-flash', label: 'Gemini 3 Flash' },
  ],
  openrouter: [
    { value: 'openai/gpt-5.4', label: 'OpenAI / GPT-5.4' },
    { value: 'anthropic/claude-opus-4.6', label: 'Anthropic / Claude Opus 4.6' },
    { value: 'google/gemini-3-pro-preview', label: 'Google / Gemini 3 Pro Preview' },
  ],
  minimax: [
    { value: 'MiniMax-M2.7', label: 'MiniMax M2.7' },
  ],
  moonshot: [
    { value: 'kimi-k2.5', label: 'Kimi K2.5' },
    { value: 'kimi-k2-turbo-preview', label: 'Kimi K2 Turbo Preview' },
  ],
  siliconflow: [
    { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' },
    { value: 'Qwen/Qwen3-Coder-480B-A35B-Instruct', label: 'Qwen3 Coder 480B' },
  ],
  qwen: [
    { value: 'qwen3.5-plus', label: 'Qwen 3.5 Plus' },
    { value: 'qwen-plus', label: 'Qwen Plus' },
    { value: 'qwen-max', label: 'Qwen Max' },
    { value: 'qwen-turbo', label: 'Qwen Turbo' },
  ],
  zai: [
    { value: 'glm-5', label: 'GLM-5' },
    { value: 'glm-4.5', label: 'GLM-4.5' },
    { value: 'glm-4.5-air', label: 'GLM-4.5 Air' },
  ],
  deepseek: [
    { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  ],
  ark: [
    { value: 'ark-code-latest', label: 'Ark Code Latest' },
  ],
  ollama: [
    { value: 'qwen3:latest', label: 'Qwen3 Latest' },
    { value: 'deepseek-r1:latest', label: 'DeepSeek R1 Latest' },
    { value: 'llama3.3:latest', label: 'Llama 3.3 Latest' },
  ],
};

function inferModelCatalogKey(
  providerType: ProviderType | string,
  options?: {
    baseUrl?: string;
    apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  },
): string {
  const rawBaseUrl = (options?.baseUrl || '').toLowerCase();

  if (providerType === 'minimax-portal' || providerType === 'minimax-portal-cn') {
    return 'minimax';
  }
  if (providerType === 'modelstudio') {
    return 'qwen';
  }
  if (providerType === 'custom') {
    if (rawBaseUrl.includes('dashscope.aliyuncs.com') || rawBaseUrl.includes('qwen.ai')) {
      return 'qwen';
    }
    if (rawBaseUrl.includes('bigmodel.cn') || rawBaseUrl.includes('open.bigmodel.cn') || rawBaseUrl.includes('z.ai')) {
      return 'zai';
    }
    if (rawBaseUrl.includes('deepseek.com')) {
      return 'deepseek';
    }
    if (rawBaseUrl.includes('moonshot.cn')) {
      return 'moonshot';
    }
    if (rawBaseUrl.includes('siliconflow.cn')) {
      return 'siliconflow';
    }
    if (rawBaseUrl.includes('openrouter.ai')) {
      return 'openrouter';
    }
    if (rawBaseUrl.includes('api.openai.com') || options?.apiProtocol === 'openai-responses') {
      return 'openai';
    }
    if (rawBaseUrl.includes('anthropic.com') || options?.apiProtocol === 'anthropic-messages') {
      return 'anthropic';
    }
  }
  return providerType;
}

export function getRecommendedModelOptions(
  providerType: ProviderType | string,
  options?: {
    baseUrl?: string;
    apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  },
): ProviderModelOption[] {
  const key = inferModelCatalogKey(providerType, options);
  return PROVIDER_MODEL_OPTIONS[key] ?? [];
}

/** Get the SVG logo URL for a provider type, falls back to undefined */
export function getProviderIconUrl(type: ProviderType | string): string | undefined {
  return providerIcons[type];
}

/** Whether a provider's logo needs CSS invert in dark mode (all logos are monochrome) */
export function shouldInvertInDark(_type: ProviderType | string): boolean {
  return true;
}

/** Provider list shown in the Setup wizard */
export const SETUP_PROVIDERS = PROVIDER_TYPE_INFO;

/** Get type info by provider type id */
export function getProviderTypeInfo(type: ProviderType): ProviderTypeInfo | undefined {
  return PROVIDER_TYPE_INFO.find((t) => t.id === type);
}

export function getProviderDocsUrl(
  provider: Pick<ProviderTypeInfo, 'docsUrl' | 'docsUrlZh'> | undefined,
  language: string
): string | undefined {
  if (!provider?.docsUrl) {
    return undefined;
  }

  if (language.startsWith('zh') && provider.docsUrlZh) {
    return provider.docsUrlZh;
  }

  return provider.docsUrl;
}

export function shouldShowProviderModelId(
  provider: Pick<ProviderTypeInfo, 'showModelId' | 'showModelIdInDevModeOnly'> | undefined,
  devModeUnlocked: boolean
): boolean {
  if (!provider?.showModelId) return false;
  if (provider.showModelIdInDevModeOnly && !devModeUnlocked) return false;
  return true;
}

export function resolveProviderModelForSave(
  provider: Pick<ProviderTypeInfo, 'defaultModelId' | 'showModelId' | 'showModelIdInDevModeOnly'> | undefined,
  modelId: string,
  _devModeUnlocked: boolean
): string | undefined {
  const trimmedModelId = modelId.trim();
  return trimmedModelId || provider?.defaultModelId || undefined;
}

/** Normalize provider API key before saving; Ollama uses a local placeholder when blank. */
export function resolveProviderApiKeyForSave(type: ProviderType | string, apiKey: string): string | undefined {
  const trimmed = apiKey.trim();
  if (type === 'ollama') {
    return trimmed || OLLAMA_PLACEHOLDER_API_KEY;
  }
  return trimmed || undefined;
}
