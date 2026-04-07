import type { AgentSummary, AgentWorkflowNode } from '@/types/agent';
import {
  buildSharedExecutionPlan,
  buildSharedExecutionPlaybook,
  normalizeSharedWorkflowNodes,
} from '../../shared/agent-execution';

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function buildAgentExecutionPayload(agent: AgentSummary) {
  const description = normalizeText(agent.description);
  const skillIds = Array.isArray(agent.skillIds) ? agent.skillIds.filter(Boolean) : [];
  const triggerModes = Array.isArray(agent.triggerModes) ? agent.triggerModes.filter(Boolean) : [];
  const workflow = normalizeSharedWorkflowNodes(agent.workflowNodes);
  const playbook = buildSharedExecutionPlaybook(agent);

  if (!description && skillIds.length === 0 && triggerModes.length === 0 && workflow.length === 0) {
    return null;
  }

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      ...(normalizeText(agent.profileType) ? { profileType: normalizeText(agent.profileType)! } : {}),
      ...(description ? { description } : {}),
      ...(normalizeText(agent.objective) ? { objective: normalizeText(agent.objective)! } : {}),
      ...(normalizeText(agent.boundaries) ? { boundaries: normalizeText(agent.boundaries)! } : {}),
      ...(normalizeText(agent.outputContract) ? { outputContract: normalizeText(agent.outputContract)! } : {}),
      ...(normalizeText(agent.modelRef) ? { preferredModel: normalizeText(agent.modelRef)! } : {}),
      ...(skillIds.length > 0 ? { allowedSkills: skillIds } : {}),
      ...(triggerModes.length > 0 ? { triggerModes } : {}),
      ...(workflow.length > 0 ? { workflow } : {}),
      ...(workflow.length > 0 ? { executionPlan: buildSharedExecutionPlan(workflow) } : {}),
      ...(playbook.length > 0 ? { playbook } : {}),
    },
  };
}

export function buildAgentExecutionMetadata(agent: AgentSummary): string | null {
  const payload = buildAgentExecutionPayload(agent);
  if (!payload) return null;
  const playbook = buildSharedExecutionPlaybook(agent);
  const playbookSection = playbook.length > 0
    ? `Execution playbook:\n${playbook.map((line) => `- ${line}`).join('\n')}\n\n`
    : '';
  return `Conversation info (untrusted metadata): \`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n${playbookSection}`;
}

export function summarizeWorkflowNode(node: AgentWorkflowNode): string {
  const parts = [node.title];
  if (node.target) parts.push(node.target);
  if (node.modelRef) parts.push(`model:${node.modelRef}`);
  return parts.join(' · ');
}
