/**
 * Provider State Store
 * Manages AI provider configurations
 */
import { create } from 'zustand';
import type {
  ProviderAccount,
  ProviderConfig,
  ProviderVendorInfo,
  ProviderWithKeyInfo,
} from '@/lib/providers';
import { hostApiFetch } from '@/lib/host-api';
import { confirmGatewayImpact } from '@/lib/gateway-impact-confirm';
import {
  fetchProviderSnapshot,
} from '@/lib/provider-accounts';

// Re-export types for consumers that imported from here
export type {
  ProviderAccount,
  ProviderConfig,
  ProviderVendorInfo,
  ProviderWithKeyInfo,
} from '@/lib/providers';
export type { ProviderSnapshot } from '@/lib/provider-accounts';

let refreshProviderSnapshotInFlight: Promise<void> | null = null;

interface ProviderState {
  statuses: ProviderWithKeyInfo[];
  accounts: ProviderAccount[];
  vendors: ProviderVendorInfo[];
  defaultAccountId: string | null;
  loading: boolean;
  error: string | null;

  // Actions
  init: () => Promise<void>;
  refreshProviderSnapshot: () => Promise<void>;
  createAccount: (account: ProviderAccount, apiKey?: string) => Promise<boolean>;
  removeAccount: (accountId: string) => Promise<boolean>;
  validateAccountApiKey: (
    accountId: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  getAccountApiKey: (accountId: string) => Promise<string | null>;

  // Legacy compatibility aliases
  fetchProviders: () => Promise<void>;
  addProvider: (config: Omit<ProviderConfig, 'createdAt' | 'updatedAt'>, apiKey?: string) => Promise<boolean>;
  addAccount: (account: ProviderAccount, apiKey?: string) => Promise<boolean>;
  updateProvider: (providerId: string, updates: Partial<ProviderConfig>, apiKey?: string) => Promise<boolean>;
  updateAccount: (accountId: string, updates: Partial<ProviderAccount>, apiKey?: string) => Promise<boolean>;
  deleteProvider: (providerId: string) => Promise<boolean>;
  deleteAccount: (accountId: string) => Promise<boolean>;
  setApiKey: (providerId: string, apiKey: string) => Promise<boolean>;
  updateProviderWithKey: (
    providerId: string,
    updates: Partial<ProviderConfig>,
    apiKey?: string
  ) => Promise<boolean>;
  deleteApiKey: (providerId: string) => Promise<void>;
  setDefaultProvider: (providerId: string) => Promise<boolean>;
  setDefaultAccount: (accountId: string) => Promise<boolean>;
  validateApiKey: (
    providerId: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  getApiKey: (providerId: string) => Promise<string | null>;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  statuses: [],
  accounts: [],
  vendors: [],
  defaultAccountId: null,
  loading: false,
  error: null,

  init: async () => {
    await get().refreshProviderSnapshot();
  },

  refreshProviderSnapshot: async () => {
    if (refreshProviderSnapshotInFlight) {
      return refreshProviderSnapshotInFlight;
    }

    set({ loading: true, error: null });

    refreshProviderSnapshotInFlight = (async () => {
      try {
        const snapshot = await fetchProviderSnapshot();

        set({
          statuses: snapshot.statuses ?? [],
          accounts: snapshot.accounts ?? [],
          vendors: snapshot.vendors ?? [],
          defaultAccountId: snapshot.defaultAccountId ?? null,
          loading: false,
        });
      } catch (error) {
        set({ error: String(error), loading: false });
      } finally {
        refreshProviderSnapshotInFlight = null;
      }
    })();

    return refreshProviderSnapshotInFlight;
  },

  fetchProviders: async () => get().refreshProviderSnapshot(),
  
  addProvider: async (config, apiKey) => {
    const confirmed = await confirmGatewayImpact({
      mode: 'refresh',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    try {
      const fullConfig: ProviderConfig = {
        ...config,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts', {
        method: 'POST',
        body: JSON.stringify({
          account: {
            id: fullConfig.id,
            vendorId: fullConfig.type,
            label: fullConfig.name,
            authMode: fullConfig.type === 'ollama' ? 'local' : 'api_key',
            baseUrl: fullConfig.baseUrl,
            apiProtocol: fullConfig.apiProtocol,
            headers: fullConfig.headers,
            model: fullConfig.model,
            fallbackModels: fullConfig.fallbackModels,
            fallbackAccountIds: fullConfig.fallbackProviderIds,
            enabled: fullConfig.enabled,
            isDefault: false,
            createdAt: fullConfig.createdAt,
            updatedAt: fullConfig.updatedAt,
          },
          apiKey,
        }),
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to save provider');
      }
      
      // Refresh the list
      await get().refreshProviderSnapshot();
      return true;
    } catch (error) {
      console.error('Failed to add provider:', error);
      throw error;
    }
  },

  createAccount: async (account, apiKey) => {
    const confirmed = await confirmGatewayImpact({
      mode: 'refresh',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts', {
        method: 'POST',
        body: JSON.stringify({ account, apiKey }),
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create provider account');
      }

      await get().refreshProviderSnapshot();
      return true;
    } catch (error) {
      console.error('Failed to add account:', error);
      throw error;
    }
  },

  addAccount: async (account, apiKey) => get().createAccount(account, apiKey),
  
  updateProvider: async (providerId, updates, apiKey) => {
    const confirmed = await confirmGatewayImpact({
      mode: 'refresh',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    try {
      const existing = get().statuses.find((p) => p.id === providerId);
      if (!existing) {
        throw new Error('Provider not found');
      }

      const { hasKey: _hasKey, keyMasked: _keyMasked, ...providerConfig } = existing;
      
      const updatedConfig: ProviderConfig = {
        ...providerConfig,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/provider-accounts/${encodeURIComponent(providerId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          updates: {
            label: updatedConfig.name,
            baseUrl: updatedConfig.baseUrl,
            apiProtocol: updatedConfig.apiProtocol,
            headers: updatedConfig.headers,
            model: updatedConfig.model,
            fallbackModels: updatedConfig.fallbackModels,
            fallbackAccountIds: updatedConfig.fallbackProviderIds,
            enabled: updatedConfig.enabled,
            updatedAt: updatedConfig.updatedAt,
          },
          apiKey,
        }),
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to update provider');
      }
      
      // Refresh the list
      await get().refreshProviderSnapshot();
      return true;
    } catch (error) {
      console.error('Failed to update provider:', error);
      throw error;
    }
  },

  updateAccount: async (accountId, updates, apiKey) => {
    const confirmed = await confirmGatewayImpact({
      mode: 'refresh',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/provider-accounts/${encodeURIComponent(accountId)}`, {
        method: 'PUT',
        body: JSON.stringify({ updates, apiKey }),
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to update provider account');
      }

      await get().refreshProviderSnapshot();
      return true;
    } catch (error) {
      console.error('Failed to update account:', error);
      throw error;
    }
  },
  
  deleteProvider: async (providerId) => {
    const confirmed = await confirmGatewayImpact({
      mode: 'restart',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/provider-accounts/${encodeURIComponent(providerId)}`, {
        method: 'DELETE',
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete provider');
      }
      
      // Refresh the list
      await get().refreshProviderSnapshot();
      return true;
    } catch (error) {
      console.error('Failed to delete provider:', error);
      throw error;
    }
  },

  removeAccount: async (accountId) => {
    const confirmed = await confirmGatewayImpact({
      mode: 'restart',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/provider-accounts/${encodeURIComponent(accountId)}`, {
        method: 'DELETE',
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete provider account');
      }

      await get().refreshProviderSnapshot();
      return true;
    } catch (error) {
      console.error('Failed to delete account:', error);
      throw error;
    }
  },

  deleteAccount: async (accountId) => get().removeAccount(accountId),
  
  setApiKey: async (providerId, apiKey) => {
    const confirmed = await confirmGatewayImpact({
      mode: 'refresh',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/provider-accounts/${encodeURIComponent(providerId)}`, {
        method: 'PUT',
        body: JSON.stringify({ updates: {}, apiKey }),
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to set API key');
      }
      
      // Refresh the list
      await get().refreshProviderSnapshot();
      return true;
    } catch (error) {
      console.error('Failed to set API key:', error);
      throw error;
    }
  },

  updateProviderWithKey: async (providerId, updates, apiKey) => {
    const confirmed = await confirmGatewayImpact({
      mode: 'refresh',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/provider-accounts/${encodeURIComponent(providerId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          updates: {
            label: updates.name,
            baseUrl: updates.baseUrl,
            apiProtocol: updates.apiProtocol,
            headers: updates.headers,
            model: updates.model,
            fallbackModels: updates.fallbackModels,
            fallbackAccountIds: updates.fallbackProviderIds,
            enabled: updates.enabled,
            updatedAt: updates.updatedAt,
          },
          apiKey,
        }),
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to update provider');
      }

      await get().refreshProviderSnapshot();
      return true;
    } catch (error) {
      console.error('Failed to update provider with key:', error);
      throw error;
    }
  },
  
  deleteApiKey: async (providerId) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(
        `/api/provider-accounts/${encodeURIComponent(providerId)}?apiKeyOnly=1`,
        { method: 'DELETE' },
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete API key');
      }
      
      // Refresh the list
      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to delete API key:', error);
      throw error;
    }
  },
  
  setDefaultProvider: async (providerId) => {
    const confirmed = await confirmGatewayImpact({
      mode: 'refresh',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts/default', {
        method: 'PUT',
        body: JSON.stringify({ accountId: providerId }),
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to set default provider');
      }
      
      set({ defaultAccountId: providerId });
      return true;
    } catch (error) {
      console.error('Failed to set default provider:', error);
      throw error;
    }
  },

  setDefaultAccount: async (accountId) => {
    const confirmed = await confirmGatewayImpact({
      mode: 'refresh',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts/default', {
        method: 'PUT',
        body: JSON.stringify({ accountId }),
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to set default provider account');
      }

      set({ defaultAccountId: accountId });
      return true;
    } catch (error) {
      console.error('Failed to set default account:', error);
      throw error;
    }
  },
  
  validateAccountApiKey: async (providerId, apiKey, options) => {
    try {
      const result = await hostApiFetch<{ valid: boolean; error?: string }>(`/api/provider-accounts/${encodeURIComponent(providerId)}/test`, {
        method: 'POST',
        body: JSON.stringify({
          apiKey,
          baseUrl: options?.baseUrl,
          apiProtocol: options?.apiProtocol,
        }),
      });
      return result;
    } catch (error) {
      return { valid: false, error: String(error) };
    }
  },

  validateApiKey: async (providerId, apiKey, options) => get().validateAccountApiKey(providerId, apiKey, options),
  
  getAccountApiKey: async (providerId) => {
    try {
      const result = await hostApiFetch<{ apiKey: string | null }>(`/api/provider-accounts/${encodeURIComponent(providerId)}/api-key`);
      return result.apiKey;
    } catch {
      return null;
    }
  },

  getApiKey: async (providerId) => get().getAccountApiKey(providerId),
}));
