import type { IncomingMessage, ServerResponse } from 'http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();
const listSkillsMock = vi.fn();
const getSkillDetailMock = vi.fn();
const saveSkillConfigMock = vi.fn();
const deleteSkillDirectoryMock = vi.fn();
const getAllSkillConfigsMock = vi.fn();
const updateSkillConfigMock = vi.fn();
const listSourcesMock = vi.fn();
const listSourceCountsMock = vi.fn();
const inferSourceFromBaseDirMock = vi.fn();
const uninstallMock = vi.fn();

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

vi.mock('@electron/utils/skill-details', () => ({
  listSkills: (...args: unknown[]) => listSkillsMock(...args),
  getSkillDetail: (...args: unknown[]) => getSkillDetailMock(...args),
  saveSkillConfig: (...args: unknown[]) => saveSkillConfigMock(...args),
  deleteSkillDirectory: (...args: unknown[]) => deleteSkillDirectoryMock(...args),
}));

vi.mock('@electron/utils/skill-config', () => ({
  getAllSkillConfigs: (...args: unknown[]) => getAllSkillConfigsMock(...args),
  updateSkillConfig: (...args: unknown[]) => updateSkillConfigMock(...args),
}));

describe('skill routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    listSourcesMock.mockResolvedValue([]);
    listSourceCountsMock.mockResolvedValue([]);
    inferSourceFromBaseDirMock.mockReturnValue(null);
  });

  it('serves aggregated skill list', async () => {
    const { handleSkillRoutes } = await import('@electron/api/routes/skills');
    listSkillsMock.mockResolvedValue([{ id: 'weather', name: 'Weather' }]);

    const handled = await handleSkillRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://localhost/api/skills'),
      { gatewayManager: {} } as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, [{ id: 'weather', name: 'Weather' }]);
  });

  it('serves aggregated skill detail', async () => {
    const { handleSkillRoutes } = await import('@electron/api/routes/skills');
    getSkillDetailMock.mockResolvedValue({ skill: { id: 'weather' } });

    await handleSkillRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://localhost/api/skills/weather'),
      { gatewayManager: {} } as never,
    );

    expect(getSkillDetailMock).toHaveBeenCalledWith({}, 'weather');
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, { skill: { id: 'weather' } });
  });

  it('saves skill config through the detail endpoint', async () => {
    const { handleSkillRoutes } = await import('@electron/api/routes/skills');
    parseJsonBodyMock.mockResolvedValue({ apiKey: 'token', env: { GH_TOKEN: 'token' } });
    saveSkillConfigMock.mockResolvedValue({ success: true });

    await handleSkillRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://localhost/api/skills/gh-issues/config'),
      { gatewayManager: {} } as never,
    );

    expect(saveSkillConfigMock).toHaveBeenCalledWith({}, 'gh-issues', {
      apiKey: 'token',
      env: { GH_TOKEN: 'token' },
    });
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, { success: true });
  });

  it('deletes the skill directory through the detail endpoint', async () => {
    const { handleSkillRoutes } = await import('@electron/api/routes/skills');
    getSkillDetailMock.mockResolvedValue({
      identity: {
        slug: 'weather',
        baseDir: 'C:/skills/weather',
      },
    });
    deleteSkillDirectoryMock.mockResolvedValue({ success: true });

    await handleSkillRoutes(
      { method: 'DELETE' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://localhost/api/skills/weather'),
      {
        gatewayManager: {},
        clawHubService: {
          listSources: (...args: unknown[]) => listSourcesMock(...args),
          inferSourceFromBaseDir: (...args: unknown[]) => inferSourceFromBaseDirMock(...args),
          uninstall: (...args: unknown[]) => uninstallMock(...args),
        },
      } as never,
    );

    expect(deleteSkillDirectoryMock).toHaveBeenCalledWith({}, 'weather');
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, { success: true });
  });

  it('uninstalls a marketplace skill through the detail endpoint when its source is inferred', async () => {
    const { handleSkillRoutes } = await import('@electron/api/routes/skills');
    getSkillDetailMock.mockResolvedValue({
      identity: {
        slug: 'self-improving-agent',
        baseDir: 'C:/Users/test/.openclaw/skill-sources/deepaiworker/skills/self-improving-agent',
      },
    });
    listSourcesMock.mockResolvedValue([{ id: 'deepaiworker' }]);
    inferSourceFromBaseDirMock.mockReturnValue({ id: 'deepaiworker' });
    uninstallMock.mockResolvedValue(undefined);

    await handleSkillRoutes(
      { method: 'DELETE' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://localhost/api/skills/self-improvement'),
      {
        gatewayManager: {},
        clawHubService: {
          listSources: (...args: unknown[]) => listSourcesMock(...args),
          inferSourceFromBaseDir: (...args: unknown[]) => inferSourceFromBaseDirMock(...args),
          uninstall: (...args: unknown[]) => uninstallMock(...args),
        },
      } as never,
    );

    expect(uninstallMock).toHaveBeenCalledWith({
      slug: 'self-improving-agent',
      sourceId: 'deepaiworker',
    });
    expect(deleteSkillDirectoryMock).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, { success: true });
  });

  it('serves marketplace source counts', async () => {
    const { handleSkillRoutes } = await import('@electron/api/routes/skills');
    listSourceCountsMock.mockResolvedValue([
      { sourceId: 'clawhub', sourceLabel: 'ClawHub', total: 55550 },
      { sourceId: 'deepaiworker', sourceLabel: 'DeepSkillHub', total: 10638 },
    ]);

    await handleSkillRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://localhost/api/clawhub/source-counts'),
      {
        gatewayManager: {},
        clawHubService: {
          listSourceCounts: (...args: unknown[]) => listSourceCountsMock(...args),
        },
      } as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      results: [
        { sourceId: 'clawhub', sourceLabel: 'ClawHub', total: 55550 },
        { sourceId: 'deepaiworker', sourceLabel: 'DeepSkillHub', total: 10638 },
      ],
    });
  });
});
