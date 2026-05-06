import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyAwareFetch = vi.fn();

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch,
}));

describe('validateApiKeyWithProvider', () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    proxyAwareFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('validates MiniMax CN keys with Anthropic headers', async () => {
    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');

    const result = await validateApiKeyWithProvider('minimax-portal-cn', 'sk-cn-test');

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      'https://api.minimaxi.com/anthropic/v1/models?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sk-cn-test',
          'anthropic-version': '2023-06-01',
        }),
      })
    );
  });

  it('still validates OpenAI-compatible providers with bearer auth', async () => {
    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');

    const result = await validateApiKeyWithProvider('openai', 'sk-openai-test');

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-openai-test',
        }),
      })
    );
  });

  it('validates DeepSeek keys against the official OpenAI-compatible API root', async () => {
    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');

    const result = await validateApiKeyWithProvider('deepseek', 'sk-deepseek-test');

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/models?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-deepseek-test',
        }),
      })
    );
  });

  it('falls back to /responses for openai-responses when /models is unavailable', async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Not Found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Unknown model' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');
    const result = await validateApiKeyWithProvider('custom', 'sk-response-test', {
      baseUrl: 'https://responses.example.com/v1',
      apiProtocol: 'openai-responses',
    });

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      1,
      'https://responses.example.com/v1/models?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-response-test',
        }),
      })
    );
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://responses.example.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('falls back to /chat/completions for openai-completions when /models is unavailable', async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Not Found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Unknown model' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');
    const result = await validateApiKeyWithProvider('custom', 'sk-chat-test', {
      baseUrl: 'https://chat.example.com/v1',
      apiProtocol: 'openai-completions',
    });

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://chat.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('does not duplicate endpoint suffix when baseUrl already points to /responses', async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Not Found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Unknown model' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');
    const result = await validateApiKeyWithProvider('custom', 'sk-endpoint-test', {
      baseUrl: 'https://openrouter.ai/api/v1/responses',
      apiProtocol: 'openai-responses',
    });

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      1,
      'https://openrouter.ai/api/v1/models?limit=1',
      expect.anything(),
    );
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://openrouter.ai/api/v1/responses',
      expect.anything(),
    );
  });
});

describe('testProviderConnection', () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  it('rejects redirected provider test responses', async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      new Response('<html>302 Found</html>', {
        status: 302,
        headers: {
          'Content-Type': 'text/html',
          Location: 'http://www.jd.com/error2.aspx',
        },
      })
    );

    const { testProviderConnection } = await import('@electron/services/providers/provider-validation');
    const result = await testProviderConnection('custom', 'abc', {
      baseUrl: 'https://lamnotexist.jd.com/api/saas/openai-u/v1',
      apiProtocol: 'openai-completions',
      model: 'qweeeeeen3.5-plus',
    });

    expect(result).toMatchObject({
      valid: false,
      status: 302,
    });
    expect(result.error).toContain('redirected');
    expect(result.error).toContain('www.jd.com/error2.aspx');
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      'https://lamnotexist.jd.com/api/saas/openai-u/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
      })
    );
  });

  it('rejects HTML success pages returned by provider tests', async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      new Response('<!doctype html><title>error</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    const { testProviderConnection } = await import('@electron/services/providers/provider-validation');
    const result = await testProviderConnection('custom', 'abc', {
      baseUrl: 'https://html.example.com/v1',
      apiProtocol: 'openai-completions',
      model: 'fake-model',
    });

    expect(result).toMatchObject({
      valid: false,
      status: 200,
    });
    expect(result.error).toContain('not JSON');
  });

  it('rejects JSON responses that do not match the selected OpenAI protocol', async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { testProviderConnection } = await import('@electron/services/providers/provider-validation');
    const result = await testProviderConnection('custom', 'abc', {
      baseUrl: 'https://api.example.com/v1',
      apiProtocol: 'openai-completions',
      model: 'fake-model',
    });

    expect(result).toMatchObject({
      valid: false,
      status: 200,
    });
    expect(result.error).toContain('did not match');
  });

  it('accepts valid OpenAI chat completion responses', async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: 'Connection succeeded with fake-model',
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    );

    const { testProviderConnection } = await import('@electron/services/providers/provider-validation');
    const result = await testProviderConnection('custom', 'abc', {
      baseUrl: 'https://api.example.com/v1',
      apiProtocol: 'openai-completions',
      model: 'fake-model',
    });

    expect(result).toMatchObject({
      valid: true,
      status: 200,
      output: 'Connection succeeded with fake-model',
    });
  });

  it('does not treat rate limits as a successful connection test', async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'rate limit' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { testProviderConnection } = await import('@electron/services/providers/provider-validation');
    const result = await testProviderConnection('custom', 'abc', {
      baseUrl: 'https://api.example.com/v1',
      apiProtocol: 'openai-completions',
      model: 'fake-model',
    });

    expect(result).toMatchObject({
      valid: false,
      status: 429,
    });
    expect(result.error).toContain('rate limited');
  });
});
