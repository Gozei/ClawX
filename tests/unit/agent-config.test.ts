import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-agent-config-${suffix}`,
    testUserData: `/tmp/clawx-agent-config-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

async function readAgentStudioJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.clawx', 'agent-studio.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('agent config lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('lists configured agent ids from openclaw.json', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test3', name: 'test3' },
        ],
      },
    });

    const { listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['main', 'test3']);
  });

  it('falls back to the implicit main agent when no list exists', async () => {
    await writeOpenClawJson({});

    const { listConfiguredAgentIds, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['main']);
    await expect(listAgentsSnapshot()).resolves.toMatchObject({
      agents: [
        expect.objectContaining({
          id: 'main',
          name: 'Main Role',
          isDefault: true,
        }),
      ],
    });
  });

  it('includes canonical per-agent main session keys in the snapshot', async () => {
    await writeOpenClawJson({
      session: {
        mainKey: 'desk',
      },
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'research', name: 'Research' },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'main',
          mainSessionKey: 'agent:main:desk',
        }),
        expect.objectContaining({
          id: 'research',
          mainSessionKey: 'agent:research:desk',
        }),
      ]),
    );
  });

  it('exposes effective and override model refs in the snapshot', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'moonshot/kimi-k2.5',
          },
        },
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coder', name: 'Coder', model: { primary: 'ark/ark-code-latest' } },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    const main = snapshot.agents.find((agent) => agent.id === 'main');
    const coder = snapshot.agents.find((agent) => agent.id === 'coder');

    expect(snapshot.defaultModelRef).toBe('moonshot/kimi-k2.5');
    expect(main).toMatchObject({
      modelRef: 'moonshot/kimi-k2.5',
      overrideModelRef: null,
      inheritedModel: true,
      modelDisplay: 'kimi-k2.5',
    });
    expect(coder).toMatchObject({
      modelRef: 'ark/ark-code-latest',
      overrideModelRef: 'ark/ark-code-latest',
      inheritedModel: false,
      modelDisplay: 'ark-code-latest',
    });
  });

  it('updates and clears per-agent model overrides', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'moonshot/kimi-k2.5',
          },
        },
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coder', name: 'Coder' },
        ],
      },
    });

    const { listAgentsSnapshot, updateAgentModel } = await import('@electron/utils/agent-config');

    await updateAgentModel('coder', 'ark/ark-code-latest');
    let config = await readOpenClawJson();
    let coder = ((config.agents as { list: Array<{ id: string; model?: { primary?: string } }> }).list)
      .find((agent) => agent.id === 'coder');
    expect(coder?.model?.primary).toBe('ark/ark-code-latest');

    let snapshot = await listAgentsSnapshot();
    let snapshotCoder = snapshot.agents.find((agent) => agent.id === 'coder');
    expect(snapshotCoder).toMatchObject({
      modelRef: 'ark/ark-code-latest',
      overrideModelRef: 'ark/ark-code-latest',
      inheritedModel: false,
    });

    await updateAgentModel('coder', null);
    config = await readOpenClawJson();
    coder = ((config.agents as { list: Array<{ id: string; model?: unknown }> }).list)
      .find((agent) => agent.id === 'coder');
    expect(coder?.model).toBeUndefined();

    snapshot = await listAgentsSnapshot();
    snapshotCoder = snapshot.agents.find((agent) => agent.id === 'coder');
    expect(snapshotCoder).toMatchObject({
      modelRef: 'moonshot/kimi-k2.5',
      overrideModelRef: null,
      inheritedModel: true,
    });
  });

  it('writes studio context into the agent workspace AGENTS.md file', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          workspace: '~/.openclaw/workspace',
          model: {
            primary: 'zai/glm-5',
          },
        },
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'writer',
            name: '公文起草专家',
            workspace: '~/.openclaw/workspace-writer',
            agentDir: '~/.openclaw/agents/writer/agent',
          },
        ],
      },
    });

    const workspaceDir = join(testHome, '.openclaw', 'workspace-writer');
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(join(workspaceDir, 'AGENTS.md'), '# Workspace Writer\n\nExisting content.\n', 'utf8');

    const { updateAgentStudio } = await import('@electron/utils/agent-config');

    await updateAgentStudio('writer', {
      profileType: 'specialist',
      description: '负责公文起草与润色',
      objective: '输出结构化、可审阅的公文草稿',
      boundaries: '缺少政策依据时必须先澄清，不得自行编造',
      outputContract: '输出标题、正文、落款和政策依据说明',
      skillIds: ['search-docs', 'policy-lookup'],
      triggerModes: ['manual', 'channel'],
      workflowNodes: [
        { id: 'step-1', type: 'instruction', title: '识别公文类型', inputSpec: 'topic, audience', outputSpec: 'docType' },
        { id: 'step-2', type: 'skill', title: '检索政策依据', target: 'policy-lookup', inputSpec: 'docType', outputSpec: 'policyReferences', code: 'query_policy_index(docType)' },
        { id: 'step-3', type: 'agent', title: '交给审稿智能体复核', target: 'reviewer', inputSpec: 'draft, policyReferences', outputSpec: 'reviewNotes' },
        { id: 'step-4', type: 'model', title: '生成公文草稿', target: 'zai/glm-5', modelRef: 'zai/glm-5', onFailure: 'retry' },
      ],
    });

    const config = await readOpenClawJson();
    const writerConfig = ((config.agents as { list: Array<{ id: string; studio?: unknown }> }).list)
      .find((agent) => agent.id === 'writer');
    expect(writerConfig?.studio).toBeUndefined();

    const studioMetadata = await readAgentStudioJson();
    expect(studioMetadata).toMatchObject({
      agents: {
        writer: {
          profileType: 'specialist',
          description: '负责公文起草与润色',
          objective: '输出结构化、可审阅的公文草稿',
        },
      },
    });

    const content = await readFile(join(workspaceDir, 'AGENTS.md'), 'utf8');
    expect(content).toContain('## Deep AI Worker Agent Studio');
    expect(content).toContain('Agent Name: 公文起草专家');
    expect(content).toContain('Role: 负责公文起草与润色');
    expect(content).toContain('Agent Type: specialist');
    expect(content).toContain('Business Goal: 输出结构化、可审阅的公文草稿');
    expect(content).toContain('Guardrails: 缺少政策依据时必须先澄清，不得自行编造');
    expect(content).toContain('Output Contract: 输出标题、正文、落款和政策依据说明');
    expect(content).toContain('Enabled Skills: search-docs, policy-lookup');
    expect(content).toContain('Trigger Modes: manual, channel');
    expect(content).toContain('1. [instruction] 识别公文类型 | input: topic, audience | output: docType');
    expect(content).toContain('2. [skill] 检索政策依据 -> policy-lookup | input: docType | output: policyReferences');
    expect(content).toContain('query_policy_index(docType)');
    expect(content).toContain('3. [agent] 交给审稿智能体复核 -> reviewer | input: draft, policyReferences | output: reviewNotes');
    expect(content).toContain('4. [model] 生成公文草稿 -> zai/glm-5 | model: zai/glm-5 (on failure: retry)');
    expect(content).toContain('### Execution Playbook');
    expect(content).toContain('智能体类型：specialist。');
    expect(content).toContain('业务目标：输出结构化、可审阅的公文草稿');
    expect(content).toContain('执行边界：缺少政策依据时必须先澄清，不得自行编造');
    expect(content).toContain('输出要求：输出标题、正文、落款和政策依据说明');
    expect(content).toContain('仅优先使用这些已装配技能：search-docs、policy-lookup。');
    expect(content).toContain('委派给智能体 "reviewer"');
  });

  it('migrates legacy studio config out of openclaw.json when listing agents', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            studio: {
              profileType: 'coordinator',
              description: '主协调角色',
            },
          },
          {
            id: 'writer',
            name: 'Writer',
            studio: {
              description: '负责写作',
              skillIds: ['draft'],
            },
          },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'main',
          profileType: 'coordinator',
          description: '主协调角色',
        }),
        expect.objectContaining({
          id: 'writer',
          description: '负责写作',
          skillIds: ['draft'],
        }),
      ]),
    );

    const config = await readOpenClawJson();
    expect(((config.agents as { list: Array<{ studio?: unknown }> }).list).every((agent) => agent.studio === undefined)).toBe(true);

    const studioMetadata = await readAgentStudioJson();
    expect(studioMetadata).toMatchObject({
      agents: {
        main: {
          profileType: 'coordinator',
          description: '主协调角色',
        },
        writer: {
          description: '负责写作',
          skillIds: ['draft'],
        },
      },
    });
  });

  it('rejects invalid model ref formats when updating agent model', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { updateAgentModel } = await import('@electron/utils/agent-config');

    await expect(updateAgentModel('main', 'invalid-model-ref')).rejects.toThrow(
      'modelRef must be in "provider/model" format',
    );
  });

  it('deletes the config entry, bindings, runtime directory, and managed workspace for a removed agent', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'custom-custom27/MiniMax-M2.7',
            fallbacks: [],
          },
        },
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test2',
            name: 'test2',
            workspace: '~/.openclaw/workspace-test2',
            agentDir: '~/.openclaw/agents/test2/agent',
          },
          {
            id: 'test3',
            name: 'test3',
            workspace: '~/.openclaw/workspace-test3',
            agentDir: '~/.openclaw/agents/test3/agent',
          },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
        },
      },
      bindings: [
        {
          agentId: 'test2',
          match: {
            channel: 'feishu',
          },
        },
      ],
    });

    const test2RuntimeDir = join(testHome, '.openclaw', 'agents', 'test2');
    const test2WorkspaceDir = join(testHome, '.openclaw', 'workspace-test2');
    await mkdir(join(test2RuntimeDir, 'agent'), { recursive: true });
    await mkdir(join(test2RuntimeDir, 'sessions'), { recursive: true });
    await mkdir(join(test2WorkspaceDir, '.openclaw'), { recursive: true });
    await writeFile(
      join(test2RuntimeDir, 'agent', 'auth-profiles.json'),
      JSON.stringify({ version: 1, profiles: {} }, null, 2),
      'utf8',
    );
    await writeFile(join(test2WorkspaceDir, 'AGENTS.md'), '# test2', 'utf8');

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');

    const { snapshot } = await deleteAgentConfig('test2');

    expect(snapshot.agents.map((agent) => agent.id)).toEqual(['main', 'test3']);
    expect(snapshot.channelOwners.feishu).toBe('main');

    const config = await readOpenClawJson();
    expect((config.agents as { list: Array<{ id: string }> }).list.map((agent) => agent.id)).toEqual([
      'main',
      'test3',
    ]);
    expect(config.bindings).toEqual([]);
    await expect(access(test2RuntimeDir)).rejects.toThrow();
    // Workspace deletion is intentionally deferred by `deleteAgentConfig` to avoid
    // ENOENT errors during Gateway restart, so it should still exist here.
    await expect(access(test2WorkspaceDir)).resolves.toBeUndefined();

    infoSpy.mockRestore();
  });

  it('preserves unmanaged custom workspaces when deleting an agent', async () => {
    const customWorkspaceDir = join(testHome, 'custom-workspace-test2');

    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test2',
            name: 'test2',
            workspace: customWorkspaceDir,
            agentDir: '~/.openclaw/agents/test2/agent',
          },
        ],
      },
    });

    await mkdir(join(testHome, '.openclaw', 'agents', 'test2', 'agent'), { recursive: true });
    await mkdir(customWorkspaceDir, { recursive: true });
    await writeFile(join(customWorkspaceDir, 'AGENTS.md'), '# custom', 'utf8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');

    await deleteAgentConfig('test2');

    await expect(access(customWorkspaceDir)).resolves.toBeUndefined();

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('does not delete a legacy-named account when it is owned by another agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
          { id: 'test3', name: 'test3' },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: { enabled: true, appId: 'main-app' },
            test2: { enabled: true, appId: 'legacy-test2-app' },
          },
        },
      },
      bindings: [
        {
          agentId: 'test3',
          match: {
            channel: 'feishu',
            accountId: 'test2',
          },
        },
      ],
    });

    const { deleteAgentConfig } = await import('@electron/utils/agent-config');
    await deleteAgentConfig('test2');

    const config = await readOpenClawJson();
    const feishu = (config.channels as Record<string, unknown>).feishu as {
      accounts?: Record<string, unknown>;
    };
    expect(feishu.accounts?.test2).toBeDefined();
  });

  it('allows the same agent to bind multiple different channels', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'telegram', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBe('main');
    expect(snapshot.channelAccountOwners['telegram:default']).toBe('main');
  });

  it('replaces previous account binding for the same agent and channel', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: { enabled: true, appId: 'main-app' },
            alt: { enabled: true, appId: 'alt-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'feishu', 'alt');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBeUndefined();
    expect(snapshot.channelAccountOwners['feishu:alt']).toBe('main');
  });

  it('keeps a single owner for the same channel account', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          accounts: {
            default: { enabled: true, appId: 'main-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('test2', 'feishu', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBe('test2');
  });

  it('can clear one channel account binding without affecting another channel on the same agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    });

    const { assignChannelAccountToAgent, clearChannelBinding, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'telegram', 'default');
    await clearChannelBinding('feishu', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBeUndefined();
    expect(snapshot.channelAccountOwners['telegram:default']).toBe('main');
  });
});
