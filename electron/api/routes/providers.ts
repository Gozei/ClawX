import type { IncomingMessage, ServerResponse } from 'http';
import {
  type ProviderConfig,
} from '../../utils/secure-storage';
import {
  getProviderConfig,
} from '../../utils/provider-registry';
import { deviceOAuthManager, type OAuthProviderType } from '../../utils/device-oauth';
import { browserOAuthManager, type BrowserOAuthProviderType } from '../../utils/browser-oauth';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  syncDefaultProviderToRuntime,
  syncDeletedProviderApiKeyToRuntime,
  syncDeletedProviderToRuntime,
  syncProviderApiKeyToRuntime,
  syncSavedProviderToRuntime,
  syncUpdatedProviderToRuntime,
} from '../../services/providers/provider-runtime-sync';
import { testProviderConnection, validateApiKeyWithProvider } from '../../services/providers/provider-validation';
import { getProviderService } from '../../services/providers/provider-service';
import { providerAccountToConfig } from '../../services/providers/provider-store';
import type { ProviderAccount } from '../../shared/providers/types';
import { logger } from '../../utils/logger';
import { getApiKey } from '../../utils/secure-storage';
import { emitMutationAudit } from '../audit-utils';

const legacyProviderRoutesWarned = new Set<string>();

function hasObjectChanges<T extends Record<string, unknown>>(
  existing: T,
  patch: Partial<T> | undefined,
): boolean {
  if (!patch) return false;
  const keys = Object.keys(patch) as Array<keyof T>;
  if (keys.length === 0) return false;
  return keys.some((key) => JSON.stringify(existing[key]) !== JSON.stringify(patch[key]));
}

