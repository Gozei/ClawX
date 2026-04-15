import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { join, normalize } from 'path';
import { deleteAgentChannelAccounts, listConfiguredChannels, readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import { withConfigLock } from './config-mutex';
import { expandPath, getDataDir, getOpenClawConfigDir } from './paths';
import * as logger from './logger';
import { toUiChannelType } from './channel-alias';
import { mergeClawXSection } from './openclaw-workspace';
import { buildSharedExecutionPlaybook } from '../../shared/agent-execution';

const MAIN_AGENT_ID = 'main';
const MAIN_AGENT_NAME = 'Main Role';
const DEFAULT_ACCOUNT_ID = 'default';
const DEFAULT_WORKSPACE_PATH = '~/.openclaw/workspace';
const AGENT_BOOTSTRAP_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
  'BOOT.md',
];
const AGENT_RUNTIME_FILES = [
  'auth-profiles.json',
  'models.json',
];
const AGENT_STUDIO_CONTEXT_TITLE = '## Deep AI Worker Agent Studio';
const AGENT_STUDIO_METADATA_FILE = 'agent-studio.json';

interface AgentModelConfig {
  primary?: string;
  [key: string]: unknown;
}

interface AgentDefaultsConfig {
  workspace?: string;
  model?: string | AgentModelConfig;
  [key: string]: unknown;
}

interface AgentListEntry extends Record<string, unknown> {
  id: string;
  name?: string;
  default?: boolean;
  workspace?: string;
  agentDir?: string;
  model?: string | AgentModelConfig;
  studio?: AgentStudioConfig;
}

interface AgentsConfig extends Record<string, unknown> {
  defaults?: AgentDefaultsConfig;
  list?: AgentListEntry[];
}

interface AgentStudioConfig extends Record<string, unknown> {
  profileType?: string;
  description?: string;
  objective?: string;
  boundaries?: string;
  outputContract?: string;
  skillIds?: string[];
  workflowSteps?: string[];
  workflowNodes?: AgentWorkflowNode[];
  triggerModes?: string[];
}

interface AgentWorkflowNodeConfig extends Record<string, unknown> {
  id?: string;
  type?: string;
  title?: string;
  target?: string | null;
  onFailure?: string;
  inputSpec?: string | null;
  outputSpec?: string | null;
  modelRef?: string | null;
  code?: string | null;
}

interface BindingMatch extends Record<string, unknown> {
  channel?: string;
  accountId?: string;
}

interface BindingConfig extends Record<string, unknown> {
  agentId?: string;
  match?: BindingMatch;
}

interface ChannelSectionConfig extends Record<string, unknown> {
  accounts?: Record<string, Record<string, unknown>>;
  defaultAccount?: string;
  enabled?: boolean;
}

interface AgentConfigDocument extends Record<string, unknown> {
  models?: {
    providers?: Record<string, {
      models?: Array<{ id?: string | null }>;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  agents?: AgentsConfig;
  bindings?: BindingConfig[];
  channels?: Record<string, ChannelSectionConfig>;
  session?: {
    mainKey?: string;
    [key: string]: unknown;
  };
}

interface AgentStudioMetadataDocument extends Record<string, unknown> {
  agents?: Record<string, AgentStudioConfig>;
}

export interface AgentSummary {
  id: string;
  name: string;
  profileType?: 'specialist' | 'executor' | 'coordinator' | null;
  isDefault: boolean;
  modelDisplay: string;
  modelRef: string | null;
  overrideModelRef: string | null;
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

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
}

type PreparedAgentModelUpdate = {
  agentId: string;
  config: AgentConfigDocument;
  normalizedModelRef: string | null;
  snapshot: AgentsSnapshot;
  studioByAgentId: Record<string, AgentStudioConfig>;
  studioStateChanged: boolean;
};

type AgentModelUpdateOptions = {
  setAsDefault?: boolean;
};

interface AgentStudioUpdates {
  profileType?: string | null;
  description?: string | null;
  objective?: string | null;
  boundaries?: string | null;
  outputContract?: string | null;
  skillIds?: string[];
  workflowSteps?: string[];
  workflowNodes?: AgentWorkflowNode[];
  triggerModes?: string[];
}

function getAgentStudioMetadataPath(): string {
  return join(getDataDir(), AGENT_STUDIO_METADATA_FILE);
}

function resolveModelRef(model: unknown): string | null {
  if (typeof model === 'string' && model.trim()) {
    return model.trim();
  }

  if (model && typeof model === 'object') {
    const primary = (model as AgentModelConfig).primary;
    if (typeof primary === 'string' && primary.trim()) {
      return primary.trim();
    }
  }

  return null;
}

function formatModelLabel(model: unknown): string | null {
  const modelRef = resolveModelRef(model);
  if (modelRef) {
    const trimmed = modelRef;
    const parts = trimmed.split('/');
    return parts[parts.length - 1] || trimmed;
  }

  return null;
}

function normalizeAgentName(name: string): string {
  return name.trim() || 'Agent';
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean),
  ));
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeProfileType(value: unknown): AgentSummary['profileType'] {
  if (value === 'specialist' || value === 'executor' || value === 'coordinator') {
    return value;
  }
  return null;
}

