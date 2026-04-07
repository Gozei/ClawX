export interface AgentWorkflowNode {
  id: string;
  type: 'instruction' | 'skill' | 'model' | 'channel' | 'agent';
  title: string;
  target?: string | null;
  onFailure?: 'continue' | 'retry' | 'handoff';
  inputSpec?: string | null;
  outputSpec?: string | null;
  modelRef?: string | null;
  code?: string | null;
}

export type AgentProfileType = 'specialist' | 'executor' | 'coordinator';

export interface AgentSummary {
  id: string;
  name: string;
  profileType?: AgentProfileType | null;
  isDefault: boolean;
  modelDisplay: string;
  modelRef?: string | null;
  overrideModelRef?: string | null;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
  skillIds: string[];
  workflowSteps: string[];
  workflowNodes?: AgentWorkflowNode[];
  triggerModes: string[];
  description?: string | null;
  objective?: string | null;
  boundaries?: string | null;
  outputContract?: string | null;
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef?: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
}
