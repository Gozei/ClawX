import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { AppError, normalizeAppError } from '@/lib/error-model';
import { useGatewayStore } from './gateway';
import type { SkillSnapshot, SkillConfigDetail, MarketplaceSkill, SkillSource } from '../types/skill';

type GatewaySkillStatus = {
  skillKey: string;
  slug?: string;
  name?: string;
  description?: string;
  disabled?: boolean;
  emoji?: string;
  version?: string;
  author?: string;
  bundled?: boolean;
  always?: boolean;
  source?: string;
  baseDir?: string;
  filePath?: string;
  ready?: boolean;
  missing?: string[];
  homepage?: string;
};

type GatewaySkillsStatusResult = {
  skills?: GatewaySkillStatus[];
};

type ClawHubListResult = {
  slug: string;
  version?: string;
  source?: string;
  baseDir?: string;
  sourceId?: string;
  sourceLabel?: string;
};

function normalizePathForCompare(input: string | undefined): string | null {
  if (!input) return null;
  return input.replace(/\//g, '\\').toLowerCase();
}

function inferSource(baseDir: string | undefined, sources: SkillSource[]): SkillSource | undefined {
  const normalizedBaseDir = normalizePathForCompare(baseDir);
  if (!normalizedBaseDir) return undefined;
  return sources.find((source) => {
    const root = normalizePathForCompare(`${source.workdir}\\skills`);
    return Boolean(root) && (normalizedBaseDir === root || normalizedBaseDir.startsWith(`${root}\\`));
  });
}

function inferSourceId(baseDir: string | undefined, sources: SkillSource[]): string | undefined {
  return inferSource(baseDir, sources)?.id;
}

function inferSourceLabel(baseDir: string | undefined, sources: SkillSource[]): string | undefined {
  return inferSource(baseDir, sources)?.label;
}

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
  skillConfigById: Record<string, SkillConfigDetail>;
  searchResults: MarketplaceSkill[];
  sources: SkillSource[];
  loading: boolean;
  refreshing: boolean;
  searching: boolean;
  searchError: string | null;
  installing: Record<string, boolean>; // slug -> boolean
  error: string | null;
  lastFetchedAt: number | null;

  // Actions
  fetchSkills: () => Promise<void>;
  fetchSources: () => Promise<SkillSource[]>;
  fetchSkillConfig: (skillId: string) => Promise<SkillConfigDetail>;
  searchSkills: (query: string, sourceId?: string) => Promise<void>;
  installSkill: (slug: string, version?: string, sourceId?: string) => Promise<void>;
  uninstallSkill: (slug: string, sourceId?: string) => Promise<void>;
  enableSkill: (skillId: string) => Promise<void>;
  disableSkill: (skillId: string) => Promise<void>;
  setSkills: (skills: SkillSnapshot[]) => void;
  updateSkill: (skillId: string, updates: Partial<SkillSnapshot>) => void;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  skillConfigById: {},
  searchResults: [],
  sources: [],
  loading: false,
  refreshing: false,
  searching: false,
  searchError: null,
  installing: {},
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

  fetchSkills: async () => {
    const existingSkills = get().skills;
    const lastFetchedAt = get().lastFetchedAt;
    if (existingSkills.length > 0 && lastFetchedAt && Date.now() - lastFetchedAt < 15_000) {
      return;
    }

    if (existingSkills.length === 0) {
      set({ loading: true, refreshing: false, error: null });
    } else {
      set({ refreshing: true, error: null });
    }
    try {
      const sources = await get().fetchSources();
      const gatewayData = await useGatewayStore.getState().rpc<GatewaySkillsStatusResult>('skills.status');
      
      let snapshots: SkillSnapshot[] = [];
      const currentSkills = get().skills;

      if (gatewayData.skills) {
        snapshots = gatewayData.skills.map((s: GatewaySkillStatus) => ({
          id: s.skillKey,
          slug: s.slug || s.skillKey,
          name: s.name || s.skillKey,
          description: s.description || '',
          enabled: !s.disabled,
          icon: s.emoji || '📦',
          version: s.version || '1.0.0',
          author: s.author,
          isCore: s.bundled && s.always,
          isBundled: s.bundled,
          source: s.source,
          baseDir: s.baseDir,
          filePath: s.filePath,
          ready: s.ready,
          missing: s.missing,
          homepage: s.homepage,
          installed: true,
          sourceId: inferSourceId(s.baseDir, sources),
          sourceLabel: inferSourceLabel(s.baseDir, sources),
        }));
      } else if (currentSkills.length > 0) {
        snapshots = [...currentSkills];
      }

      set({
        skills: snapshots,
        loading: false,
        refreshing: false,
        lastFetchedAt: Date.now(),
      });

      // Optionally fetch clawhub:list to supplement "just installed" skills that aren't picked up by runtime yet.
      const clawhubResult = await hostApiFetch<{ success: boolean; results?: ClawHubListResult[]; error?: string }>('/api/clawhub/list');
      
      if (clawhubResult.success && clawhubResult.results) {
        const enrichedSkills = [...snapshots];
        let hasChanges = false;

        clawhubResult.results.forEach((cs: ClawHubListResult) => {
          const existing = enrichedSkills.find(s => s.id === cs.slug);
          if (existing) {
            if (!existing.baseDir && cs.baseDir) {
              existing.baseDir = cs.baseDir;
              hasChanges = true;
            }
            if (!existing.source && cs.source) {
              existing.source = cs.source;
              hasChanges = true;
            }
            if (!existing.sourceId && cs.sourceId) {
              existing.sourceId = cs.sourceId;
              existing.sourceLabel = cs.sourceLabel;
              hasChanges = true;
            }
            return;
          }
          
          hasChanges = true;
          enrichedSkills.push({
            id: cs.slug,
            slug: cs.slug,
            name: cs.slug,
            description: 'Recently installed, initializing...',
            enabled: false,
            icon: '⌛',
            version: cs.version || 'unknown',
            author: undefined,
            isCore: false,
            isBundled: false,
            source: cs.source || 'openclaw-managed',
            baseDir: cs.baseDir,
            installed: true,
            ready: false,
            sourceId: cs.sourceId,
            sourceLabel: cs.sourceLabel,
          });
        });

        if (hasChanges) {
          set({ skills: enrichedSkills, lastFetchedAt: Date.now() });
        }
      }
    } catch (error) {
      console.error('Failed to fetch skills:', error);
      const appError = normalizeAppError(error, { module: 'skills', operation: 'fetch' });
      set({ loading: false, refreshing: false, error: mapErrorCodeToSkillErrorKey(appError.code, 'fetch') });
    }
  },

  fetchSkillConfig: async (skillId: string): Promise<SkillConfigDetail> => {
    try {
      const configMap = await hostApiFetch<Record<string, { apiKey?: string; env?: Record<string, string>; config?: Record<string, unknown> }>>('/api/skills/configs');
      const skill = get().skills.find(s => s.id === skillId);
      const slug = skill?.slug;
      
      const configData = configMap[skillId] || (slug ? configMap[slug] : undefined) || {};
      
      const detail: SkillConfigDetail = {
        id: skillId,
        apiKey: configData.apiKey,
        env: configData.env,
        config: configData.config,
      };

      set((state) => ({
        skillConfigById: {
          ...state.skillConfigById,
          [skillId]: detail,
        }
      }));

      return detail;
    } catch (error) {
      console.error(`Failed to fetch config for skill ${skillId}:`, error);
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
      // Refresh skills after install
      await get().fetchSkills();
    } catch (error) {
      console.error('Install error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.installing };
        delete newInstalling[installKey];
        return { installing: newInstalling };
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
      // Refresh skills after uninstall
      await get().fetchSkills();
    } catch (error) {
      console.error('Uninstall error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.installing };
        delete newInstalling[installKey];
        return { installing: newInstalling };
      });
    }
  },

  enableSkill: async (skillId) => {
    const { updateSkill } = get();

    try {
      await useGatewayStore.getState().rpc('skills.update', { skillKey: skillId, enabled: true });
      updateSkill(skillId, { enabled: true });
    } catch (error) {
      console.error('Failed to enable skill:', error);
      throw error;
    }
  },

  disableSkill: async (skillId) => {
    const { updateSkill, skills } = get();

    const skill = skills.find((s) => s.id === skillId);
    if (skill?.isCore) {
      throw new Error('Cannot disable core skill');
    }

    try {
      await useGatewayStore.getState().rpc('skills.update', { skillKey: skillId, enabled: false });
      updateSkill(skillId, { enabled: false });
    } catch (error) {
      console.error('Failed to disable skill:', error);
      throw error;
    }
  },

  setSkills: (skills) => set({ skills }),

  updateSkill: (skillId, updates) => {
    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.id === skillId ? { ...skill, ...updates } : skill
      ),
    }));
  },
}));