function normalizeWorkflowNodes(value: unknown): AgentWorkflowNode[] {
  if (!Array.isArray(value)) return [];
  const normalized: AgentWorkflowNode[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') continue;
    const source = item as AgentWorkflowNodeConfig;
    const type = typeof source.type === 'string' ? source.type.trim() : '';
    const normalizedType = ['instruction', 'skill', 'model', 'channel', 'agent'].includes(type)
      ? type as AgentWorkflowNode['type']
      : 'instruction';
    const title = typeof source.title === 'string' ? source.title.trim() : '';
    if (!title) continue;
    const target = typeof source.target === 'string' ? source.target.trim() : '';
    const onFailure = typeof source.onFailure === 'string' ? source.onFailure.trim() : '';
    const inputSpec = typeof source.inputSpec === 'string' ? source.inputSpec.trim() : '';
    const outputSpec = typeof source.outputSpec === 'string' ? source.outputSpec.trim() : '';
    const modelRef = typeof source.modelRef === 'string' ? source.modelRef.trim() : '';
    const code = typeof source.code === 'string' ? source.code.trim() : '';
    const normalizedOnFailure = ['continue', 'retry', 'handoff'].includes(onFailure)
      ? onFailure as AgentWorkflowNode['onFailure']
      : 'continue';
    normalized.push({
      id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : `step-${index + 1}`,
      type: normalizedType,
      title,
      ...(target ? { target } : {}),
      onFailure: normalizedOnFailure,
      ...(inputSpec ? { inputSpec } : {}),
      ...(outputSpec ? { outputSpec } : {}),
      ...(modelRef ? { modelRef } : {}),
      ...(code ? { code } : {}),
    });
  }
  return normalized;
}

function summarizeWorkflowNode(node: AgentWorkflowNode): string {
  const targetSuffix = node.target ? ` · ${node.target}` : '';
  const modelSuffix = node.modelRef ? ` · model:${node.modelRef}` : '';
  return `${node.title}${targetSuffix}${modelSuffix}`;
}

function normalizeAgentStudio(studio: unknown): AgentStudioConfig {
  const source = studio && typeof studio === 'object' ? studio as AgentStudioConfig : {};
  const profileType = normalizeProfileType(source.profileType);
  const description = normalizeOptionalText(source.description);
  const objective = normalizeOptionalText(source.objective);
  const boundaries = normalizeOptionalText(source.boundaries);
  const outputContract = normalizeOptionalText(source.outputContract);
  const skillIds = normalizeStringList(source.skillIds);
  const workflowNodes = normalizeWorkflowNodes(source.workflowNodes);
  const workflowSteps = workflowNodes.length > 0
    ? workflowNodes.map(summarizeWorkflowNode)
    : normalizeStringList(source.workflowSteps);
  const triggerModes = normalizeStringList(source.triggerModes);
  return {
    ...(profileType ? { profileType } : {}),
    ...(description ? { description } : {}),
    ...(objective ? { objective } : {}),
    ...(boundaries ? { boundaries } : {}),
    ...(outputContract ? { outputContract } : {}),
    ...(skillIds.length > 0 ? { skillIds } : {}),
    ...(workflowSteps.length > 0 ? { workflowSteps } : {}),
    ...(workflowNodes.length > 0 ? { workflowNodes } : {}),
    ...(triggerModes.length > 0 ? { triggerModes } : {}),
  };
}

async function readAgentStudioMetadata(): Promise<Record<string, AgentStudioConfig>> {
  try {
    const raw = await readFile(getAgentStudioMetadataPath(), 'utf-8');
    const parsed = JSON.parse(raw) as AgentStudioMetadataDocument;
    const agents = parsed?.agents;
    if (!agents || typeof agents !== 'object' || Array.isArray(agents)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(agents)
        .filter(([agentId]) => typeof agentId === 'string' && agentId.trim())
        .map(([agentId, studio]) => [agentId, normalizeAgentStudio(studio)])
        .filter(([, studio]) => Object.keys(studio).length > 0),
    );
  } catch {
    return {};
  }
}

async function writeAgentStudioMetadata(studioByAgentId: Record<string, AgentStudioConfig>): Promise<void> {
  const normalizedEntries = Object.entries(studioByAgentId)
    .map(([agentId, studio]) => [agentId, normalizeAgentStudio(studio)] as const)
    .filter(([agentId, studio]) => agentId.trim() && Object.keys(studio).length > 0);

  const filePath = getAgentStudioMetadataPath();
  await ensureDir(getDataDir());

  if (normalizedEntries.length === 0) {
    if (await fileExists(filePath)) {
      await rm(filePath, { force: true });
    }
    return;
  }

  const document: AgentStudioMetadataDocument = {
    agents: Object.fromEntries(normalizedEntries),
  };
  await writeFile(filePath, JSON.stringify(document, null, 2), 'utf-8');
}

async function resolveAgentStudioState(config: AgentConfigDocument): Promise<{
  config: AgentConfigDocument;
  studioByAgentId: Record<string, AgentStudioConfig>;
  changed: boolean;
}> {
  const storedStudio = await readAgentStudioMetadata();
  const nextStudioByAgentId: Record<string, AgentStudioConfig> = { ...storedStudio };
  let changed = false;

  const agentsConfig = (config.agents && typeof config.agents === 'object'
    ? { ...(config.agents as AgentsConfig) }
    : undefined);

  if (agentsConfig && Array.isArray(agentsConfig.list)) {
    const seenAgentIds = new Set<string>();
    const nextList = agentsConfig.list.map((entry) => {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id.trim()) {
        return entry;
      }

      const agentId = entry.id.trim();
      seenAgentIds.add(agentId);
      const legacyStudio = normalizeAgentStudio((entry as AgentListEntry).studio);
      const sidecarStudio = normalizeAgentStudio(nextStudioByAgentId[agentId]);
      const effectiveStudio = Object.keys(sidecarStudio).length > 0 ? sidecarStudio : legacyStudio;

      if (Object.keys(effectiveStudio).length > 0) {
        const normalized = normalizeAgentStudio(effectiveStudio);
        if (JSON.stringify(sidecarStudio) !== JSON.stringify(normalized)) {
          nextStudioByAgentId[agentId] = normalized;
          changed = true;
        }
      } else if (agentId in nextStudioByAgentId) {
        delete nextStudioByAgentId[agentId];
        changed = true;
      }

      if ('studio' in entry) {
        const { studio: _studio, ...rest } = entry as AgentListEntry;
        changed = true;
        return rest;
      }

      return entry;
    });

    for (const agentId of Object.keys(nextStudioByAgentId)) {
      if (!seenAgentIds.has(agentId)) {
        delete nextStudioByAgentId[agentId];
        changed = true;
      }
    }

    config.agents = {
      ...agentsConfig,
      list: nextList as AgentListEntry[],
    };
  }

  return {
    config,
    studioByAgentId: nextStudioByAgentId,
    changed,
  };
}

