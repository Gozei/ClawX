import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAllSkillConfigsMock = vi.fn();
const updateSkillConfigMock = vi.fn();

vi.mock('@electron/utils/skill-config', () => ({
  getAllSkillConfigs: (...args: unknown[]) => getAllSkillConfigsMock(...args),
  updateSkillConfig: (...args: unknown[]) => updateSkillConfigMock(...args),
}));

const testRoot = join(process.cwd(), 'tmp-skill-details-test');

describe('skill-details utilities', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await rm(testRoot, { recursive: true, force: true });
    await mkdir(testRoot, { recursive: true });
  });

  it('maps runtime skills for the list endpoint', async () => {
    const { listSkills } = await import('@electron/utils/skill-details');
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        skills: [
          {
            skillKey: 'weather',
            name: 'Weather',
            description: 'Forecasts',
            disabled: false,
            eligible: true,
            missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
            version: '2.0.0',
          },
        ],
      }),
    };

    const skills = await listSkills(gatewayManager as never);

    expect(skills).toEqual([
      expect.objectContaining({
        id: 'weather',
        name: 'Weather',
        enabled: true,
        ready: true,
        version: '2.0.0',
      }),
    ]);
  });

  it('builds skill detail from runtime, managed config, and SKILL.md', async () => {
    const skillDir = join(testRoot, 'notion');
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, `---
name: notion
description: "Notion API for creating and managing pages."
homepage: https://developers.notion.com
metadata:
  {
    "openclaw":
      { "requires": { "env": ["NOTION_API_KEY"], "bins": ["curl"] }, "primaryEnv": "NOTION_API_KEY" },
  }
---

# Notion

Use the Notion API.
`, 'utf8');

    getAllSkillConfigsMock.mockResolvedValue({
      notion: {
        apiKey: 'secret-key',
        env: {
          NOTION_API_KEY: 'secret-key',
          EXTRA_FLAG: '1',
        },
      },
    });

    const { getSkillDetail } = await import('@electron/utils/skill-details');
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        skills: [
          {
            skillKey: 'notion',
            slug: 'notion',
            name: 'Notion',
            description: 'Notion API',
            disabled: false,
            eligible: false,
            missing: { bins: [], anyBins: [], env: ['NOTION_API_KEY'], config: [], os: [] },
            baseDir: skillDir,
            filePath: skillFile,
            homepage: 'https://developers.notion.com',
            author: 'OpenClaw',
          },
        ],
      }),
    };

    const detail = await getSkillDetail(gatewayManager as never, 'notion');

    expect(detail).toEqual(expect.objectContaining({
      identity: expect.objectContaining({
        id: 'notion',
        name: 'Notion',
        baseDir: skillDir,
        homepage: 'https://developers.notion.com',
      }),
      status: expect.objectContaining({
        enabled: true,
        ready: false,
        missing: expect.objectContaining({
          env: ['NOTION_API_KEY'],
        }),
      }),
      config: expect.objectContaining({
        apiKey: 'secret-key',
      }),
      requirements: expect.objectContaining({
        primaryEnv: 'NOTION_API_KEY',
        requires: expect.objectContaining({
          env: ['NOTION_API_KEY'],
          bins: ['curl'],
        }),
      }),
    }));
    expect(detail?.requirements.rawMarkdown).toContain('Use the Notion API.');
  });

  it('resolves the marketplace install slug from metadata when runtime only exposes the skill key', async () => {
    const skillDir = join(testRoot, 'self-improving-agent');
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, `---
name: self-improvement
description: "Captures learnings and errors."
---

# Self Improvement
`, 'utf8');
    await writeFile(join(skillDir, '_meta.json'), JSON.stringify({
      slug: 'self-improving-agent',
      version: '3.0.13',
    }), 'utf8');

    getAllSkillConfigsMock.mockResolvedValue({});

    const { getSkillDetail, listSkills } = await import('@electron/utils/skill-details');
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        skills: [
          {
            skillKey: 'self-improvement',
            name: 'Self Improvement',
            description: 'Captures learnings and errors.',
            disabled: false,
            eligible: true,
            missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
            baseDir: skillDir,
            filePath: skillFile,
          },
        ],
      }),
    };

    const [detail, skills] = await Promise.all([
      getSkillDetail(gatewayManager as never, 'self-improvement'),
      listSkills(gatewayManager as never),
    ]);

    expect(detail?.identity.slug).toBe('self-improving-agent');
    expect(skills).toEqual([
      expect.objectContaining({
        id: 'self-improvement',
        slug: 'self-improving-agent',
      }),
    ]);
  });

  it('deletes the resolved skill directory', async () => {
    const skillDir = join(testRoot, 'weather');
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, '---\nname: weather\ndescription: test\n---\n', 'utf8');

    const { deleteSkillDirectory } = await import('@electron/utils/skill-details');
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        skills: [
          {
            skillKey: 'weather',
            baseDir: skillDir,
            filePath: skillFile,
            eligible: true,
            missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
          },
        ],
      }),
    };

    const result = await deleteSkillDirectory(gatewayManager as never, 'weather');

    expect(result).toEqual({ success: true });
    await expect(readFile(skillFile, 'utf8')).rejects.toThrow();
  });

  it('saves config using the resolved skill key', async () => {
    updateSkillConfigMock.mockResolvedValue({ success: true });
    const { saveSkillConfig } = await import('@electron/utils/skill-details');
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        skills: [
          {
            skillKey: 'gh-issues',
            slug: 'gh-issues',
            eligible: false,
            missing: { bins: ['gh'], anyBins: [], env: [], config: [], os: [] },
          },
        ],
      }),
    };

    const result = await saveSkillConfig(gatewayManager as never, 'gh-issues', {
      apiKey: 'token',
      env: { GH_TOKEN: 'token' },
    });

    expect(updateSkillConfigMock).toHaveBeenCalledWith('gh-issues', {
      apiKey: 'token',
      env: { GH_TOKEN: 'token' },
    });
    expect(result).toEqual({ success: true });
  });
});
