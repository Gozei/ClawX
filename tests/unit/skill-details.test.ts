import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAllSkillConfigsMock = vi.fn();
const updateSkillConfigMock = vi.fn();

vi.mock('@electron/utils/skill-config', () => ({
  getAllSkillConfigs: (...args: unknown[]) => getAllSkillConfigsMock(...args),
  updateSkillConfig: (...args: unknown[]) => updateSkillConfigMock(...args),
}));

const testRoot = join(tmpdir(), 'clawx-tests', 'skill-details');

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
        config: {
          baseUrl: 'https://api.notion.com',
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
        config: {
          baseUrl: 'https://api.notion.com',
        },
      }),
      requirements: expect.objectContaining({
        primaryEnv: 'NOTION_API_KEY',
        requires: expect.objectContaining({
          env: ['NOTION_API_KEY'],
          bins: ['curl'],
        }),
      }),
      configuration: expect.objectContaining({
        credentials: expect.arrayContaining([
          expect.objectContaining({
            key: 'NOTION_API_KEY',
            source: 'apiKey',
            configured: true,
          }),
        ]),
        optional: expect.arrayContaining([
          expect.objectContaining({
            key: 'EXTRA_FLAG',
            source: 'env',
          }),
        ]),
        config: expect.arrayContaining([
          expect.objectContaining({
            key: 'baseUrl',
            source: 'config',
            configured: true,
          }),
        ]),
      }),
    }));
    expect(detail?.requirements.rawMarkdown).toContain('Use the Notion API.');
  });

  it('normalizes inline clawdbot metadata into identity and configuration fields', async () => {
    const skillDir = join(testRoot, 'desearch-web-search');
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, `---
name: desearch-web-search
description: Search the web in real time.
metadata: {"clawdbot":{"emoji":"🌐","homepage":"https://desearch.ai","requires":{"env":["DESEARCH_API_KEY"],"bins":["curl"]}}}
---

# DeSearch
`, 'utf8');

    getAllSkillConfigsMock.mockResolvedValue({});

    const { getSkillDetail } = await import('@electron/utils/skill-details');
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        skills: [
          {
            skillKey: 'desearch-web-search',
            name: 'desearch-web-search',
            description: 'Search the web in real time.',
            disabled: false,
            eligible: true,
            missing: { bins: [], anyBins: [], env: ['DESEARCH_API_KEY'], config: [], os: [] },
            baseDir: skillDir,
            filePath: skillFile,
          },
        ],
      }),
    };

    const detail = await getSkillDetail(gatewayManager as never, 'desearch-web-search');

    expect(detail).toEqual(expect.objectContaining({
      identity: expect.objectContaining({
        icon: '🌐',
        homepage: 'https://desearch.ai',
      }),
      requirements: expect.objectContaining({
        primaryEnv: 'DESEARCH_API_KEY',
        requires: expect.objectContaining({
          env: ['DESEARCH_API_KEY'],
          bins: ['curl'],
        }),
        parseError: undefined,
      }),
      configuration: expect.objectContaining({
        credentials: expect.arrayContaining([
          expect.objectContaining({
            key: 'DESEARCH_API_KEY',
            source: 'apiKey',
            required: true,
            configured: false,
          }),
        ]),
      }),
    }));
  });

  it('parses YAML metadata from alternate namespaces', async () => {
    const skillDir = join(testRoot, 'pdf-smart-tool-cn');
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, `---
name: pdf-smart-tool-cn
description: PDF Smart Tool
metadata:
  clawhub:
    emoji: 📄
    requires:
      bins: [pdftotext, tesseract, ghostscript]
      anyBins: [python, python3]
---

# PDF Smart Tool
`, 'utf8');

    getAllSkillConfigsMock.mockResolvedValue({});

    const { getSkillDetail } = await import('@electron/utils/skill-details');
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        skills: [
          {
            skillKey: 'pdf-smart-tool-cn',
            name: 'PDF Smart Tool',
            description: 'PDF Smart Tool',
            disabled: false,
            eligible: false,
            missing: { bins: ['pdftotext'], anyBins: [], env: [], config: [], os: [] },
            baseDir: skillDir,
            filePath: skillFile,
          },
        ],
      }),
    };

    const detail = await getSkillDetail(gatewayManager as never, 'pdf-smart-tool-cn');

    expect(detail?.requirements).toEqual(expect.objectContaining({
      requires: expect.objectContaining({
        bins: ['pdftotext', 'tesseract', 'ghostscript'],
        anyBins: ['python', 'python3'],
      }),
      parseError: undefined,
    }));
  });

  it('parses YAML metadata from the openclaw namespace with primaryEnv', async () => {
    const skillDir = join(testRoot, 'docx-cn');
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, `---
name: docx-cn
description: Word 文档处理
metadata:
  openclaw:
    emoji: 📄
    primaryEnv: DOCX_API_KEY
    requires:
      env: [DOCX_API_KEY]
      config: [baseUrl]
---

# DOCX
`, 'utf8');

    getAllSkillConfigsMock.mockResolvedValue({});

    const { getSkillDetail } = await import('@electron/utils/skill-details');
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        skills: [
          {
            skillKey: 'docx-cn',
            name: 'DOCX',
            description: 'DOCX',
            disabled: false,
            eligible: false,
            missing: { bins: [], anyBins: [], env: ['DOCX_API_KEY'], config: ['baseUrl'], os: [] },
            baseDir: skillDir,
            filePath: skillFile,
          },
        ],
      }),
    };

    const detail = await getSkillDetail(gatewayManager as never, 'docx-cn');

    expect(detail?.requirements).toEqual(expect.objectContaining({
      primaryEnv: 'DOCX_API_KEY',
      requires: expect.objectContaining({
        env: ['DOCX_API_KEY'],
        config: ['baseUrl'],
      }),
      parseError: undefined,
    }));
  });

  it('re-reads updated SKILL.md content without relying on a cached spec', async () => {
    const skillDir = join(testRoot, 'mineru');
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, `---
name: mineru
description: MinerU
metadata:
  openclaw:
    requires:
      bins: [mineru-open-api]
---

# MinerU
`, 'utf8');

    getAllSkillConfigsMock.mockResolvedValue({});

    const { getSkillDetail } = await import('@electron/utils/skill-details');
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        skills: [
          {
            skillKey: 'mineru',
            name: 'MinerU',
            description: 'MinerU',
            disabled: false,
            eligible: false,
            missing: { bins: ['mineru-open-api'], anyBins: [], env: [], config: [], os: [] },
            baseDir: skillDir,
            filePath: skillFile,
          },
        ],
      }),
    };

    const initialDetail = await getSkillDetail(gatewayManager as never, 'mineru');
    expect(initialDetail?.requirements.primaryEnv).toBeUndefined();
    expect(initialDetail?.configuration.credentials).toHaveLength(0);

    await writeFile(skillFile, `---
name: mineru
description: MinerU
metadata:
  openclaw:
    requires:
      bins: [mineru-open-api]
      env: [MINERU_TOKEN]
    primaryEnv: MINERU_TOKEN
---

# MinerU
`, 'utf8');

    const refreshedDetail = await getSkillDetail(gatewayManager as never, 'mineru');
    expect(refreshedDetail?.requirements.primaryEnv).toBe('MINERU_TOKEN');
    expect(refreshedDetail?.configuration.credentials).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'MINERU_TOKEN',
        source: 'apiKey',
      }),
    ]));
  });

  it('parses top-level clawdbot metadata without a metadata wrapper', async () => {
    const skillDir = join(testRoot, 'top-level-desearch');
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, `---
name: top-level-desearch
description: Search the web in real time.
clawdbot:
  emoji: 🌐
  homepage: https://desearch.ai
  requires:
    env: [DESEARCH_API_KEY]
    bins: [curl]
---

# Top-level DeSearch
`, 'utf8');

    getAllSkillConfigsMock.mockResolvedValue({});

    const { getSkillDetail } = await import('@electron/utils/skill-details');
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        skills: [
          {
            skillKey: 'top-level-desearch',
            name: 'top-level-desearch',
            description: 'Search the web in real time.',
            disabled: false,
            eligible: true,
            missing: { bins: [], anyBins: [], env: ['DESEARCH_API_KEY'], config: [], os: [] },
            baseDir: skillDir,
            filePath: skillFile,
          },
        ],
      }),
    };

    const detail = await getSkillDetail(gatewayManager as never, 'top-level-desearch');

    expect(detail).toEqual(expect.objectContaining({
      identity: expect.objectContaining({
        icon: '🌐',
        homepage: 'https://desearch.ai',
      }),
      requirements: expect.objectContaining({
        primaryEnv: 'DESEARCH_API_KEY',
        requires: expect.objectContaining({
          env: ['DESEARCH_API_KEY'],
          bins: ['curl'],
        }),
        parseError: undefined,
      }),
      configuration: expect.objectContaining({
        credentials: expect.arrayContaining([
          expect.objectContaining({
            key: 'DESEARCH_API_KEY',
            source: 'apiKey',
            required: true,
            configured: false,
          }),
        ]),
      }),
    }));
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
      config: {},
    });
    expect(result).toEqual({ success: true });
  });

  it('mirrors config and env writes into local skill files when they are used by the skill', async () => {
    const skillDir = join(testRoot, 'schedule-feishu');
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, `---
name: schedule-feishu
description: Schedule helper
metadata:
  openclaw:
    primaryEnv: FEISHU_APP_SECRET
    requires:
      env: [FEISHU_APP_SECRET]
      config: [schedule_doc_url]
---

# Schedule

Values are stored in config.json and config/.env.
`, 'utf8');
    await writeFile(join(skillDir, 'config.json'), JSON.stringify({
      schedule_doc_url: '',
      max_retention_days: 7,
    }, null, 2), 'utf8');

    getAllSkillConfigsMock.mockResolvedValue({});
    updateSkillConfigMock.mockResolvedValue({ success: true });

    const { saveSkillConfig } = await import('@electron/utils/skill-details');
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        skills: [
          {
            skillKey: 'schedule-feishu',
            eligible: false,
            missing: { env: ['FEISHU_APP_SECRET'], config: ['schedule_doc_url'] },
            baseDir: skillDir,
            filePath: skillFile,
          },
        ],
      }),
    };

    const result = await saveSkillConfig(gatewayManager as never, 'schedule-feishu', {
      apiKey: 'secret-token',
      env: { FEISHU_APP_ID: 'cli_123' },
      config: { schedule_doc_url: 'https://example.com/doc', max_retention_days: 14 },
    });

    expect(result).toEqual({ success: true });
    await expect(readFile(join(skillDir, 'config', '.env'), 'utf8')).resolves.toContain('FEISHU_APP_SECRET=secret-token');
    await expect(readFile(join(skillDir, 'config', '.env'), 'utf8')).resolves.toContain('FEISHU_APP_ID=cli_123');
    await expect(readFile(join(skillDir, 'config.json'), 'utf8')).resolves.toContain('"schedule_doc_url": "https://example.com/doc"');
    await expect(readFile(join(skillDir, 'config.json'), 'utf8')).resolves.toContain('"max_retention_days": 14');
  });

  it('keeps managed config saved when local mirror writes fail', async () => {
    const skillDir = join(testRoot, 'broken-mirror');
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, `---
name: broken-mirror
description: Broken mirror
metadata:
  openclaw:
    primaryEnv: BROKEN_API_KEY
    requires:
      env: [BROKEN_API_KEY]
---

# Broken mirror

Values are stored in config/.env.
`, 'utf8');

    updateSkillConfigMock.mockResolvedValue({ success: true });

    const { saveSkillConfig } = await import('@electron/utils/skill-details');
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        skills: [
          {
            skillKey: 'broken-mirror',
            eligible: false,
            missing: { env: ['BROKEN_API_KEY'] },
            baseDir: skillDir,
            filePath: skillFile,
          },
        ],
      }),
    };

    await writeFile(join(skillDir, 'config'), 'not-a-directory', 'utf8');

    const result = await saveSkillConfig(gatewayManager as never, 'broken-mirror', {
      apiKey: 'secret-token',
    });

    expect(result.success).toBe(true);
    expect(result.error).toContain('Managed skill config was saved');
    expect(updateSkillConfigMock).toHaveBeenCalledWith('broken-mirror', {
      apiKey: 'secret-token',
      env: {},
      config: {},
    });
  });
});
