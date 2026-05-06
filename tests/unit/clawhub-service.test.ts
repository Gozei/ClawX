import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readMarketplaceCacheMock = vi.fn();
const writeMarketplaceCacheMock = vi.fn();
const listSkillSourcesMock = vi.fn();
const getSkillSourceByIdMock = vi.fn();

const clawHubSource = {
  id: 'clawhub',
  label: 'ClawHub',
  enabled: true,
  site: 'https://clawhub.ai',
  apiQueryEndpoint: 'https://wry-manatee-359.convex.cloud/api/query',
  registry: 'https://clawhub.ai',
  workdir: 'C:/Users/test/.openclaw/skill-sources/clawhub',
};

vi.mock('electron', () => ({
  app: { isPackaged: false },
  shell: { openPath: vi.fn() },
}));

vi.mock('@electron/services/skills/marketplace-cache', () => ({
  invalidateMarketplaceCacheForSource: vi.fn(),
  invalidateMarketplaceCacheKey: vi.fn(),
  readMarketplaceCache: (...args: unknown[]) => readMarketplaceCacheMock(...args),
  writeMarketplaceCache: (...args: unknown[]) => writeMarketplaceCacheMock(...args),
}));

vi.mock('@electron/utils/paths', () => ({
  ensureDir: vi.fn(),
  getOpenClawConfigDir: () => 'C:/Users/test/.openclaw',
  getClawHubCliBinPath: () => 'C:/Users/test/project/node_modules/.bin/clawhub.cmd',
  getClawHubCliEntryPath: () => 'C:/Users/test/project/node_modules/clawhub/bin/clawdhub.js',
  quoteForCmd: (value: string) => `"${value}"`,
}));

vi.mock('@electron/utils/skill-sources', () => ({
  getSkillSourceById: (...args: unknown[]) => getSkillSourceByIdMock(...args),
  inferSkillSourceFromBaseDir: vi.fn(),
  listSkillSources: (...args: unknown[]) => listSkillSourcesMock(...args),
}));

describe('ClawHubService REST API integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    readMarketplaceCacheMock.mockResolvedValue(null);
    getSkillSourceByIdMock.mockResolvedValue(clawHubSource);
    listSkillSourcesMock.mockResolvedValue([clawHubSource]);
  });

  it('searches ClawHub through the v1 REST API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{
        slug: 'github',
        displayName: 'Github',
        summary: 'Interact with GitHub using the gh CLI.',
        version: null,
        score: 4.5,
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();

    const result = await service.search({ query: 'github', sourceId: 'clawhub', limit: 5 });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('https://clawhub.ai/api/v1/search?q=github&limit=5');
    expect(result.results).toEqual([{
      slug: 'github',
      name: 'Github',
      version: 'latest',
      description: 'Interact with GitHub using the gh CLI.',
      sourceId: 'clawhub',
      sourceLabel: 'ClawHub',
    }]);
    expect(writeMarketplaceCacheMock).toHaveBeenCalled();
  });

  it('explores ClawHub through the v1 REST API and preserves pagination', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        slug: 'self-improving-agent',
        displayName: 'Self-Improving Agent',
        summary: 'Captures learnings and corrections.',
        tags: { latest: '3.0.21' },
        stats: { downloads: 423378, stars: 3481 },
        latestVersion: { version: '3.0.21' },
      }],
      nextCursor: 'cursor-2',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();

    const result = await service.explore({ sourceId: 'clawhub', limit: 5, cursor: 'cursor-1' });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain('https://clawhub.ai/api/v1/skills?');
    expect(requestUrl).toContain('limit=5');
    expect(requestUrl).toContain('sort=downloads');
    expect(requestUrl).toContain('cursor=cursor-1');
    expect(result).toEqual({
      results: [{
        slug: 'self-improving-agent',
        name: 'Self-Improving Agent',
        version: '3.0.21',
        description: 'Captures learnings and corrections.',
        downloads: 423378,
        stars: 3481,
        sourceId: 'clawhub',
        sourceLabel: 'ClawHub',
      }],
      nextCursor: 'cursor-2',
    });
  });

  it('loads ClawHub detail and markdown through the readme action', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        skill: {
          slug: 'agentic-coding',
          displayName: 'Agentic Coding',
          summary: 'Ship production code with AI agents.',
          tags: { latest: '1.0.0' },
          stats: { downloads: 100, stars: 8 },
        },
        latestVersion: { version: '1.0.0', changelog: 'Initial release', license: null },
        owner: { handle: 'ivangdavila', displayName: 'Ivan', image: null },
        moderation: { isSuspicious: false, isMalwareBlocked: false, reasonCodes: [], summary: 'Clean' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        version: {
          version: '1.0.0',
          changelog: 'Initial release',
          files: [{ path: 'SKILL.md', size: 43, sha256: 'hash', contentType: 'text/markdown' }],
          security: {
            status: 'clean',
            scanners: { static: { status: 'clean', summary: 'No suspicious patterns detected.' } },
          },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'success',
        value: { latestVersion: { _id: 'version-id-1' } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'success',
        value: {
          path: 'SKILL.md',
          text: '# Agentic Coding\n\nShip code with contracts.',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();

    const detail = await service.getPublicSkillBySlug({ slug: 'agentic-coding', sourceId: 'clawhub' }) as {
      latestVersion?: { rawMarkdown?: string; files?: Array<{ path?: string }>; staticScan?: { status?: string } } | null;
      moderationInfo?: { summary?: string };
    };

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/skills/agentic-coding');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api/v1/skills/agentic-coding/versions/1.0.0');
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/api/query');
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      path: 'skills:getBySlug',
      args: [{ slug: 'agentic-coding' }],
    });
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain('/api/action');
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toMatchObject({
      path: 'skills:getReadme',
      args: [{ versionId: 'version-id-1' }],
    });
    expect(detail.latestVersion?.rawMarkdown).toContain('# Agentic Coding');
    expect(detail.latestVersion?.files?.[0]?.path).toBe('SKILL.md');
    expect(detail.latestVersion?.staticScan?.status).toBe('clean');
    expect(detail.moderationInfo?.summary).toBe('Clean');
  });

  it('falls back to the v1 download zip when the readme action fails', async () => {
    const zip = new JSZip();
    zip.file('SKILL.md', '# Agentic Coding\n\nShip code with contracts.');
    const zipBytes = await zip.generateAsync({ type: 'arraybuffer' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        skill: { slug: 'agentic-coding', displayName: 'Agentic Coding', tags: { latest: '1.0.0' } },
        latestVersion: { version: '1.0.0', changelog: 'Initial release', license: null },
        owner: null,
        moderation: null,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        version: {
          version: '1.0.0',
          files: [{ path: 'SKILL.md', size: 43, sha256: 'hash', contentType: 'text/markdown' }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'success',
        value: { latestVersion: { _id: 'version-id-1' } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('readme unavailable', { status: 500 }))
      .mockResolvedValueOnce(new Response(zipBytes, { status: 200, headers: { 'Content-Type': 'application/zip' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();

    const detail = await service.getPublicSkillBySlug({ slug: 'agentic-coding', sourceId: 'clawhub' }) as {
      latestVersion?: { rawMarkdown?: string } | null;
    };

    expect(String(fetchMock.mock.calls[4]?.[0])).toContain('/api/v1/download?slug=agentic-coding&version=1.0.0');
    expect(detail.latestVersion?.rawMarkdown).toContain('# Agentic Coding');
  });
});
