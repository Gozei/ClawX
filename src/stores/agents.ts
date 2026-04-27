import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { confirmGatewayImpact } from '@/lib/gateway-impact-confirm';
import type { ChannelType } from '@/types/channel';
import type { AgentProfileType, AgentSummary, AgentsSnapshot, AgentWorkflowNode } from '@/types/agent';
import { guardGatewayTransitioning } from './gateway';

interface AgentsState {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
  loading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  createAgent: (
    name: string,
    options?: {
      inheritWorkspace?: boolean;
      studio?: {
        profileType?: AgentProfileType | null;
        description?: string | null;
        objective?: string | null;
        boundaries?: string | null;
        outputContract?: string | null;
      };
    }
  ) => Promise<boolean>;
  updateAgent: (agentId: string, name: string) => Promise<boolean>;
  updateAgentModel: (
    agentId: string,
    modelRef: string | null,
    options?: {
      setAsDefault?: boolean;
    }
  ) => Promise<boolean>;
  updateAgentStudio: (
    agentId: string,
    payload: {
      profileType?: AgentProfileType | null;
      description?: string | null;
      objective?: string | null;
      boundaries?: string | null;
      outputContract?: string | null;
      skillIds?: string[];
      workflowSteps?: string[];
      workflowNodes?: AgentWorkflowNode[];
      triggerModes?: string[];
    }
  ) => Promise<boolean>;
  deleteAgent: (agentId: string) => Promise<boolean>;
  assignChannel: (agentId: string, channelType: ChannelType) => Promise<boolean>;
  removeChannel: (agentId: string, channelType: ChannelType) => Promise<boolean>;
  clearError: () => void;
}

function applySnapshot(snapshot: AgentsSnapshot | undefined) {
  return snapshot ? {
    agents: snapshot.agents ?? [],
    defaultAgentId: snapshot.defaultAgentId ?? 'main',
    defaultModelRef: snapshot.defaultModelRef ?? null,
    configuredChannelTypes: snapshot.configuredChannelTypes ?? [],
    channelOwners: snapshot.channelOwners ?? {},
    channelAccountOwners: snapshot.channelAccountOwners ?? {},
  } : {};
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  defaultAgentId: 'main',
  defaultModelRef: null,
  configuredChannelTypes: [],
  channelOwners: {},
  channelAccountOwners: {},
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents');
      set({
        ...applySnapshot(snapshot),
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  createAgent: async (
    name: string,
    options?: {
      inheritWorkspace?: boolean;
      studio?: {
        profileType?: AgentProfileType | null;
        description?: string | null;
        objective?: string | null;
        boundaries?: string | null;
        outputContract?: string | null;
      };
    },
  ) => {
    if (guardGatewayTransitioning()) return false;
    const confirmed = await confirmGatewayImpact({
      mode: 'refresh',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents', {
        method: 'POST',
        body: JSON.stringify({
          name,
          inheritWorkspace: options?.inheritWorkspace,
          studio: options?.studio,
        }),
      });
      set(applySnapshot(snapshot));
      return true;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgent: async (agentId: string, name: string) => {
    if (guardGatewayTransitioning()) return false;
    const confirmed = await confirmGatewayImpact({
      mode: 'refresh',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ name }),
        }
      );
      set(applySnapshot(snapshot));
      return true;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgentModel: async (
    agentId: string,
    modelRef: string | null,
    options?: {
      setAsDefault?: boolean;
    },
  ) => {
    if (guardGatewayTransitioning()) return false;
    const confirmed = await confirmGatewayImpact({
      mode: 'refresh',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/model`,
        {
          method: 'PUT',
          body: JSON.stringify({
            modelRef,
            setAsDefault: options?.setAsDefault === true,
          }),
        }
      );
      set(applySnapshot(snapshot));
      return true;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgentStudio: async (
    agentId: string,
    payload: {
      profileType?: AgentProfileType | null;
      description?: string | null;
      objective?: string | null;
      boundaries?: string | null;
      outputContract?: string | null;
      skillIds?: string[];
      workflowSteps?: string[];
      workflowNodes?: AgentWorkflowNode[];
      triggerModes?: string[];
    },
  ) => {
    if (guardGatewayTransitioning()) return false;
    const confirmed = await confirmGatewayImpact({
      mode: 'refresh',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/studio`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        }
      );
      set(applySnapshot(snapshot));
      return true;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteAgent: async (agentId: string) => {
    if (guardGatewayTransitioning()) return false;
    const confirmed = await confirmGatewayImpact({
      mode: 'restart',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}`,
        { method: 'DELETE' }
      );
      set(applySnapshot(snapshot));
      return true;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  assignChannel: async (agentId: string, channelType: ChannelType) => {
    if (guardGatewayTransitioning()) return false;
    const confirmed = await confirmGatewayImpact({
      mode: 'refresh',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channelType)}`,
        { method: 'PUT' }
      );
      set(applySnapshot(snapshot));
      return true;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  removeChannel: async (agentId: string, channelType: ChannelType) => {
    if (guardGatewayTransitioning()) return false;
    const confirmed = await confirmGatewayImpact({
      mode: 'refresh',
      willApplyChanges: true,
    });
    if (!confirmed) {
      return false;
    }
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channelType)}`,
        { method: 'DELETE' }
      );
      set(applySnapshot(snapshot));
      return true;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