function slugifyAgentId(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!normalized) return 'agent';
  if (normalized === MAIN_AGENT_ID) return 'agent';
  return normalized;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path: string): Promise<void> {
  if (!(await fileExists(path))) {
    await mkdir(path, { recursive: true });
  }
}

function renderAgentStudioContext(agent: AgentSummary): string {
  const lines: string[] = [
    AGENT_STUDIO_CONTEXT_TITLE,
    '',
    `- Agent ID: ${agent.id}`,
    `- Agent Name: ${agent.name}`,
    `- Preferred Model: ${agent.modelRef || 'inherit default model'}`,
  ];

  if (agent.description?.trim()) {
    lines.push(`- Role: ${agent.description.trim()}`);
  }
  if (agent.profileType) {
    lines.push(`- Agent Type: ${agent.profileType}`);
  }
  if (agent.objective?.trim()) {
    lines.push(`- Business Goal: ${agent.objective.trim()}`);
  }
  if (agent.boundaries?.trim()) {
    lines.push(`- Guardrails: ${agent.boundaries.trim()}`);
  }
  if (agent.outputContract?.trim()) {
    lines.push(`- Output Contract: ${agent.outputContract.trim()}`);
  }

  if (agent.channelTypes.length > 0) {
    lines.push(`- Bound Channels: ${agent.channelTypes.join(', ')}`);
  }

  if (agent.triggerModes.length > 0) {
    lines.push(`- Trigger Modes: ${agent.triggerModes.join(', ')}`);
  }

  if (agent.skillIds.length > 0) {
    lines.push(`- Enabled Skills: ${agent.skillIds.join(', ')}`);
  }

  if (agent.workflowNodes && agent.workflowNodes.length > 0) {
    lines.push('', '### Workflow');
    for (const [index, node] of agent.workflowNodes.entries()) {
      const parts = [
        `${index + 1}.`,
        `[${node.type}]`,
        node.title,
      ];
      if (node.target) {
        parts.push(`-> ${node.target}`);
      }
      if (node.inputSpec) {
        parts.push(`| input: ${node.inputSpec}`);
      }
      if (node.outputSpec) {
        parts.push(`| output: ${node.outputSpec}`);
      }
      if (node.modelRef) {
        parts.push(`| model: ${node.modelRef}`);
      }
      if (node.onFailure && node.onFailure !== 'continue') {
        parts.push(`(on failure: ${node.onFailure})`);
      }
      lines.push(parts.join(' '));
      if (node.code) {
        lines.push('   ```text');
        lines.push(`   ${node.code}`);
        lines.push('   ```');
      }
    }
  } else if (agent.workflowSteps.length > 0) {
    lines.push('', '### Workflow');
    for (const [index, step] of agent.workflowSteps.entries()) {
      lines.push(`${index + 1}. ${step}`);
    }
  }

  const playbook = buildSharedExecutionPlaybook({
    id: agent.id,
    name: agent.name,
    profileType: agent.profileType,
    description: agent.description,
    objective: agent.objective,
    boundaries: agent.boundaries,
    outputContract: agent.outputContract,
    modelRef: agent.modelRef,
    skillIds: agent.skillIds,
    triggerModes: agent.triggerModes,
    workflowNodes: agent.workflowNodes,
  });
  if (playbook.length > 0) {
    lines.push('', '### Execution Playbook');
    for (const rule of playbook) {
      lines.push(`- ${rule}`);
    }
  }

  lines.push(
    '',
    'Use this configuration as the operating context for this agent. Respect the selected skills, preferred model, and workflow when deciding how to act.',
  );

  return lines.join('\n');
}

async function syncAgentWorkspaceStudioContextFromConfig(
  config: AgentConfigDocument,
  agentId: string,
): Promise<void> {
  const snapshot = await buildSnapshotFromConfig(config);
  const agent = snapshot.agents.find((entry) => entry.id === agentId);
  if (!agent) return;

  const workspaceDir = expandPath(agent.workspace);
  const agentsFilePath = join(workspaceDir, 'AGENTS.md');
  await ensureDir(workspaceDir);

  const baseContent = await fileExists(agentsFilePath)
    ? await readFile(agentsFilePath, 'utf-8')
    : `# ${agent.name}\n\n`;

  const nextContent = mergeClawXSection(baseContent, renderAgentStudioContext(agent));
  if (nextContent !== baseContent) {
    await writeFile(agentsFilePath, nextContent, 'utf-8');
    logger.info('Synced agent studio context into workspace', { agentId, workspaceDir });
  }
}

export async function syncAllAgentWorkspaceStudioContexts(): Promise<void> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const snapshot = await buildSnapshotFromConfig(config);

  for (const agent of snapshot.agents) {
    const workspaceDir = expandPath(agent.workspace);
    const agentsFilePath = join(workspaceDir, 'AGENTS.md');
    await ensureDir(workspaceDir);

    const baseContent = await fileExists(agentsFilePath)
      ? await readFile(agentsFilePath, 'utf-8')
      : `# ${agent.name}\n\n`;

    const nextContent = mergeClawXSection(baseContent, renderAgentStudioContext(agent));
    if (nextContent !== baseContent) {
      await writeFile(agentsFilePath, nextContent, 'utf-8');
      logger.info('Synced agent studio context into workspace', { agentId: agent.id, workspaceDir });
    }
  }
}

