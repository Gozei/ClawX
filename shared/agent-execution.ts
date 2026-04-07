export interface SharedWorkflowNode {
  type?: string | null;
  title?: string | null;
  target?: string | null;
  onFailure?: string | null;
  inputSpec?: string | null;
  outputSpec?: string | null;
  modelRef?: string | null;
  code?: string | null;
}

export interface SharedAgentExecutionConfig {
  id: string;
  name: string;
  profileType?: string | null;
  description?: string | null;
  objective?: string | null;
  boundaries?: string | null;
  outputContract?: string | null;
  modelRef?: string | null;
  skillIds?: string[] | null;
  triggerModes?: string[] | null;
  workflowNodes?: SharedWorkflowNode[] | null;
}

export interface NormalizedSharedWorkflowNode {
  type: string;
  title: string;
  target?: string;
  onFailure?: string;
  inputSpec?: string;
  outputSpec?: string;
  modelRef?: string;
  code?: string;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeSharedWorkflowNodes(nodes: SharedAgentExecutionConfig['workflowNodes']): NormalizedSharedWorkflowNode[] {
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((node) => {
      const title = normalizeText(node?.title);
      if (!title) return null;
      return {
        type: normalizeText(node?.type) || 'instruction',
        title,
        ...(normalizeText(node?.target) ? { target: normalizeText(node?.target)! } : {}),
        ...(normalizeText(node?.onFailure) ? { onFailure: normalizeText(node?.onFailure)! } : {}),
        ...(normalizeText(node?.inputSpec) ? { inputSpec: normalizeText(node?.inputSpec)! } : {}),
        ...(normalizeText(node?.outputSpec) ? { outputSpec: normalizeText(node?.outputSpec)! } : {}),
        ...(normalizeText(node?.modelRef) ? { modelRef: normalizeText(node?.modelRef)! } : {}),
        ...(normalizeText(node?.code) ? { code: normalizeText(node?.code)! } : {}),
      };
    })
    .filter((node): node is NormalizedSharedWorkflowNode => Boolean(node));
}

export function buildSharedExecutionPlan(workflow: NormalizedSharedWorkflowNode[]) {
  if (workflow.length === 0) return undefined;

  const downstreamAgents = workflow
    .filter((node) => node.type === 'agent' && node.target)
    .map((node) => node.target as string);
  const skillTargets = workflow
    .filter((node) => node.type === 'skill' && node.target)
    .map((node) => node.target as string);
  const modelOverrides = workflow
    .map((node) => node.modelRef || (node.type === 'model' ? node.target : undefined))
    .filter((value): value is string => Boolean(value));

  return {
    stepCount: workflow.length,
    downstreamAgents: downstreamAgents.length > 0 ? downstreamAgents : undefined,
    skills: skillTargets.length > 0 ? skillTargets : undefined,
    modelOverrides: modelOverrides.length > 0 ? modelOverrides : undefined,
    chain: workflow.map((node, index) => ({
      index: index + 1,
      type: node.type,
      title: node.title,
      ...(node.target ? { target: node.target } : {}),
      ...(node.inputSpec ? { input: node.inputSpec } : {}),
      ...(node.outputSpec ? { output: node.outputSpec } : {}),
      ...(node.modelRef ? { model: node.modelRef } : {}),
      ...(node.onFailure ? { onFailure: node.onFailure } : {}),
    })),
  };
}

function stepAction(node: NormalizedSharedWorkflowNode): string {
  if (node.type === 'skill') {
    return node.target ? `调用技能 "${node.target}"` : '调用已装配技能';
  }
  if (node.type === 'model') {
    return node.target ? `调用模型 "${node.target}"` : '调用当前模型';
  }
  if (node.type === 'channel') {
    return node.target ? `输出到渠道 "${node.target}"` : '输出到已绑定渠道';
  }
  if (node.type === 'agent') {
    return node.target ? `委派给智能体 "${node.target}"` : '委派给下游智能体';
  }
  return '执行说明步骤';
}

export function buildSharedExecutionPlaybook(agent: SharedAgentExecutionConfig): string[] {
  const normalizedDescription = normalizeText(agent.description);
  const normalizedObjective = normalizeText(agent.objective);
  const normalizedBoundaries = normalizeText(agent.boundaries);
  const normalizedOutputContract = normalizeText(agent.outputContract);
  const normalizedSkills = Array.isArray(agent.skillIds)
    ? agent.skillIds.map((skill) => normalizeText(skill)).filter((skill): skill is string => Boolean(skill))
    : [];
  const normalizedTriggers = Array.isArray(agent.triggerModes)
    ? agent.triggerModes.map((mode) => normalizeText(mode)).filter((mode): mode is string => Boolean(mode))
    : [];
  const workflow = normalizeSharedWorkflowNodes(agent.workflowNodes);
  const rules: string[] = [];

  rules.push(`你当前扮演的智能体是 "${agent.name}"（ID: ${agent.id}）。`);
  if (normalizeText(agent.profileType)) {
    rules.push(`智能体类型：${normalizeText(agent.profileType)}。`);
  }
  if (normalizedDescription) {
    rules.push(`角色说明：${normalizedDescription}`);
  }
  if (normalizedObjective) {
    rules.push(`业务目标：${normalizedObjective}`);
  }
  if (normalizedBoundaries) {
    rules.push(`执行边界：${normalizedBoundaries}`);
  }
  if (normalizedOutputContract) {
    rules.push(`输出要求：${normalizedOutputContract}`);
  }
  if (normalizeText(agent.modelRef)) {
    rules.push(`优先模型：${normalizeText(agent.modelRef)}`);
  }
  if (normalizedSkills.length > 0) {
    rules.push(`仅优先使用这些已装配技能：${normalizedSkills.join('、')}。`);
  }
  if (normalizedTriggers.length > 0) {
    rules.push(`允许的触发方式：${normalizedTriggers.join('、')}。`);
  }

  if (workflow.length > 0) {
    rules.push('请严格按以下业务流程推进，除非用户明确要求偏离流程：');
    for (const [index, node] of workflow.entries()) {
      const fragments = [`${index + 1}. ${node.title}`];
      fragments.push(`动作：${stepAction(node)}。`);
      if (node.inputSpec) fragments.push(`标准输入：${node.inputSpec}。`);
      if (node.outputSpec) fragments.push(`标准输出：${node.outputSpec}。`);
      if (node.modelRef) fragments.push(`步骤模型：${node.modelRef}。`);
      if (node.onFailure && node.onFailure !== 'continue') fragments.push(`失败策略：${node.onFailure}。`);
      if (node.code) fragments.push(`步骤说明/代码：${node.code}。`);
      rules.push(fragments.join(' '));
    }
    rules.push('执行时请尽量保留每一步的中间结果名称，并把上一步输出传给下一步。');
  }

  rules.push('如果现有技能、模型或渠道不足以完成流程，请明确指出卡点，不要伪造执行结果。');
  return rules;
}