export async function handleProviderRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  const providerService = getProviderService();
  const logLegacyProviderRoute = (route: string): void => {
    if (legacyProviderRoutesWarned.has(route)) return;
    legacyProviderRoutesWarned.add(route);
    logger.warn(
      `[provider-migration] Legacy HTTP route "${route}" is deprecated. Prefer /api/provider-accounts endpoints.`,
    );
  };

  if (url.pathname === '/api/provider-vendors' && req.method === 'GET') {
    sendJson(res, 200, await providerService.listVendors());
    return true;
  }

  if (url.pathname === '/api/provider-accounts' && req.method === 'GET') {
    sendJson(res, 200, await providerService.listAccounts());
    return true;
  }

  if (url.pathname === '/api/provider-account-statuses' && req.method === 'GET') {
    sendJson(res, 200, await providerService.listAccountStatuses());
    return true;
  }

  if (url.pathname === '/api/provider-accounts' && req.method === 'POST') {
    const startedAt = Date.now();
    try {
      const body = await parseJsonBody<{ account: ProviderAccount; apiKey?: string }>(req);
      const account = await providerService.createAccount(body.account, body.apiKey);
      await syncSavedProviderToRuntime(providerAccountToConfig(account), body.apiKey, ctx.gatewayManager);
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'provider.account.create',
        resourceType: 'provider-account',
        resourceId: account.id,
        result: 'success',
        changedKeys: [
          ...Object.keys(body.account ?? {}),
          ...(body.apiKey !== undefined ? ['apiKey'] : []),
        ],
        metadata: {
          vendorId: account.vendorId,
          authMode: account.authMode,
        },
      });
      sendJson(res, 200, { success: true, account });
    } catch (error) {
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'provider.account.create',
        resourceType: 'provider-account',
        result: 'failure',
        error,
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-drafts/test' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        accountId?: string | null;
        vendorId: string;
        apiKey?: string | null;
        model?: string;
        baseUrl?: string;
        apiProtocol?: string;
      }>(req);
      const existing = body.accountId ? await providerService.getAccount(body.accountId) : null;
      const vendorId = body.vendorId || existing?.vendorId;
      if (!vendorId) {
        sendJson(res, 400, { valid: false, error: 'Provider vendor is required' });
        return true;
      }

      const apiKey = body.apiKey?.trim() || (body.accountId ? await getApiKey(body.accountId) : '') || '';
      const result = await testProviderConnection(vendorId, apiKey, {
        model: body.model || existing?.model,
        baseUrl: body.baseUrl || existing?.baseUrl,
        apiProtocol: body.apiProtocol || existing?.apiProtocol,
      });
      sendJson(res, result.valid ? 200 : 400, result);
    } catch (error) {
      sendJson(res, 500, { valid: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-accounts/default' && req.method === 'GET') {
    sendJson(res, 200, { accountId: await providerService.getDefaultAccountId() ?? null });
    return true;
  }

  if (url.pathname === '/api/provider-accounts/default' && req.method === 'PUT') {
    const startedAt = Date.now();
    try {
      const body = await parseJsonBody<{ accountId: string }>(req);
      const currentDefault = await providerService.getDefaultAccountId();
      if (currentDefault === body.accountId) {
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'provider.account.set-default',
          resourceType: 'provider-account',
          resourceId: body.accountId,
          result: 'noop',
          changedKeys: ['defaultAccountId'],
        });
        sendJson(res, 200, { success: true, noChange: true });
        return true;
      }
      await providerService.setDefaultAccount(body.accountId);
      await syncDefaultProviderToRuntime(body.accountId, ctx.gatewayManager);
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'provider.account.set-default',
        resourceType: 'provider-account',
        resourceId: body.accountId,
        result: 'success',
        changedKeys: ['defaultAccountId'],
      });
      sendJson(res, 200, { success: true });
    } catch (error) {
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'provider.account.set-default',
        resourceType: 'provider-account',
        result: 'failure',
        changedKeys: ['defaultAccountId'],
        error,
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'GET') {
    const accountId = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    if (accountId.endsWith('/api-key')) {
      const actualId = accountId.slice(0, -'/api-key'.length);
      sendJson(res, 200, { apiKey: await providerService.getAccountApiKey(actualId) });
      return true;
    }
    sendJson(res, 200, await providerService.getAccount(accountId));
    return true;
  }

  if (url.pathname === '/api/provider-accounts/oauth/start' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        provider: OAuthProviderType | BrowserOAuthProviderType;
        region?: 'global' | 'cn';
        accountId?: string;
        label?: string;
      }>(req);
      if (body.provider === 'google' || body.provider === 'openai') {
        await browserOAuthManager.startFlow(body.provider, {
          accountId: body.accountId,
          label: body.label,
        });
      } else {
        await deviceOAuthManager.startFlow(body.provider, body.region, {
          accountId: body.accountId,
          label: body.label,
        });
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-accounts/oauth/cancel' && req.method === 'POST') {
    try {
      await deviceOAuthManager.stopFlow();
      await browserOAuthManager.stopFlow();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-accounts/oauth/submit' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ code: string }>(req);
      const accepted = browserOAuthManager.submitManualCode(body.code || '');
      if (!accepted) {
        sendJson(res, 400, { success: false, error: 'No active manual OAuth input pending' });
        return true;
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'PUT') {
    const accountId = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    const startedAt = Date.now();
    try {
      const body = await parseJsonBody<{ updates: Partial<ProviderAccount>; apiKey?: string }>(req);
      const existing = await providerService.getAccount(accountId);
      if (!existing) {
        sendJson(res, 404, { success: false, error: 'Provider account not found' });
        return true;
      }
      const hasPatchChanges = hasObjectChanges(existing as unknown as Record<string, unknown>, body.updates);
      if (!hasPatchChanges && body.apiKey === undefined) {
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'provider.account.update',
          resourceType: 'provider-account',
          resourceId: accountId,
          result: 'noop',
          changedKeys: Object.keys(body.updates ?? {}),
        });
        sendJson(res, 200, { success: true, noChange: true, account: existing });
        return true;
      }
      const previousConfig = providerAccountToConfig(existing);
      const nextAccount = await providerService.updateAccount(accountId, body.updates, body.apiKey);
      await syncUpdatedProviderToRuntime(
        providerAccountToConfig(nextAccount),
        body.apiKey,
        ctx.gatewayManager,
        { previousConfig },
      );
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'provider.account.update',
        resourceType: 'provider-account',
        resourceId: accountId,
        result: 'success',
        changedKeys: [
          ...Object.keys(body.updates ?? {}),
          ...(body.apiKey !== undefined ? ['apiKey'] : []),
        ],
        metadata: {
          vendorId: nextAccount.vendorId,
        },
      });
      sendJson(res, 200, { success: true, account: nextAccount });
    } catch (error) {
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'provider.account.update',
        resourceType: 'provider-account',
        resourceId: accountId,
        result: 'failure',
        error,
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && url.pathname.endsWith('/test') && req.method === 'POST') {
    const accountId = decodeURIComponent(
      url.pathname.slice('/api/provider-accounts/'.length, -'/test'.length),
    );
    try {
      const body = await parseJsonBody<{
        apiKey?: string | null;
        model?: string;
        baseUrl?: string;
        apiProtocol?: string;
      }>(req);
      const existing = await providerService.getAccount(accountId);
      if (!existing) {
        sendJson(res, 404, { valid: false, error: 'Provider account not found' });
        return true;
      }

      const apiKey = body.apiKey?.trim() || await getApiKey(accountId) || '';
      const result = await testProviderConnection(existing.vendorId, apiKey, {
        model: body.model || existing.model,
        baseUrl: body.baseUrl || existing.baseUrl,
        apiProtocol: body.apiProtocol || existing.apiProtocol,
      });
      sendJson(res, result.valid ? 200 : 400, result);
    } catch (error) {
      sendJson(res, 500, { valid: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'DELETE') {
    const accountId = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    const startedAt = Date.now();
    try {
      const existing = await providerService.getAccount(accountId);
      const runtimeProviderKey = existing?.authMode === 'oauth_browser'
        ? (existing.vendorId === 'google'
          ? 'google-gemini-cli'
          : (existing.vendorId === 'openai' ? 'openai-codex' : undefined))
        : undefined;
      if (url.searchParams.get('apiKeyOnly') === '1') {
        await providerService.deleteLegacyProviderApiKey(accountId);
        await syncDeletedProviderApiKeyToRuntime(
          existing ? providerAccountToConfig(existing) : null,
          accountId,
          runtimeProviderKey,
        );
        emitMutationAudit(req, ctx, {
          startedAt,
          action: 'provider.account.delete-key',
          resourceType: 'provider-account',
          resourceId: accountId,
          result: 'success',
          changedKeys: ['apiKey'],
          metadata: {
            vendorId: existing?.vendorId,
          },
        });
        sendJson(res, 200, { success: true });
        return true;
      }
      await providerService.deleteAccount(accountId);
      await syncDeletedProviderToRuntime(
        existing ? providerAccountToConfig(existing) : null,
        accountId,
        ctx.gatewayManager,
        runtimeProviderKey,
      );
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'provider.account.delete',
        resourceType: 'provider-account',
        resourceId: accountId,
        result: 'success',
        changedKeys: ['*'],
        metadata: {
          vendorId: existing?.vendorId,
        },
      });
      sendJson(res, 200, { success: true });
    } catch (error) {
      emitMutationAudit(req, ctx, {
        startedAt,
        action: url.searchParams.get('apiKeyOnly') === '1'
          ? 'provider.account.delete-key'
          : 'provider.account.delete',
        resourceType: 'provider-account',
        resourceId: accountId,
        result: 'failure',
        error,
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers' && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers');
    sendJson(res, 200, await providerService.listLegacyProvidersWithKeyInfo());
    return true;
  }

  if (url.pathname === '/api/providers/default' && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers/default');
    sendJson(res, 200, { providerId: await providerService.getDefaultLegacyProvider() ?? null });
    return true;
  }

  if (url.pathname === '/api/providers/default' && req.method === 'PUT') {
    logLegacyProviderRoute('PUT /api/providers/default');
    try {
      const body = await parseJsonBody<{ providerId: string }>(req);
      const currentDefault = await providerService.getDefaultLegacyProvider();
      if (currentDefault === body.providerId) {
        sendJson(res, 200, { success: true, noChange: true });
        return true;
      }
      await providerService.setDefaultLegacyProvider(body.providerId);
      await syncDefaultProviderToRuntime(body.providerId, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/validate' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/validate');
    try {
      const body = await parseJsonBody<{ providerId: string; apiKey: string; options?: { baseUrl?: string; apiProtocol?: string } }>(req);
      const provider = await providerService.getLegacyProvider(body.providerId);
      const providerType = provider?.type || body.providerId;
      const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
      const resolvedBaseUrl = body.options?.baseUrl || provider?.baseUrl || registryBaseUrl;
      const resolvedProtocol = body.options?.apiProtocol || provider?.apiProtocol;
      sendJson(res, 200, await validateApiKeyWithProvider(providerType, body.apiKey, { baseUrl: resolvedBaseUrl, apiProtocol: resolvedProtocol }));
    } catch (error) {
      sendJson(res, 500, { valid: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/oauth/start' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/oauth/start');
    try {
      const body = await parseJsonBody<{
        provider: OAuthProviderType | BrowserOAuthProviderType;
        region?: 'global' | 'cn';
        accountId?: string;
        label?: string;
      }>(req);
      if (body.provider === 'google' || body.provider === 'openai') {
        await browserOAuthManager.startFlow(body.provider, {
          accountId: body.accountId,
          label: body.label,
        });
      } else {
        await deviceOAuthManager.startFlow(body.provider, body.region, {
          accountId: body.accountId,
          label: body.label,
        });
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/oauth/cancel' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/oauth/cancel');
    try {
      await deviceOAuthManager.stopFlow();
      await browserOAuthManager.stopFlow();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/oauth/submit' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/oauth/submit');
    try {
      const body = await parseJsonBody<{ code: string }>(req);
      const accepted = browserOAuthManager.submitManualCode(body.code || '');
      if (!accepted) {
        sendJson(res, 400, { success: false, error: 'No active manual OAuth input pending' });
        return true;
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers');
    try {
      const body = await parseJsonBody<{ config: ProviderConfig; apiKey?: string }>(req);
      const config = body.config;
      await providerService.saveLegacyProvider(config);
      if (body.apiKey !== undefined) {
        const trimmedKey = body.apiKey.trim();
        if (trimmedKey) {
          await providerService.setLegacyProviderApiKey(config.id, trimmedKey);
          await syncProviderApiKeyToRuntime(config.type, config.id, trimmedKey);
        }
      }
      await syncSavedProviderToRuntime(config, body.apiKey, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    if (providerId.endsWith('/api-key')) {
      const actualId = providerId.slice(0, -('/api-key'.length));
      sendJson(res, 200, { apiKey: await providerService.getLegacyProviderApiKey(actualId) });
      return true;
    }
    if (providerId.endsWith('/has-api-key')) {
      const actualId = providerId.slice(0, -('/has-api-key'.length));
      sendJson(res, 200, { hasKey: await providerService.hasLegacyProviderApiKey(actualId) });
      return true;
    }
    sendJson(res, 200, await providerService.getLegacyProvider(providerId));
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'PUT') {
    logLegacyProviderRoute('PUT /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    try {
      const body = await parseJsonBody<{ updates: Partial<ProviderConfig>; apiKey?: string }>(req);
      const existing = await providerService.getLegacyProvider(providerId);
      if (!existing) {
        sendJson(res, 404, { success: false, error: 'Provider not found' });
        return true;
      }
      const hasPatchChanges = hasObjectChanges(existing as unknown as Record<string, unknown>, body.updates);
      if (!hasPatchChanges && body.apiKey === undefined) {
        sendJson(res, 200, { success: true, noChange: true });
        return true;
      }
      const nextConfig: ProviderConfig = { ...existing, ...body.updates, updatedAt: new Date().toISOString() };
      await providerService.saveLegacyProvider(nextConfig);
      if (body.apiKey !== undefined) {
        const trimmedKey = body.apiKey.trim();
        if (trimmedKey) {
          await providerService.setLegacyProviderApiKey(providerId, trimmedKey);
          await syncProviderApiKeyToRuntime(nextConfig.type, providerId, trimmedKey);
        } else {
          await providerService.deleteLegacyProviderApiKey(providerId);
          await syncDeletedProviderApiKeyToRuntime(existing, providerId);
        }
      }
      await syncUpdatedProviderToRuntime(nextConfig, body.apiKey, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'DELETE') {
    logLegacyProviderRoute('DELETE /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    try {
      const existing = await providerService.getLegacyProvider(providerId);
      if (url.searchParams.get('apiKeyOnly') === '1') {
        await providerService.deleteLegacyProviderApiKey(providerId);
        await syncDeletedProviderApiKeyToRuntime(existing, providerId);
        sendJson(res, 200, { success: true });
        return true;
      }
      await providerService.deleteLegacyProvider(providerId);
      await syncDeletedProviderToRuntime(existing, providerId, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