function getDefaultWorkspacePath(config: AgentConfigDocument): string {
  const defaults = (config.agents && typeof config.agents === 'object'
    ? (config.agents as AgentsConfig).defaults
    : undefined);
  return typeof defaults?.workspace === 'string' && defaults.workspace.trim()
    ? defaults.workspace
    : DEFAULT_WORKSPACE_PATH;
}

function getDefaultAgentDirPath(agentId: string): string {
  return `~/.openclaw/agents/${agentId}/agent`;
}

function createImplicitMainEntry(config: AgentConfigDocument): AgentListEntry {
  return {
    id: MAIN_AGENT_ID,
    name: MAIN_AGENT_NAME,
    default: true,
    workspace: getDefaultWorkspacePath(config),
    agentDir: getDefaultAgentDirPath(MAIN_AGENT_ID),
  };
}

function normalizeAgentsConfig(config: AgentConfigDocument): {
  agentsConfig: AgentsConfig;
  entries: AgentListEntry[];
  defaultAgentId: string;
  syntheticMain: boolean;
} {
  const agentsConfig = (config.agents && typeof config.agents === 'object'
    ? { ...(config.agents as AgentsConfig) }
    : {}) as AgentsConfig;
  const rawEntries = Array.isArray(agentsConfig.list)
    ? agentsConfig.list.filter((entry): entry is AgentListEntry => (
      Boolean(entry) && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.trim().length > 0
    ))
    : [];

  if (rawEntries.length === 0) {
    const main = createImplicitMainEntry(config);
    return {
      agentsConfig,
      entries: [main],
      defaultAgentId: MAIN_AGENT_ID,
      syntheticMain: true,
    };
  }

  const defaultEntry = rawEntries.find((entry) => entry.default) ?? rawEntries[0];
  return {
    agentsConfig,
    entries: rawEntries.map((entry) => ({ ...entry })),
    defaultAgentId: defaultEntry.id,
    syntheticMain: false,
  };
}

function applyDefaultAgentSelection(entries: AgentListEntry[], defaultAgentId: string): AgentListEntry[] {
  return entries.map((entry) => {
    const nextEntry: AgentListEntry = { ...entry };
    if (entry.id === defaultAgentId) {
      nextEntry.default = true;
    } else {
      delete nextEntry.default;
    }
    return nextEntry;
  });
}

function isChannelBinding(binding: unknown): binding is BindingConfig {
  if (!binding || typeof binding !== 'object') return false;
  const candidate = binding as BindingConfig;
  if (typeof candidate.agentId !== 'string' || !candidate.agentId) return false;
  if (!candidate.match || typeof candidate.match !== 'object' || Array.isArray(candidate.match)) return false;
  if (typeof candidate.match.channel !== 'string' || !candidate.match.channel) return false;
  const keys = Object.keys(candidate.match);
  // Accept bindings with just {channel} or {channel, accountId}
  if (keys.length === 1 && keys[0] === 'channel') return true;
  if (keys.length === 2 && keys.includes('channel') && keys.includes('accountId')) return true;
  return false;
}

/** Normalize agent ID for consistent comparison (bindings vs entries). */
function normalizeAgentIdForBinding(id: string): string {
  return (id ?? '').trim().toLowerCase() || '';
}

function normalizeMainKey(value: unknown): string {
  if (typeof value !== 'string') return 'main';
  const trimmed = value.trim().toLowerCase();
  return trimmed || 'main';
}

function buildAgentMainSessionKey(config: AgentConfigDocument, agentId: string): string {
  return `agent:${normalizeAgentIdForBinding(agentId) || MAIN_AGENT_ID}:${normalizeMainKey(config.session?.mainKey)}`;
}

/**
 * Returns a map of channelType -> agentId from bindings.
 * Account-scoped bindings are preferred; channel-wide bindings serve as fallback.
 * Multiple agents can own the same channel type (different accounts).
 */
function getChannelBindingMap(bindings: unknown): {
  channelToAgent: Map<string, string>;
  accountToAgent: Map<string, string>;
} {
  const channelToAgent = new Map<string, string>();
  const accountToAgent = new Map<string, string>();
  if (!Array.isArray(bindings)) return { channelToAgent, accountToAgent };

  for (const binding of bindings) {
    if (!isChannelBinding(binding)) continue;
    const agentId = normalizeAgentIdForBinding(binding.agentId!);
    const channel = binding.match?.channel;
    if (!agentId || !channel) continue;

    const accountId = binding.match?.accountId;
    if (accountId) {
      accountToAgent.set(`${channel}:${accountId}`, agentId);
    } else {
      channelToAgent.set(channel, agentId);
    }
  }

  return { channelToAgent, accountToAgent };
}

function upsertBindingsForChannel(
  bindings: unknown,
  channelType: string,
  agentId: string | null,
  accountId?: string,
): BindingConfig[] | undefined {
  const normalizedAgentId = agentId ? normalizeAgentIdForBinding(agentId) : '';
  const nextBindings = Array.isArray(bindings)
    ? [...bindings as BindingConfig[]].filter((binding) => {
      if (!isChannelBinding(binding)) return true;
      if (binding.match?.channel !== channelType) return true;
      // Keep a single account binding per (agent, channelType). Rebinding to
      // another account should replace the previous one.
      if (normalizedAgentId && normalizeAgentIdForBinding(binding.agentId || '') === normalizedAgentId) {
        return false;
      }
      // Only remove binding that matches the exact accountId scope
      if (accountId) {
        return binding.match?.accountId !== accountId;
      }
      // No accountId: remove channel-wide binding (legacy)
      return Boolean(binding.match?.accountId);
    })
    : [];

  if (agentId) {
    const match: BindingMatch = { channel: channelType };
    if (accountId) {
      match.accountId = accountId;
    }
    nextBindings.push({ agentId, match });
  }

  return nextBindings.length > 0 ? nextBindings : undefined;
}

