import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { getProviderConfig } from '../../utils/provider-registry';

type ValidationProfile =
  | 'openai-completions'
  | 'openai-responses'
  | 'google-query-key'
  | 'anthropic-header'
  | 'openrouter'
  | 'none';

type ValidationResult = { valid: boolean; error?: string; status?: number };
export type ProviderConnectionTestResult = {
  valid: boolean;
  error?: string;
  status?: number;
  model?: string;
  output?: string;
  latencyMs?: number;
};

function logValidationStatus(provider: string, status: number): void {
  console.log(`[clawx-validate] ${provider} HTTP ${status}`);
}

function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return `${secret.slice(0, 2)}***`;
  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

function sanitizeValidationUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const key = url.searchParams.get('key');
    if (key) url.searchParams.set('key', maskSecret(key));
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const next = { ...headers };
  if (next.Authorization?.startsWith('Bearer ')) {
    const token = next.Authorization.slice('Bearer '.length);
    next.Authorization = `Bearer ${maskSecret(token)}`;
  }
  if (next['x-api-key']) {
    next['x-api-key'] = maskSecret(next['x-api-key']);
  }
  return next;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildOpenAiModelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models?limit=1`;
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function getRedirectError(response: Response): string {
  const location = response.headers.get('location');
  return location
    ? `Connection test was redirected to ${location}. Check that the Base URL points to a model API endpoint.`
    : 'Connection test was redirected. Check that the Base URL points to a model API endpoint.';
}

function isJsonContentType(response: Response): boolean {
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  return contentType.includes('application/json') || contentType.includes('+json');
}

function resolveOpenAiProbeUrls(
  baseUrl: string,
  apiProtocol: 'openai-completions' | 'openai-responses',
): { modelsUrl: string; probeUrl: string } {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const endpointSuffixPattern = /(\/responses?|\/chat\/completions)$/;
  const rootBase = normalizedBase.replace(endpointSuffixPattern, '');
  const modelsUrl = buildOpenAiModelsUrl(rootBase);

  if (apiProtocol === 'openai-responses') {
    const probeUrl = /(\/responses?)$/.test(normalizedBase)
      ? normalizedBase
      : `${rootBase}/responses`;
    return { modelsUrl, probeUrl };
  }

  const probeUrl = /\/chat\/completions$/.test(normalizedBase)
    ? normalizedBase
    : `${rootBase}/chat/completions`;
  return { modelsUrl, probeUrl };
}

function logValidationRequest(
  provider: string,
  method: string,
  url: string,
  headers: Record<string, string>,
): void {
  console.log(
    `[clawx-validate] ${provider} request ${method} ${sanitizeValidationUrl(url)} headers=${JSON.stringify(sanitizeHeaders(headers))}`,
  );
}

function getValidationProfile(
  providerType: string,
  options?: { apiProtocol?: string }
): ValidationProfile {
  const providerApi = options?.apiProtocol || getProviderConfig(providerType)?.api;
  if (providerApi === 'anthropic-messages') {
    return 'anthropic-header';
  }
  if (providerApi === 'openai-responses') {
    return 'openai-responses';
  }
  if (providerApi === 'openai-completions') {
    return 'openai-completions';
  }

  switch (providerType) {
    case 'anthropic':
      return 'anthropic-header';
    case 'google':
      return 'google-query-key';
    case 'openrouter':
      return 'openrouter';
    case 'ollama':
      return 'none';
    default:
      return 'openai-completions';
  }
}

async function performProviderValidationRequest(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
): Promise<ValidationResult> {
  try {
    logValidationRequest(providerLabel, 'GET', url, headers);
    const response = await proxyAwareFetch(url, { headers, redirect: 'manual' });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));
    const result = classifyAuthResponse(response.status, data);
    return { ...result, status: response.status };
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function classifyAuthResponse(
  status: number,
  data: unknown,
): { valid: boolean; error?: string } {
  if (status >= 200 && status < 300) return { valid: true };
  if (status === 429) return { valid: true };
  if (status === 401 || status === 403) return { valid: false, error: 'Invalid API key' };

  const obj = data as { error?: { message?: string }; message?: string } | null;
  const msg = obj?.error?.message || obj?.message || `API error: ${status}`;
  return { valid: false, error: msg };
}

function extractOpenAiMessageText(payload: unknown): string | undefined {
  const record = payload as Record<string, unknown> | null;
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const message = choices[0] && typeof choices[0] === 'object'
    ? (choices[0] as Record<string, unknown>).message as Record<string, unknown> | undefined
    : undefined;
  const content = message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const text = content
      .map((item) => (typeof item === 'object' && item && typeof (item as Record<string, unknown>).text === 'string')
        ? (item as Record<string, unknown>).text as string
        : '')
      .filter(Boolean)
      .join('\n')
      .trim();
    return text || undefined;
  }
  return undefined;
}

function extractResponsesText(payload: unknown): string | undefined {
  const record = payload as Record<string, unknown> | null;
  if (typeof record?.output_text === 'string' && record.output_text.trim()) {
    return record.output_text.trim();
  }

  const output = Array.isArray(record?.output) ? record.output : [];
  const text = output.flatMap((item) => {
    if (typeof item !== 'object' || !item) return [];
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) return [];
    return content.map((part) => (
      typeof part === 'object' && part && typeof (part as Record<string, unknown>).text === 'string'
        ? (part as Record<string, unknown>).text as string
        : ''
    ));
  }).filter(Boolean).join('\n').trim();
  return text || undefined;
}

function extractAnthropicText(payload: unknown): string | undefined {
  const record = payload as Record<string, unknown> | null;
  const content = Array.isArray(record?.content) ? record.content : [];
  const text = content
    .map((item) => (
      typeof item === 'object' && item && typeof (item as Record<string, unknown>).text === 'string'
        ? (item as Record<string, unknown>).text as string
        : ''
    ))
    .filter(Boolean)
    .join('\n')
    .trim();
  return text || undefined;
}

async function performConnectionTestRequest(
  providerLabel: string,
  url: string,
  init: RequestInit,
  extractOutput: (payload: unknown) => string | undefined,
  model: string,
): Promise<ProviderConnectionTestResult> {
  const startedAt = Date.now();
  try {
    logValidationRequest(providerLabel, init.method || 'POST', url, (init.headers as Record<string, string>) || {});
    const response = await proxyAwareFetch(url, { ...init, redirect: 'manual' });
    logValidationStatus(providerLabel, response.status);
    if (response.redirected || isRedirectStatus(response.status)) {
      return {
        valid: false,
        error: response.redirected && response.url
          ? `Connection test was redirected to ${response.url}. Check that the Base URL points to a model API endpoint.`
          : getRedirectError(response),
        status: response.status,
        model,
        latencyMs: Date.now() - startedAt,
      };
    }

    if (!isJsonContentType(response)) {
      const contentType = response.headers.get('content-type') || 'unknown content type';
      return {
        valid: false,
        error: `Provider returned ${contentType}, not JSON. Check that the Base URL points to an OpenAI-compatible API endpoint.`,
        status: response.status,
        model,
        latencyMs: Date.now() - startedAt,
      };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return {
        valid: false,
        error: 'Provider returned invalid JSON. Check the Base URL and API protocol.',
        status: response.status,
        model,
        latencyMs: Date.now() - startedAt,
      };
    }
    if (response.status < 200 || response.status >= 300) {
      if (response.status === 429) {
        return {
          valid: false,
          error: 'Provider rate limited the test request. Check quota, limits, or try again later.',
          status: response.status,
          model,
          latencyMs: Date.now() - startedAt,
        };
      }

      return {
        ...classifyAuthResponse(response.status, data),
        status: response.status,
        model,
        latencyMs: Date.now() - startedAt,
      };
    }

    const output = extractOutput(data);
    if (!output) {
      return {
        valid: false,
        error: 'Provider response did not match the selected API protocol. Check the Base URL, protocol, and model.',
        status: response.status,
        model,
        latencyMs: Date.now() - startedAt,
      };
    }

    return {
      valid: true,
      status: response.status,
      model,
      output: extractOutput(data) || '连接成功',
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
      model,
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function validateOpenAiCompatibleKey(
  providerType: string,
  apiKey: string,
  apiProtocol: 'openai-completions' | 'openai-responses',
  baseUrl?: string,
): Promise<ValidationResult> {
  const trimmedBaseUrl = baseUrl?.trim();
  if (!trimmedBaseUrl) {
    return { valid: false, error: `Base URL is required for provider "${providerType}" validation` };
  }

  const headers = { Authorization: `Bearer ${apiKey}` };
  const { modelsUrl, probeUrl } = resolveOpenAiProbeUrls(trimmedBaseUrl, apiProtocol);
  const modelsResult = await performProviderValidationRequest(providerType, modelsUrl, headers);

  if (modelsResult.status === 404) {
    console.log(
      `[clawx-validate] ${providerType} /models returned 404, falling back to ${apiProtocol} probe`,
    );
    if (apiProtocol === 'openai-responses') {
      return await performResponsesProbe(providerType, probeUrl, headers);
    }
    return await performChatCompletionsProbe(providerType, probeUrl, headers);
  }

  return modelsResult;
}

async function performResponsesProbe(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
): Promise<ValidationResult> {
  try {
    logValidationRequest(providerLabel, 'POST', url, headers);
    const response = await proxyAwareFetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-probe',
        input: 'hi',
      }),
    });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key' };
    }
    if (
      (response.status >= 200 && response.status < 300) ||
      response.status === 400 ||
      response.status === 429
    ) {
      return { valid: true };
    }
    return classifyAuthResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function performChatCompletionsProbe(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
): Promise<ValidationResult> {
  try {
    logValidationRequest(providerLabel, 'POST', url, headers);
    const response = await proxyAwareFetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-probe',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key' };
    }
    if (
      (response.status >= 200 && response.status < 300) ||
      response.status === 400 ||
      response.status === 429
    ) {
      return { valid: true };
    }
    return classifyAuthResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function performAnthropicMessagesProbe(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
): Promise<ValidationResult> {
  try {
    logValidationRequest(providerLabel, 'POST', url, headers);
    const response = await proxyAwareFetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-probe',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key' };
    }
    if (
      (response.status >= 200 && response.status < 300) ||
      response.status === 400 ||
      response.status === 429
    ) {
      return { valid: true };
    }
    return classifyAuthResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function validateGoogleQueryKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string,
): Promise<ValidationResult> {
  const base = normalizeBaseUrl(baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
  const url = `${base}/models?pageSize=1&key=${encodeURIComponent(apiKey)}`;
  return await performProviderValidationRequest(providerType, url, {});
}

async function validateAnthropicHeaderKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string,
): Promise<ValidationResult> {
  const rawBase = normalizeBaseUrl(baseUrl || 'https://api.anthropic.com/v1');
  const base = rawBase.endsWith('/v1') ? rawBase : `${rawBase}/v1`;
  const url = `${base}/models?limit=1`;
  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  const modelsResult = await performProviderValidationRequest(providerType, url, headers);

  // If the endpoint doesn't implement /models (like Minimax Anthropic compatibility), fallback to a /messages probe.
  if (
    modelsResult.status === 404 ||
    modelsResult.status === 400 ||
    modelsResult.error?.includes('API error: 404') ||
    modelsResult.error?.includes('API error: 400')
  ) {
    console.log(
      `[clawx-validate] ${providerType} /models returned error, falling back to /messages probe`,
    );
    const messagesUrl = `${base}/messages`;
    return await performAnthropicMessagesProbe(providerType, messagesUrl, headers);
  }

  return modelsResult;
}

async function validateOpenRouterKey(
  providerType: string,
  apiKey: string,
): Promise<ValidationResult> {
  const url = 'https://openrouter.ai/api/v1/auth/key';
  const headers = { Authorization: `Bearer ${apiKey}` };
  return await performProviderValidationRequest(providerType, url, headers);
}

export async function validateApiKeyWithProvider(
  providerType: string,
  apiKey: string,
  options?: { baseUrl?: string; apiProtocol?: string },
): Promise<ValidationResult> {
  const profile = getValidationProfile(providerType, options);
  const resolvedBaseUrl = options?.baseUrl || getProviderConfig(providerType)?.baseUrl;

  if (profile === 'none') {
    return { valid: true };
  }

  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return { valid: false, error: 'API key is required' };
  }

  try {
    switch (profile) {
      case 'openai-completions':
        return await validateOpenAiCompatibleKey(
          providerType,
          trimmedKey,
          'openai-completions',
          resolvedBaseUrl,
        );
      case 'openai-responses':
        return await validateOpenAiCompatibleKey(
          providerType,
          trimmedKey,
          'openai-responses',
          resolvedBaseUrl,
        );
      case 'google-query-key':
        return await validateGoogleQueryKey(providerType, trimmedKey, resolvedBaseUrl);
      case 'anthropic-header':
        return await validateAnthropicHeaderKey(providerType, trimmedKey, resolvedBaseUrl);
      case 'openrouter':
        return await validateOpenRouterKey(providerType, trimmedKey);
      default:
        return { valid: false, error: `Unsupported validation profile for provider: ${providerType}` };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorMessage };
  }
}

export async function testProviderConnection(
  providerType: string,
  apiKey: string,
  options?: { baseUrl?: string; apiProtocol?: string; model?: string },
): Promise<ProviderConnectionTestResult> {
  const profile = getValidationProfile(providerType, options);
  const resolvedBaseUrl = options?.baseUrl || getProviderConfig(providerType)?.baseUrl;
  const model = options?.model?.trim();

  if (!model) {
    return { valid: false, error: 'Model is required for connection test' };
  }

  const trimmedKey = apiKey.trim();
  if (!trimmedKey && profile !== 'none') {
    return { valid: false, error: 'API key is required' };
  }

  if (profile === 'openai-completions' || profile === 'openrouter') {
    if (!resolvedBaseUrl) return { valid: false, error: `Base URL is required for provider "${providerType}" test` };
    const headers = {
      Authorization: `Bearer ${trimmedKey}`,
      'Content-Type': 'application/json',
    };
    const { probeUrl } = resolveOpenAiProbeUrls(resolvedBaseUrl, 'openai-completions');
    return await performConnectionTestRequest(
      providerType,
      probeUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: '请简短回复“连接成功”，并带上当前模型名。' }],
          max_tokens: 64,
          temperature: 0,
        }),
      },
      extractOpenAiMessageText,
      model,
    );
  }

  if (profile === 'openai-responses') {
    if (!resolvedBaseUrl) return { valid: false, error: `Base URL is required for provider "${providerType}" test` };
    const headers = {
      Authorization: `Bearer ${trimmedKey}`,
      'Content-Type': 'application/json',
    };
    const { probeUrl } = resolveOpenAiProbeUrls(resolvedBaseUrl, 'openai-responses');
    return await performConnectionTestRequest(
      providerType,
      probeUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          input: '请简短回复“连接成功”，并带上当前模型名。',
          max_output_tokens: 64,
        }),
      },
      extractResponsesText,
      model,
    );
  }

  if (profile === 'anthropic-header') {
    const rawBase = normalizeBaseUrl(resolvedBaseUrl || 'https://api.anthropic.com/v1');
    const base = rawBase.endsWith('/v1') ? rawBase : `${rawBase}/v1`;
    return await performConnectionTestRequest(
      providerType,
      `${base}/messages`,
      {
        method: 'POST',
        headers: {
          'x-api-key': trimmedKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 64,
          messages: [{ role: 'user', content: '请简短回复“连接成功”，并带上当前模型名。' }],
        }),
      },
      extractAnthropicText,
      model,
    );
  }

  if (profile === 'google-query-key') {
    const base = normalizeBaseUrl(resolvedBaseUrl || 'https://generativelanguage.googleapis.com/v1beta');
    const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(trimmedKey)}`;
    return await performConnectionTestRequest(
      providerType,
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: '请简短回复“连接成功”，并带上当前模型名。' }] }],
        }),
      },
      (payload) => {
        const record = payload as Record<string, unknown> | null;
        const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
        const parts = candidates.flatMap((candidate) => {
          if (typeof candidate !== 'object' || !candidate) return [];
          const content = (candidate as Record<string, unknown>).content;
          const contentParts = (content && typeof content === 'object')
            ? (content as Record<string, unknown>).parts
            : undefined;
          return Array.isArray(contentParts)
            ? contentParts.map((part) => (
              typeof part === 'object' && part && typeof (part as Record<string, unknown>).text === 'string'
                ? (part as Record<string, unknown>).text as string
                : ''
            ))
            : [];
        }).filter(Boolean).join('\n').trim();
        return parts || undefined;
      },
      model,
    );
  }

  if (profile === 'none') {
    return {
      valid: true,
      model,
      output: '本地模型接口可用',
      latencyMs: 0,
    };
  }

  return { valid: false, error: `Unsupported validation profile for provider: ${providerType}` };
}
