import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { AppError, normalizeAppError } from '@/lib/error-model';
import { useGatewayStore } from './gateway';
import type {
  MarketplaceInstalledSkill,
  MarketplaceSkillDetail,
  MarketplaceSearchResponse,
  MarketplaceSkill,
  MarketplaceSourceCount,
  SkillDetail,
  SkillSnapshot,
  SkillSource,
} from '../types/skill';

const SKILL_TOGGLE_DEBOUNCE_MS = 500;

function isGatewayTransientError(error: AppError, gatewayState: 'stopped' | 'starting' | 'running' | 'error' | 'reconnecting'): boolean {
  if (gatewayState === 'running') {
    return false;
  }
  if (error.code === 'GATEWAY' || error.code === 'NETWORK') {
    return true;
  }
  const message = error.message.toLowerCase();
  return message.includes('gateway not connected')
    || message.includes('gateway socket closed')
    || message.includes('econnrefused');
}

interface SkillsState {
  skills: SkillSnapshot[];
  skillDetailsById: Record<string, SkillDetail>;
  searchResults: MarketplaceSkill[];
  marketInstalledSkills: MarketplaceInstalledSkill[];
  marketplaceSourceCounts: Record<string, number | null>;
  marketplaceSkillDetailsByKey: Record<string, MarketplaceSkillDetail>;
  sources: SkillSource[];
  searchNextCursor: string | null;
  searchingMore: boolean;
  loading: boolean;
  refreshing: boolean;
  searching: boolean;
  detailLoadingId: string | null;
  marketplaceDetailLoadingKey: string | null;
  searchError: string | null;
  installing: Record<string, boolean>;
  deleting: Record<string, boolean>;
  toggling: Record<string, boolean>;
  toggleTargets: Record<string, boolean | undefined>;
  error: string | null;
  lastFetchedAt: number | null;

  fetchSkills: (force?: boolean) => Promise<void>;
  fetchSources: () => Promise<SkillSource[]>;
  fetchMarketplaceSourceCounts: (force?: boolean) => Promise<Record<string, number | null>>;
  fetchMarketInstalledSkills: () => Promise<MarketplaceInstalledSkill[]>;
  fetchMarketplaceSkillDetail: (slug: string, sourceId?: string, force?: boolean) => Promise<MarketplaceSkillDetail>;
  fetchSkillDetail: (skillId: string, force?: boolean) => Promise<SkillDetail>;
  saveSkillConfig: (skillId: string, input: { apiKey?: string; env?: Record<string, string> }) => Promise<void>;
  deleteSkill: (skillId: string) => Promise<void>;
  searchSkills: (query: string, sourceId?: string, options?: { append?: boolean; cursor?: string }) => Promise<void>;
  loadMoreSearchResults: (query: string, sourceId?: string) => Promise<void>;
  installSkill: (slug: string, version?: string, sourceId?: string, force?: boolean) => Promise<void>;
  uninstallSkill: (slug: string, sourceId?: string) => Promise<void>;
  enableSkill: (skillId: string) => Promise<void>;
  disableSkill: (skillId: string) => Promise<void>;
  updateSkill: (skillId: string, updates: Partial<SkillSnapshot>) => void;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  skillDetailsById: {},
  searchResults: [],
  marketInstalledSkills: [],
  marketplaceSourceCounts: {},
  marketplaceSkillDetailsByKey: {},
  sources: [],
  searchNextCursor: null,
  searchingMore: false,
  loading: false,
  refreshing: false,
  searching: false,
  detailLoadingId: null,
  marketplaceDetailLoadingKey: null,
  searchError: null,
  installing: {},
  deleting: {},
  toggling: {},
  toggleTargets: {},
  error: null,
  lastFetchedAt: null,

  fetchSources: async (): Promise<SkillSource[]> => {
    const existing = get().sources;
    if (existing.length > 0) {
      return existing;
    }
    const result = await hostApiFetch<{ success: boolean; results?: SkillSource[]; error?: string }>('/api/clawhub/sources');
    const sources = result.success ? (result.results || []) : [];
    set({ sources });
    return sources;
  },

  fetchMarketplaceSourceCounts: async (force = false): Promise<Record<string, number | null>> => {
    const sources = await get().fetchSources();
    const existing = get().marketplaceSourceCounts;
    if (!force && sources.length > 0 && sources.every((source) => Object.prototype.hasOwnProperty.call(existing, source.id))) {
      return existing;
    }

    const result = await hostApiFetch<{ success: boolean; results?: MarketplaceSourceCount[]; error?: string }>('/api/clawhub/source-counts');
    if (!result.success) {
      return existing;
    }

    const counts = (result.results || []).reduce<Record<string, number | null>>((acc, item) => {
      const previous = acc[item.sourceId];
      acc[item.sourceId] = typeof item.total === 'number'
        ? item.total
        : (typeof previous === 'number' ? previous : null);
      return acc;
    }, { ...existing });
    set({ marketplaceSourceCounts: counts });
    return counts;
  },