async function listExistingAgentIdsOnDisk(): Promise<Set<string>> {
  const ids = new Set<string>();
  const agentsDir = join(getOpenClawConfigDir(), 'agents');

  try {
    if (!(await fileExists(agentsDir))) return ids;
    const entries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) ids.add(entry.name);
    }
  } catch {
    // ignore discovery failures
  }

  return ids;
}

async function removeAgentRuntimeDirectory(agentId: string): Promise<void> {
  const runtimeDir = join(getOpenClawConfigDir(), 'agents', agentId);
  try {
    await rm(runtimeDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to remove agent runtime directory', {
      agentId,
      runtimeDir,
      error: String(error),
    });
  }
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

function getManagedWorkspaceDirectory(agent: AgentListEntry): string | null {
  if (agent.id === MAIN_AGENT_ID) return null;

  const configuredWorkspace = expandPath(agent.workspace || `~/.openclaw/workspace-${agent.id}`);
  const managedWorkspace = join(getOpenClawConfigDir(), `workspace-${agent.id}`);
  const normalizedConfigured = trimTrailingSeparators(normalize(configuredWorkspace));
  const normalizedManaged = trimTrailingSeparators(normalize(managedWorkspace));

  return normalizedConfigured === normalizedManaged ? configuredWorkspace : null;
}

export async function removeAgentWorkspaceDirectory(agent: { id: string; workspace?: string }): Promise<void> {
  const workspaceDir = getManagedWorkspaceDirectory(agent as AgentListEntry);
  if (!workspaceDir) {
    logger.warn('Skipping agent workspace deletion for unmanaged path', {
      agentId: agent.id,
      workspace: agent.workspace,
    });
    return;
  }

  try {
    await rm(workspaceDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to remove agent workspace directory', {
      agentId: agent.id,
      workspaceDir,
      error: String(error),
    });
  }
}

