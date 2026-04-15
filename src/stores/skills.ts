import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { AppError, normalizeAppError } from '@/lib/error-model';
import { useGatewayStore } from './gateway';
import type { MarketplaceSkill, SkillDetail, SkillSnapshot, SkillSource } from '../types/skill';

function mapErrorCodeToSkillErrorKey(
  code: AppError['code'],
  operation: 'fetch' | 'search' | 'install',
): string {
  if (code === 'TIMEOUT') {
    return operation === 'search'
      ? 'searchTimeoutError'
      : operation === 'install'
        ? 'installTimeoutError'
        : 'fetchTimeoutError';
  }
  if (code === 'RATE_LIMIT') {
    return operation === 'search'
      ? 'searchRateLimitError'
      : operation === 'install'
        ? 'installRateLimitError'
        : 'fetchRateLimitError';
  }
  return 'rateLimitError';
}

interface SkillsState {
  skills: SkillSnapshot[];
  skillDetailsById: Record<string, SkillDetail>;
  searchResults: MarketplaceSkill[];
  sources: SkillSource[];
  loading: boolean;
  refreshing: boolean;
  searching: boolean;
  detailLoadingId: string | null;
  searchError: string | null;
  installing: Record<string, boolean>;
  deleting: Record<string, boolean>;
  error: string | null;
  lastFetchedAt: number | null;

  fetchSkills: (force?: boolean) => Promise<void>;
  fetchSources: () => Promise<SkillSource[]>;
  fetchSkillDetail: (skillId: string, force?: boolean) => Promise<SkillDetail>;
  saveSkillConfig: (skillId: string, input: { apiKey?: string; env?: Record<string, string> }) => Promise<void>;
  deleteSkill: (skillId: string) => Promise<void>;
  searchSkills: (query: string, sourceId?: string) => Promise<void>;
  installSkill: (slug: string, version?: string, sourceId?: string) => Promise<void>;
  uninstallSkill: (slug: string, sourceId?: string) => Promise<void>;
  enableSkill: (skillId: string) => Promise<void>;
  disableSkill: (skillId: string) => Promise<void>;
  updateSkill: (skillId: string, updates: Partial<SkillSnapshot>) => void;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  skillDetailsById: {},
  searchResults: [],
  sources: [],
  loading: false,
  refreshing: false,
  searching: false,
  detailLoadingId: null,
  searchError: null,
  installing: {},
  deleting: {},
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

  fetchSkills: async (force = false) => {
    const existingSkills = get().skills;
    const lastFetchedAt = get().lastFetchedAt;
    if (!force && existingSkills.length > 0 && lastFetchedAt && Date.now() - lastFetchedAt < 15_000) {
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
        skills,
        loading: false,
        refreshing: false,
        lastFetchedAt: Date.now(),
      });
    } catch (error) {
      const appError = normalizeAppError(error, { module: 'skills', operation: 'fetch' });
      set({ loading: false, refreshing: false, error: mapErrorCodeToSkillErrorKey(appError.code, 'fetch') });
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

  searchSkills: async (query: string, sourceId?: string) => {
    set({ searching: true, searchError: null });
    try {
      const result = await hostApiFetch<{ success: boolean; results?: MarketplaceSkill[]; error?: string }>('/api/clawhub/search', {
        method: 'POST',
        body: JSON.stringify({ query, ...(sourceId ? { sourceId } : { allSources: true }) }),
      });
      if (result.success) {
        set({ searchResults: result.results || [] });
      } else {
        throw normalizeAppError(new Error(result.error || 'Search failed'), {
          module: 'skills',
          operation: 'search',
        });
      }
    } catch (error) {
      const appError = normalizeAppError(error, { module: 'skills', operation: 'search' });
      set({ searchError: mapErrorCodeToSkillErrorKey(appError.code, 'search') });
    } finally {
      set({ searching: false });
    }
  },

  installSkill: async (slug: string, version?: string, sourceId?: string) => {
    const installKey = sourceId ? `${sourceId}:${slug}` : slug;
    set((state) => ({ installing: { ...state.installing, [installKey]: true } }));
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/install', {
        method: 'POST',
        body: JSON.stringify({ slug, version, sourceId }),
      });
      if (!result.success) {
        const appError = normalizeAppError(new Error(result.error || 'Install failed'), {
          module: 'skills',
          operation: 'install',
        });
        throw new Error(mapErrorCodeToSkillErrorKey(appError.code, 'install'));
      }
      await get().fetchSkills(true);
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
    } finally {
      set((state) => {
        const nextInstalling = { ...state.installing };
        delete nextInstalling[installKey];
        return { installing: nextInstalling };
      });
    }
  },

  enableSkill: async (skillId: string) => {
    await useGatewayStore.getState().rpc('skills.update', { skillKey: skillId, enabled: true });
    await get().fetchSkills(true);
    if (get().skillDetailsById[skillId]) {
      const detail = await get().fetchSkillDetail(skillId, true);
      set((state) => ({
        skillDetailsById: {
          ...state.skillDetailsById,
          [skillId]: detail,
        },
      }));
    }
  },

  disableSkill: async (skillId: string) => {
    await useGatewayStore.getState().rpc('skills.update', { skillKey: skillId, enabled: false });
    await get().fetchSkills(true);
    if (get().skillDetailsById[skillId]) {
      const detail = await get().fetchSkillDetail(skillId, true);
      set((state) => ({
        skillDetailsById: {
          ...state.skillDetailsById,
          [skillId]: detail,
        },
      }));
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