  fetchMarketInstalledSkills: async (): Promise<MarketplaceInstalledSkill[]> => {
    const result = await hostApiFetch<{ success: boolean; results?: MarketplaceInstalledSkill[]; error?: string }>('/api/clawhub/list');
    const installed = result.success ? (result.results || []) : [];
    set({ marketInstalledSkills: installed });
    return installed;
  },

  fetchMarketplaceSkillDetail: async (slug: string, sourceId?: string, force = false): Promise<MarketplaceSkillDetail> => {
    const key = sourceId ? `${sourceId}:${slug}` : slug;
    const cached = get().marketplaceSkillDetailsByKey[key];
    if (cached && !force) {
      return cached;
    }

    set({ marketplaceDetailLoadingKey: key });
    try {
      const result = await hostApiFetch<{ success: boolean; detail?: MarketplaceSkillDetail; error?: string }>('/api/clawhub/skill-detail', {
        method: 'POST',
        body: JSON.stringify({ slug, sourceId }),
      });
      if (!result.success || !result.detail) {
        throw new Error(result.error || 'Failed to fetch marketplace skill detail');
      }
      const detail = result.detail;
      set((state) => ({
        marketplaceDetailLoadingKey: state.marketplaceDetailLoadingKey === key ? null : state.marketplaceDetailLoadingKey,
        marketplaceSkillDetailsByKey: {
          ...state.marketplaceSkillDetailsByKey,
          [key]: detail,
        },
      }));
      return detail;
    } catch (error) {
      set((state) => ({
        marketplaceDetailLoadingKey: state.marketplaceDetailLoadingKey === key ? null : state.marketplaceDetailLoadingKey,
      }));
      throw error;
    }
  },

  fetchSkills: async (force = false) => {
    const existingSkills = Array.isArray(get().skills) ? get().skills : [];
    const lastFetchedAt = get().lastFetchedAt;
    const gatewayState = useGatewayStore.getState().status.state;
    if (!force && existingSkills.length > 0 && lastFetchedAt && Date.now() - lastFetchedAt < 15_000) {
      return;
    }
    if (!force && existingSkills.length === 0 && gatewayState !== 'running') {
      return;
    }

    if (existingSkills.length === 0) {
      set({ loading: true, refreshing: false, error: null });
    } else {
      set({ refreshing: true, error: null });
    }

    try {
      const skills = await hostApiFetch<SkillSnapshot[]>('/api/skills');
      set({
        skills: Array.isArray(skills) ? skills : [],
        loading: false,
        refreshing: false,
        lastFetchedAt: Date.now(),
      });
    } catch (error) {
      const appError = normalizeAppError(error, { module: 'skills', operation: 'fetch' });
      if (isGatewayTransientError(appError, gatewayState)) {
        set({ loading: false, refreshing: false, error: null });
        return;
      }
      set({ loading: false, refreshing: false, error: appError.message });
    }
  },

  fetchSkillDetail: async (skillId: string, force = false): Promise<SkillDetail> => {
    const cached = get().skillDetailsById[skillId];
    if (cached && !force) {
      return cached;
    }

    set({ detailLoadingId: skillId });
    try {
      const detail = await hostApiFetch<SkillDetail>(`/api/skills/${encodeURIComponent(skillId)}`);
      set((state) => ({
        detailLoadingId: state.detailLoadingId === skillId ? null : state.detailLoadingId,
        skillDetailsById: {
          ...state.skillDetailsById,
          [skillId]: detail,
        },
      }));
      return detail;
    } catch (error) {
      set((state) => ({
        detailLoadingId: state.detailLoadingId === skillId ? null : state.detailLoadingId,
      }));
      throw error;
    }
  },