async function copyBootstrapFiles(sourceWorkspace: string, targetWorkspace: string): Promise<void> {
  await ensureDir(targetWorkspace);

  for (const fileName of AGENT_BOOTSTRAP_FILES) {
    const source = join(sourceWorkspace, fileName);
    const target = join(targetWorkspace, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function copyRuntimeFiles(sourceAgentDir: string, targetAgentDir: string): Promise<void> {
  await ensureDir(targetAgentDir);

  for (const fileName of AGENT_RUNTIME_FILES) {
    const source = join(sourceAgentDir, fileName);
    const target = join(targetAgentDir, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function provisionAgentFilesystem(
  config: AgentConfigDocument,
  agent: AgentListEntry,
  options?: { inheritWorkspace?: boolean },
): Promise<void> {
  const { entries } = normalizeAgentsConfig(config);
  const mainEntry = entries.find((entry) => entry.id === MAIN_AGENT_ID) ?? createImplicitMainEntry(config);
  const sourceWorkspace = expandPath(mainEntry.workspace || getDefaultWorkspacePath(config));
  const targetWorkspace = expandPath(agent.workspace || `~/.openclaw/workspace-${agent.id}`);
  const sourceAgentDir = expandPath(mainEntry.agentDir || getDefaultAgentDirPath(MAIN_AGENT_ID));
  const targetAgentDir = expandPath(agent.agentDir || getDefaultAgentDirPath(agent.id));
  const targetSessionsDir = join(getOpenClawConfigDir(), 'agents', agent.id, 'sessions');

  await ensureDir(targetWorkspace);
  await ensureDir(targetAgentDir);
  await ensureDir(targetSessionsDir);

  // When inheritWorkspace is true, copy the main agent's workspace bootstrap
  // files (SOUL.md, AGENTS.md, etc.) so the new agent inherits the same
  // personality / instructions. When false (default), leave the workspace
  // empty and let OpenClaw Gateway seed the default bootstrap files on startup.
  if (options?.inheritWorkspace && targetWorkspace !== sourceWorkspace) {
    await copyBootstrapFiles(sourceWorkspace, targetWorkspace);
  }
  if (targetAgentDir !== sourceAgentDir) {
    await copyRuntimeFiles(sourceAgentDir, targetAgentDir);
  }
}

export function resolveAccountIdForAgent(agentId: string): string {
  return agentId === MAIN_AGENT_ID ? DEFAULT_ACCOUNT_ID : agentId;
}

function listConfiguredAccountIdsForChannel(config: AgentConfigDocument, channelType: string): string[] {
  const channelSection = config.channels?.[channelType];
  if (!channelSection || channelSection.enabled === false) {
    return [];
  }

  const accounts = channelSection.accounts;
  if (!accounts || typeof accounts !== 'object' || Object.keys(accounts).length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }

  return Object.keys(accounts)
    .filter(Boolean)
    .sort((a, b) => {
      if (a === DEFAULT_ACCOUNT_ID) return -1;
      if (b === DEFAULT_ACCOUNT_ID) return 1;
      return a.localeCompare(b);
    });
}

async function buildSnapshotFromConfig(config: AgentConfigDocument): Promise<AgentsSnapshot> {
  const resolvedState = await resolveAgentStudioState(config);
  const studioByAgentId = resolvedState.studioByAgentId;
  const { entries, defaultAgentId } = normalizeAgentsConfig(config);
  const configuredChannels = await listConfiguredChannels();
  const { channelToAgent, accountToAgent } = getChannelBindingMap(config.bindings);
  const defaultAgentIdNorm = normalizeAgentIdForBinding(defaultAgentId);
  const channelOwners: Record<string, string> = {};
  const channelAccountOwners: Record<string, string> = {};

  // Build per-agent channel lists from account-scoped bindings
  const agentChannelSets = new Map<string, Set<string>>();

  for (const channelType of configuredChannels) {
    const accountIds = listConfiguredAccountIdsForChannel(config, channelType);
    let primaryOwner: string | undefined;
    const hasExplicitAccountBindingForChannel = accountIds.some((accountId) =>
      accountToAgent.has(`${channelType}:${accountId}`),
    );

    for (const accountId of accountIds) {
      const owner =
        accountToAgent.get(`${channelType}:${accountId}`)
        || (
          accountId === DEFAULT_ACCOUNT_ID && !hasExplicitAccountBindingForChannel
            ? channelToAgent.get(channelType)
            : undefined
        );

      if (!owner) {
        continue;
      }

      channelAccountOwners[`${channelType}:${accountId}`] = owner;
      primaryOwner ??= owner;
      const existing = agentChannelSets.get(owner) ?? new Set();
      existing.add(channelType);
      agentChannelSets.set(owner, existing);
    }

    if (!primaryOwner) {
      primaryOwner = channelToAgent.get(channelType) || defaultAgentIdNorm;
      const existing = agentChannelSets.get(primaryOwner) ?? new Set();
      existing.add(channelType);
      agentChannelSets.set(primaryOwner, existing);
    }

    channelOwners[channelType] = primaryOwner;
  }

  const defaultModelConfig = (config.agents as AgentsConfig | undefined)?.defaults?.model;
  const defaultModelRef = resolveModelRef(defaultModelConfig);
  const defaultModelLabel = defaultModelRef ? formatModelLabel(defaultModelRef) : null;
  const agents: AgentSummary[] = entries.map((entry) => {
    const explicitModelRef = resolveModelRef(entry.model);
    const modelLabel = (explicitModelRef ? formatModelLabel(explicitModelRef) : null) || defaultModelLabel || 'Not configured';
    const inheritedModel = !explicitModelRef && Boolean(defaultModelLabel);
    const entryIdNorm = normalizeAgentIdForBinding(entry.id);
    const ownedChannels = agentChannelSets.get(entryIdNorm) ?? new Set<string>();
    const studio = normalizeAgentStudio(studioByAgentId[entry.id]);
    return {
      id: entry.id,
      name: entry.name || (entry.id === MAIN_AGENT_ID ? MAIN_AGENT_NAME : entry.id),
      isDefault: entry.id === defaultAgentId,
      modelDisplay: modelLabel,
      modelRef: explicitModelRef || defaultModelRef || null,
      overrideModelRef: explicitModelRef,
      inheritedModel,
      workspace: entry.workspace || (entry.id === MAIN_AGENT_ID ? getDefaultWorkspacePath(config) : `~/.openclaw/workspace-${entry.id}`),
      agentDir: entry.agentDir || getDefaultAgentDirPath(entry.id),
      mainSessionKey: buildAgentMainSessionKey(config, entry.id),
      channelTypes: configuredChannels
        .filter((ct) => ownedChannels.has(ct))
        .map((channelType) => toUiChannelType(channelType)),
      skillIds: normalizeStringList(studio.skillIds),
      workflowSteps: normalizeStringList(studio.workflowSteps),
      workflowNodes: normalizeWorkflowNodes(studio.workflowNodes),
      triggerModes: normalizeStringList(studio.triggerModes),
      profileType: normalizeProfileType(studio.profileType),
      description: normalizeOptionalText(studio.description) || null,
      objective: normalizeOptionalText(studio.objective) || null,
      boundaries: normalizeOptionalText(studio.boundaries) || null,
      outputContract: normalizeOptionalText(studio.outputContract) || null,
    };
  });

  return {
    agents,
    defaultAgentId,
    defaultModelRef,
    configuredChannelTypes: configuredChannels.map((channelType) => toUiChannelType(channelType)),
    channelOwners,
    channelAccountOwners,
  };
}

export async function listAgentsSnapshot(): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const resolvedState = await resolveAgentStudioState(config);
    if (resolvedState.changed) {
      await writeOpenClawConfig(resolvedState.config);
      await writeAgentStudioMetadata(resolvedState.studioByAgentId);
    }
    return buildSnapshotFromConfig(resolvedState.config);
  });
}

export async function listConfiguredAgentIds(): Promise<string[]> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { entries } = normalizeAgentsConfig(config);
  const ids = [...new Set(entries.map((entry) => entry.id.trim()).filter(Boolean))];
  return ids.length > 0 ? ids : [MAIN_AGENT_ID];
}

export async function createAgent(
  name: string,
  options?: { inheritWorkspace?: boolean },
): Promise<{ snapshot: AgentsSnapshot; createdAgentId: string }> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const resolvedState = await resolveAgentStudioState(config);
    const studioByAgentId = resolvedState.studioByAgentId;
    const { agentsConfig, entries, syntheticMain } = normalizeAgentsConfig(config);
    const normalizedName = normalizeAgentName(name);
    const existingIds = new Set(entries.map((entry) => entry.id));
    const diskIds = await listExistingAgentIdsOnDisk();
    let nextId = slugifyAgentId(normalizedName);
    let suffix = 2;

    while (existingIds.has(nextId) || diskIds.has(nextId)) {
      nextId = `${slugifyAgentId(normalizedName)}-${suffix}`;
      suffix += 1;
    }

    const nextEntries = syntheticMain ? [createImplicitMainEntry(config), ...entries.filter((_, index) => index > 0)] : [...entries];
    const newAgent: AgentListEntry = {
      id: nextId,
      name: normalizedName,
      workspace: `~/.openclaw/workspace-${nextId}`,
      agentDir: getDefaultAgentDirPath(nextId),
    };

    if (!nextEntries.some((entry) => entry.id === MAIN_AGENT_ID) && syntheticMain) {
      nextEntries.unshift(createImplicitMainEntry(config));
    }
    nextEntries.push(newAgent);

    config.agents = {
      ...agentsConfig,
      list: nextEntries,
    };

    await provisionAgentFilesystem(config, newAgent, { inheritWorkspace: options?.inheritWorkspace });
    await writeOpenClawConfig(config);
    if (resolvedState.changed) {
      await writeAgentStudioMetadata(studioByAgentId);
    }
    await syncAgentWorkspaceStudioContextFromConfig(config, nextId);
    logger.info('Created agent config entry', { agentId: nextId, inheritWorkspace: !!options?.inheritWorkspace });
    return {
      snapshot: await buildSnapshotFromConfig(config),
      createdAgentId: nextId,
    };
  });
}

