import { describe, expect, it } from 'vitest';
import { repairRuntimeAgentModelReferences } from '@electron/utils/openclaw-runtime-audit';

describe('openclaw runtime audit', () => {
  it('repairs stale qwen agent refs to the current runtime provider key', () => {
    const repaired = repairRuntimeAgentModelReferences({
      models: {
        providers: {
          'custom-custom36': {
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            api: 'openai-responses',
            models: [{ id: 'qwen-plus', name: 'qwen-plus' }],
          },
          'custom-zai': {
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
            api: 'openai-completions',
            models: [{ id: 'glm-5', name: 'glm-5' }],
          },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: 'custom-custom36/qwen-plus',
          },
        },
        list: [
          {
            id: 'agent-qwen',
            model: {
              primary: 'custom-customfb/qwen3.5-plus',
            },
          },
          {
            id: 'agent-glm',
            model: {
              primary: 'custom-zai/glm-5',
            },
          },
        ],
      },
    });

    const agents = ((((repaired.config.agents as Record<string, unknown>).list) ?? []) as Array<Record<string, unknown>>);
    const qwenAgent = agents.find((agent) => agent.id === 'agent-qwen');
    const glmAgent = agents.find((agent) => agent.id === 'agent-glm');

    expect(repaired.changed).toBe(true);
    expect(repaired.repairedAgents).toEqual(['agent-qwen']);
    expect((qwenAgent?.model as Record<string, unknown>).primary).toBe('custom-custom36/qwen3.5-plus');
    expect((glmAgent?.model as Record<string, unknown>).primary).toBe('custom-zai/glm-5');
  });

  it('does not rewrite ambiguous families when multiple current providers match', () => {
    const repaired = repairRuntimeAgentModelReferences({
      models: {
        providers: {
          'custom-custom36': {
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            models: [{ id: 'qwen-plus', name: 'qwen-plus' }],
          },
          'custom-custom48': {
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            models: [{ id: 'qwen3-coder-next', name: 'qwen3-coder-next' }],
          },
        },
      },
      agents: {
        list: [
          {
            id: 'agent-qwen',
            model: {
              primary: 'custom-customfb/qwen3.5-plus',
            },
          },
        ],
      },
    });

    const agent = ((((repaired.config.agents as Record<string, unknown>).list) ?? []) as Array<Record<string, unknown>>)[0];
    expect(repaired.changed).toBe(false);
    expect((agent.model as Record<string, unknown>).primary).toBe('custom-customfb/qwen3.5-plus');
  });
});