  saveSkillConfig: async (skillId: string, input) => {
    const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/skills/${encodeURIComponent(skillId)}/config`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    if (!result.success) {
      throw new Error(result.error || 'Failed to save skill config');
    }
    await get().fetchSkills(true);
    const detail = await get().fetchSkillDetail(skillId, true);
    set((state) => ({
      skillDetailsById: {
        ...state.skillDetailsById,
        [skillId]: detail,
      },
    }));
  },

  deleteSkill: async (skillId: string) => {
    set((state) => ({ deleting: { ...state.deleting, [skillId]: true } }));
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/skills/${encodeURIComponent(skillId)}`, {
        method: 'DELETE',
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete skill');
      }
      await get().fetchSkills(true);
      set((state) => {
        const nextDeleting = { ...state.deleting };
        delete nextDeleting[skillId];
        const nextDetails = { ...state.skillDetailsById };
        delete nextDetails[skillId];
        return {
          deleting: nextDeleting,
          skillDetailsById: nextDetails,
        };
      });
    } catch (error) {
      set((state) => {
        const nextDeleting = { ...state.deleting };
        delete nextDeleting[skillId];
        return { deleting: nextDeleting };
      });
      throw error;
    }
  },

  searchSkills: async (query: string, sourceId?: string, options?: { append?: boolean; cursor?: string }) => {
    const append = options?.append === true;
    set(append ? { searchingMore: true, searchError: null } : { searching: true, searchError: null });
    try {
      const result = await hostApiFetch<{ success: boolean; results?: MarketplaceSearchResponse['results']; nextCursor?: string; error?: string }>('/api/clawhub/search', {
        method: 'POST',
        body: JSON.stringify({ query, ...(sourceId ? { sourceId } : { allSources: true }), ...(options?.cursor ? { cursor: options.cursor } : {}) }),
      });
      if (result.success) {
        set((state) => ({
          searchResults: append ? [...state.searchResults, ...(result.results || [])] : (result.results || []),
          searchNextCursor: result.nextCursor || null,
        }));
      } else {
        throw normalizeAppError(new Error(result.error || 'Search failed'), {
          module: 'skills',
          operation: 'search',
        });
      }
    } catch (error) {
      const appError = normalizeAppError(error, { module: 'skills', operation: 'search' });
      set({ searchError: appError.message });
    } finally {
      set(append ? { searchingMore: false } : { searching: false });
    }
  },

  loadMoreSearchResults: async (query: string, sourceId?: string) => {
    const { searchNextCursor, searching, searchingMore } = get();
    if (!searchNextCursor || searching || searchingMore) {
      return;
    }
    await get().searchSkills(query, sourceId, { append: true, cursor: searchNextCursor });
  },

  installSkill: async (slug: string, version?: string, sourceId?: string, force = false) => {
    const installKey = sourceId ? `${sourceId}:${slug}` : slug;
    set((state) => ({ installing: { ...state.installing, [installKey]: true } }));
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/install', {
        method: 'POST',
        body: JSON.stringify({ slug, version, sourceId, force }),
      });
      if (!result.success) {
        const appError = normalizeAppError(new Error(result.error || 'Install failed'), {
          module: 'skills',
          operation: 'install',
        });
        throw new Error(appError.message);
      }
      await get().fetchSkills(true);
      await get().fetchMarketInstalledSkills();
    } finally {
      set((state) => {
        const nextInstalling = { ...state.installing };
        delete nextInstalling[installKey];
        return { installing: nextInstalling };
      });
    }
  },

  uninstallSkill: async (slug: string, sourceId?: string) => {
    const installKey = sourceId ? `${sourceId}:${slug}` : slug;
    set((state) => ({ installing: { ...state.installing, [installKey]: true } }));
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/uninstall', {
        method: 'POST',
        body: JSON.stringify({ slug, sourceId }),
      });
      if (!result.success) {
        throw new Error(result.error || 'Uninstall failed');
      }
      await get().fetchSkills(true);
      await get().fetchMarketInstalledSkills();
    } finally {
      set((state) => {
        const nextInstalling = { ...state.installing };
        delete nextInstalling[installKey];
        return { installing: nextInstalling };
      });
    }
  },

  enableSkill: async (skillId: string) => {
    const currentSkills = Array.isArray(get().skills) ? get().skills : [];
    const previousSkill = currentSkills.find((skill) => skill.id === skillId);
    const previousDetail = get().skillDetailsById[skillId];

    const applyOptimistic = (enabled: boolean) => {
      set((state) => ({
        skills: state.skills.map((skill) => (
          skill.id === skillId
            ? {
                ...skill,
                enabled,
                ready: enabled ? (skill.missing ? false : true) : false,
              }
            : skill
        )),
        skillDetailsById: state.skillDetailsById[skillId]
          ? {
              ...state.skillDetailsById,
              [skillId]: {
                ...state.skillDetailsById[skillId],
                status: {
                  ...state.skillDetailsById[skillId].status,
                  enabled,
                },
              },
            }
          : state.skillDetailsById,
      }));
    };

    applyOptimistic(true);
    set((state) => ({
      toggleTargets: { ...state.toggleTargets, [skillId]: true },
    }));

    if (get().toggling[skillId]) return;

    set((state) => ({ toggling: { ...state.toggling, [skillId]: true } }));
    await new Promise((resolve) => setTimeout(resolve, SKILL_TOGGLE_DEBOUNCE_MS));

    try {
      while (true) {
        const targetEnabled = get().toggleTargets[skillId];
        if (targetEnabled === undefined) break;

        await useGatewayStore.getState().rpc('skills.update', { skillKey: skillId, enabled: targetEnabled });
        await get().fetchSkills(true);
        if (previousDetail) {
          const detail = await get().fetchSkillDetail(skillId, true);
          set((state) => ({
            skillDetailsById: {
              ...state.skillDetailsById,
              [skillId]: detail,
            },
          }));
        }

        if (get().toggleTargets[skillId] === targetEnabled) {
          set((state) => {
            const nextTargets = { ...state.toggleTargets };
            delete nextTargets[skillId];
            return { toggleTargets: nextTargets };
          });
          break;
        }
      }
    } catch (error) {
      if (previousSkill || previousDetail) {
        set((state) => ({
          skills: previousSkill
            ? state.skills.map((skill) => (skill.id === skillId ? previousSkill : skill))
            : state.skills,
          skillDetailsById: previousDetail
            ? {
                ...state.skillDetailsById,
                [skillId]: previousDetail,
              }
            : state.skillDetailsById,
        }));
      }
      set((state) => {
        const nextTargets = { ...state.toggleTargets };
        delete nextTargets[skillId];
        return { toggleTargets: nextTargets };
      });
      throw error;
    } finally {
      set((state) => {
        const nextToggling = { ...state.toggling };
        delete nextToggling[skillId];
        return { toggling: nextToggling };
      });
    }
  },

  disableSkill: async (skillId: string) => {
    const currentSkills = Array.isArray(get().skills) ? get().skills : [];
    const previousSkill = currentSkills.find((skill) => skill.id === skillId);
    const previousDetail = get().skillDetailsById[skillId];

    const applyOptimistic = (enabled: boolean) => {
      set((state) => ({
        skills: state.skills.map((skill) => (
          skill.id === skillId
            ? {
                ...skill,
                enabled,
                ready: enabled ? (skill.missing ? false : true) : false,
              }
            : skill
        )),
        skillDetailsById: state.skillDetailsById[skillId]
          ? {
              ...state.skillDetailsById,
              [skillId]: {
                ...state.skillDetailsById[skillId],
                status: {
                  ...state.skillDetailsById[skillId].status,
                  enabled,
                },
              },
            }
          : state.skillDetailsById,
      }));
    };

    applyOptimistic(false);
    set((state) => ({
      toggleTargets: { ...state.toggleTargets, [skillId]: false },
    }));

    if (get().toggling[skillId]) return;

    set((state) => ({ toggling: { ...state.toggling, [skillId]: true } }));
    await new Promise((resolve) => setTimeout(resolve, SKILL_TOGGLE_DEBOUNCE_MS));

    try {
      while (true) {
        const targetEnabled = get().toggleTargets[skillId];
        if (targetEnabled === undefined) break;

        await useGatewayStore.getState().rpc('skills.update', { skillKey: skillId, enabled: targetEnabled });
        await get().fetchSkills(true);
        if (previousDetail) {
          const detail = await get().fetchSkillDetail(skillId, true);
          set((state) => ({
            skillDetailsById: {
              ...state.skillDetailsById,
              [skillId]: detail,
            },
          }));
        }

        if (get().toggleTargets[skillId] === targetEnabled) {
          set((state) => {
            const nextTargets = { ...state.toggleTargets };
            delete nextTargets[skillId];
            return { toggleTargets: nextTargets };
          });
          break;
        }
      }
    } catch (error) {
      if (previousSkill || previousDetail) {
        set((state) => ({
          skills: previousSkill
            ? state.skills.map((skill) => (skill.id === skillId ? previousSkill : skill))
            : state.skills,
          skillDetailsById: previousDetail
            ? {
                ...state.skillDetailsById,
                [skillId]: previousDetail,
              }
            : state.skillDetailsById,
        }));
      }
      set((state) => {
        const nextTargets = { ...state.toggleTargets };
        delete nextTargets[skillId];
        return { toggleTargets: nextTargets };
      });
      throw error;
    } finally {
      set((state) => {
        const nextToggling = { ...state.toggling };
        delete nextToggling[skillId];
        return { toggling: nextToggling };
      });
    }
  },

  updateSkill: (skillId, updates) => {
    set((state) => ({
      skills: state.skills.map((skill) => (
        skill.id === skillId ? { ...skill, ...updates } : skill
      )),
    }));
  },
}));