export async function updateAgentName(agentId: string, name: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const resolvedState = await resolveAgentStudioState(config);
    const studioByAgentId = resolvedState.studioByAgentId;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const normalizedName = normalizeAgentName(name);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    entries[index] = {
      ...entries[index],
      name: normalizedName,
    };

    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    await writeOpenClawConfig(config);
    if (resolvedState.changed) {
      await writeAgentStudioMetadata(studioByAgentId);
    }
    await syncAgentWorkspaceStudioContextFromConfig(config, agentId);
    logger.info('Updated agent name', { agentId, name: normalizedName });
    return buildSnapshotFromConfig(config);
  });
}

function isValidModelRef(modelRef: string): boolean {
  const firstSlash = modelRef.indexOf('/');
  return firstSlash > 0 && firstSlash < modelRef.length - 1;
}

export async function prepareAgentModelUpdate(
  inputConfig: Record<string, unknown>,
  agentId: string,
  modelRef: string | null,
  options: AgentModelUpdateOptions = {},
): Promise<PreparedAgentModelUpdate> {
  const config = JSON.parse(JSON.stringify(inputConfig ?? {})) as AgentConfigDocument;
  const resolvedState = await resolveAgentStudioState(config);
  const studioByAgentId = resolvedState.studioByAgentId;
  const { agentsConfig, entries } = normalizeAgentsConfig(config);
  const index = entries.findIndex((entry) => entry.id === agentId);
  if (index === -1) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  const normalizedModelRef = typeof modelRef === 'string' ? modelRef.trim() : '';
  const nextEntry: AgentListEntry = { ...entries[index] };

  if (!normalizedModelRef) {
    delete nextEntry.model;
  } else {
    if (!isValidModelRef(normalizedModelRef)) {
      throw new Error('modelRef must be in "provider/model" format');
    }
    nextEntry.model = { primary: normalizedModelRef };
  }

  entries[index] = nextEntry;
  config.agents = {
    ...agentsConfig,
    list: options.setAsDefault ? applyDefaultAgentSelection(entries, agentId) : entries,
  };

  return {
    agentId,
    config,
    normalizedModelRef: normalizedModelRef || null,
    snapshot: await buildSnapshotFromConfig(config),
    studioByAgentId,
    studioStateChanged: resolvedState.changed,
  };
}

export async function finalizePreparedAgentModelUpdate(prepared: PreparedAgentModelUpdate): Promise<void> {
  if (prepared.studioStateChanged) {
    await writeAgentStudioMetadata(prepared.studioByAgentId);
  }
  await syncAgentWorkspaceStudioContextFromConfig(prepared.config, prepared.agentId);
  logger.info('Updated agent model', { agentId: prepared.agentId, modelRef: prepared.normalizedModelRef });
}

export async function applyPreparedAgentModelUpdate(prepared: PreparedAgentModelUpdate): Promise<void> {
  await writeOpenClawConfig(prepared.config);
  await finalizePreparedAgentModelUpdate(prepared);
}

export async function updateAgentModel(
  agentId: string,
  modelRef: string | null,
  options: AgentModelUpdateOptions = {},
): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const prepared = await prepareAgentModelUpdate(config, agentId, modelRef, options);
    await applyPreparedAgentModelUpdate(prepared);
    return prepared.snapshot;
  });
}

export async function updateAgentStudio(agentId: string, updates: AgentStudioUpdates): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const resolvedState = await resolveAgentStudioState(config);
    const studioByAgentId = resolvedState.studioByAgentId;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const nextEntry: AgentListEntry = { ...entries[index] };
    const currentStudio = normalizeAgentStudio(studioByAgentId[agentId]);
    const nextStudio: AgentStudioConfig = {
      ...currentStudio,
      ...(updates.profileType !== undefined ? { profileType: normalizeProfileType(updates.profileType) || undefined } : {}),
      ...(updates.description !== undefined
        ? (updates.description?.trim() ? { description: updates.description.trim() } : { description: undefined })
        : {}),
      ...(updates.objective !== undefined
        ? (updates.objective?.trim() ? { objective: updates.objective.trim() } : { objective: undefined })
        : {}),
      ...(updates.boundaries !== undefined
        ? (updates.boundaries?.trim() ? { boundaries: updates.boundaries.trim() } : { boundaries: undefined })
        : {}),
      ...(updates.outputContract !== undefined
        ? (updates.outputContract?.trim() ? { outputContract: updates.outputContract.trim() } : { outputContract: undefined })
        : {}),
      ...(updates.skillIds !== undefined ? { skillIds: normalizeStringList(updates.skillIds) } : {}),
      ...(updates.workflowSteps !== undefined ? { workflowSteps: normalizeStringList(updates.workflowSteps) } : {}),
      ...(updates.workflowNodes !== undefined ? {
        workflowNodes: normalizeWorkflowNodes(updates.workflowNodes),
        workflowSteps: normalizeWorkflowNodes(updates.workflowNodes).map(summarizeWorkflowNode),
      } : {}),
      ...(updates.triggerModes !== undefined ? { triggerModes: normalizeStringList(updates.triggerModes) } : {}),
    };

    const normalizedStudio = normalizeAgentStudio(nextStudio);
    if (Object.keys(normalizedStudio).length === 0) {
      delete studioByAgentId[agentId];
    } else {
      studioByAgentId[agentId] = normalizedStudio;
    }

    entries[index] = nextEntry;
    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    await writeOpenClawConfig(config);
    await writeAgentStudioMetadata(studioByAgentId);
    await syncAgentWorkspaceStudioContextFromConfig(config, agentId);
    logger.info('Updated agent studio config', {
      agentId,
      skillCount: normalizedStudio.skillIds?.length || 0,
      workflowStepCount: normalizedStudio.workflowSteps?.length || 0,
      workflowNodeCount: normalizedStudio.workflowNodes?.length || 0,
      triggerModeCount: normalizedStudio.triggerModes?.length || 0,
    });
    return buildSnapshotFromConfig(config);
  });
}

export async function deleteAgentConfig(agentId: string): Promise<{ snapshot: AgentsSnapshot; removedEntry: AgentListEntry }> {
  return withConfigLock(async () => {
    if (agentId === MAIN_AGENT_ID) {
      throw new Error('The main role cannot be deleted');
    }

    const config = await readOpenClawConfig() as AgentConfigDocument;
    const resolvedState = await resolveAgentStudioState(config);
    const studioByAgentId = resolvedState.studioByAgentId;
    const { agentsConfig, entries, defaultAgentId } = normalizeAgentsConfig(config);
    const snapshotBeforeDeletion = await buildSnapshotFromConfig(config);
    const removedEntry = entries.find((entry) => entry.id === agentId);
    const nextEntries = entries.filter((entry) => entry.id !== agentId);
    if (!removedEntry || nextEntries.length === entries.length) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    config.agents = {
      ...agentsConfig,
      list: nextEntries,
    };
    config.bindings = Array.isArray(config.bindings)
      ? config.bindings.filter((binding) => !(isChannelBinding(binding) && binding.agentId === agentId))
      : undefined;

    if (defaultAgentId === agentId && nextEntries.length > 0) {
      config.agents.list = applyDefaultAgentSelection(nextEntries, nextEntries[0].id);
    }

    const normalizedAgentId = normalizeAgentIdForBinding(agentId);
    const legacyAccountId = resolveAccountIdForAgent(agentId);
    const ownedLegacyAccounts = new Set(
      Object.entries(snapshotBeforeDeletion.channelAccountOwners)
        .filter(([channelAccountKey, owner]) => {
          if (owner !== normalizedAgentId) return false;
          const accountId = channelAccountKey.slice(channelAccountKey.indexOf(':') + 1);
          return accountId === legacyAccountId;
        })
        .map(([channelAccountKey]) => channelAccountKey),
    );

    await writeOpenClawConfig(config);
    if (agentId in studioByAgentId || resolvedState.changed) {
      delete studioByAgentId[agentId];
      await writeAgentStudioMetadata(studioByAgentId);
    }
    await deleteAgentChannelAccounts(agentId, ownedLegacyAccounts);
    await removeAgentRuntimeDirectory(agentId);
    // NOTE: workspace directory is NOT deleted here intentionally.
    // The caller (route handler) defers workspace removal until after
    // the Gateway process has fully restarted, so that any in-flight
    // process.chdir(workspace) calls complete before the directory
    // disappears (otherwise process.cwd() throws ENOENT for the rest
    // of the Gateway's lifetime).
    logger.info('Deleted agent config entry', { agentId });
    return { snapshot: await buildSnapshotFromConfig(config), removedEntry };
  });
}

export async function assignChannelToAgent(agentId: string, channelType: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const resolvedState = await resolveAgentStudioState(config);
    const studioByAgentId = resolvedState.studioByAgentId;
    const { entries } = normalizeAgentsConfig(config);
    if (!entries.some((entry) => entry.id === agentId)) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const accountId = resolveAccountIdForAgent(agentId);
    config.bindings = upsertBindingsForChannel(config.bindings, channelType, agentId, accountId);
    await writeOpenClawConfig(config);
    if (resolvedState.changed) {
      await writeAgentStudioMetadata(studioByAgentId);
    }
    logger.info('Assigned channel to agent', { agentId, channelType, accountId });
    return buildSnapshotFromConfig(config);
  });
}

export async function assignChannelAccountToAgent(
  agentId: string,
  channelType: string,
  accountId: string,
): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const resolvedState = await resolveAgentStudioState(config);
    const studioByAgentId = resolvedState.studioByAgentId;
    const { entries } = normalizeAgentsConfig(config);
    if (!entries.some((entry) => entry.id === agentId)) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    if (!accountId.trim()) {
      throw new Error('accountId is required');
    }

    config.bindings = upsertBindingsForChannel(config.bindings, channelType, agentId, accountId.trim());
    await writeOpenClawConfig(config);
    if (resolvedState.changed) {
      await writeAgentStudioMetadata(studioByAgentId);
    }
    logger.info('Assigned channel account to agent', { agentId, channelType, accountId: accountId.trim() });
    return buildSnapshotFromConfig(config);
  });
}

export async function clearChannelBinding(channelType: string, accountId?: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const resolvedState = await resolveAgentStudioState(config);
    const studioByAgentId = resolvedState.studioByAgentId;
    config.bindings = upsertBindingsForChannel(config.bindings, channelType, null, accountId);
    await writeOpenClawConfig(config);
    if (resolvedState.changed) {
      await writeAgentStudioMetadata(studioByAgentId);
    }
    logger.info('Cleared channel binding', { channelType, accountId });
    return buildSnapshotFromConfig(config);
  });
}

export async function clearAllBindingsForChannel(channelType: string): Promise<void> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const resolvedState = await resolveAgentStudioState(config);
    const studioByAgentId = resolvedState.studioByAgentId;
    if (!Array.isArray(config.bindings)) return;

    const nextBindings = config.bindings.filter((binding) => {
      if (!isChannelBinding(binding)) return true;
      return binding.match?.channel !== channelType;
    });

    config.bindings = nextBindings.length > 0 ? nextBindings : undefined;
    await writeOpenClawConfig(config);
    if (resolvedState.changed) {
      await writeAgentStudioMetadata(studioByAgentId);
    }
    logger.info('Cleared all bindings for channel', { channelType });
  });
}
