import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();
const isGatewayTransitioningMock = vi.fn(() => false);
const ensureWeChatPluginInstalledMock = vi.fn();
const ensureWeChatPluginRegistrationMock = vi.fn();
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let tempHomeDir: string | null = null;

vi.mock('@electron/api/route-utils', () => ({
  isGatewayTransitioning: (...args: unknown[]) => isGatewayTransitioningMock(...args),
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

vi.mock('@electron/utils/plugin-install', () => ({
  ensureWeChatPluginInstalled: (...args: unknown[]) => ensureWeChatPluginInstalledMock(...args),
}));

vi.mock('@electron/utils/channel-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/utils/channel-config')>();
  return {
    ...actual,
    ensureWeChatPluginRegistration: (...args: unknown[]) => ensureWeChatPluginRegistrationMock(...args),
  };
});

async function seedCronJobs(jobs: unknown[]) {
  tempHomeDir = await mkdtemp(join(tmpdir(), 'clawx-cron-route-'));
  process.env.HOME = tempHomeDir;
  process.env.USERPROFILE = tempHomeDir;

  const cronDir = join(tempHomeDir, '.openclaw', 'cron');
  await mkdir(cronDir, { recursive: true });
  await writeFile(
    join(cronDir, 'jobs.json'),
    JSON.stringify({ version: 1, jobs }, null, 2),
    'utf8',
  );
}

async function seedCronRuns(jobId: string, entries: unknown[]) {
  if (!tempHomeDir) {
    tempHomeDir = await mkdtemp(join(tmpdir(), 'clawx-cron-route-'));
    process.env.HOME = tempHomeDir;
    process.env.USERPROFILE = tempHomeDir;
  }

  const runsDir = join(tempHomeDir, '.openclaw', 'cron', 'runs');
  await mkdir(runsDir, { recursive: true });
  await writeFile(
    join(runsDir, `${jobId}.jsonl`),
    entries.map((entry) => JSON.stringify(entry)).join('\n'),
    'utf8',
  );
}

describe('handleCronRoutes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    isGatewayTransitioningMock.mockReturnValue(false);
    ensureWeChatPluginInstalledMock.mockReturnValue({ installed: true });
    ensureWeChatPluginRegistrationMock.mockResolvedValue(false);
    tempHomeDir = null;
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;

    if (tempHomeDir) {
      await rm(tempHomeDir, { recursive: true, force: true });
      tempHomeDir = null;
    }
  });

  it('returns cron status with gateway availability', async () => {
    const rpc = vi.fn().mockResolvedValue({
      enabled: true,
      jobs: 2,
      nextWakeAtMs: 1776913200000,
    });

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    await handleCronRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/status'),
      {
        gatewayManager: { rpc },
      } as never,
    );

    expect(rpc).toHaveBeenCalledWith('cron.status', {});
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        enabled: true,
        jobs: 2,
        gatewayAvailable: true,
      }),
    );
  });

  it('passes cron list pagination and sort params through', async () => {
    const rpc = vi.fn().mockResolvedValue({
      jobs: [],
      total: 0,
      offset: 10,
      nextOffset: null,
      hasMore: false,
    });

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    await handleCronRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/jobs?limit=25&offset=10&query=report&enabled=enabled&sortBy=name&sortDir=desc'),
      {
        gatewayManager: { rpc },
      } as never,
    );

    expect(rpc).toHaveBeenCalledWith('cron.list', {
      includeDisabled: true,
      limit: 25,
      offset: 10,
      enabled: 'enabled',
      sortBy: 'name',
      sortDir: 'desc',
      query: 'report',
    });
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        jobs: [],
        total: 0,
        offset: 10,
        hasMore: false,
      }),
    );
  });

  it('lists cron runs through the gateway with filters', async () => {
    const rpc = vi.fn().mockResolvedValue({
      entries: [{ jobId: 'job-1', status: 'error', deliveryStatus: 'not-delivered' }],
      total: 1,
      offset: 0,
      nextOffset: null,
      hasMore: false,
    });

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    await handleCronRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/runs?scope=job&id=job-1&statuses=error&deliveryStatuses=not-delivered&query=boom&sortDir=asc'),
      {
        gatewayManager: { rpc },
      } as never,
    );

    expect(rpc).toHaveBeenCalledWith('cron.runs', expect.objectContaining({
      scope: 'job',
      id: 'job-1',
      statuses: ['error'],
      deliveryStatuses: ['not-delivered'],
      query: 'boom',
      sortDir: 'asc',
    }));
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        entries: expect.arrayContaining([expect.objectContaining({ jobId: 'job-1' })]),
        gatewayAvailable: true,
      }),
    );
  });

  it('falls back to local cron run logs when cron.runs throws', async () => {
    await seedCronJobs([
      {
        id: 'job-runs',
        name: 'Run history job',
        enabled: true,
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        payload: { kind: 'agentTurn', message: 'Prompt' },
      },
    ]);
    await seedCronRuns('job-runs', [
      {
        ts: 1776913200000,
        jobId: 'job-runs',
        action: 'finished',
        status: 'ok',
        summary: 'Done',
        delivered: true,
        deliveryStatus: 'delivered',
        runAtMs: 1776913190000,
      },
    ]);

    const rpc = vi.fn()
      .mockRejectedValueOnce(new Error('Gateway not connected'))
      .mockRejectedValueOnce(new Error('Gateway not connected'));

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    await handleCronRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/runs?scope=job&id=job-runs'),
      {
        gatewayManager: { rpc },
      } as never,
    );

    const lastCall = sendJsonMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(200);
    expect(lastCall?.[2]).toEqual(expect.objectContaining({
      gatewayAvailable: false,
      entries: expect.arrayContaining([
        expect.objectContaining({
          jobId: 'job-runs',
          jobName: 'Run history job',
          deliveryStatus: 'delivered',
        }),
      ]),
    }));
  });

  it('creates cron jobs with external delivery configuration', async () => {
    parseJsonBodyMock.mockResolvedValue({
      name: 'Weather delivery',
      message: 'Summarize today',
      schedule: '0 9 * * *',
      delivery: {
        mode: 'announce',
        channel: 'feishu',
        to: 'user:ou_weather',
      },
      enabled: true,
    });

    const rpc = vi.fn().mockResolvedValue({
      id: 'job-1',
      name: 'Weather delivery',
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 2,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      payload: { kind: 'agentTurn', message: 'Summarize today' },
      delivery: { mode: 'announce', channel: 'feishu', to: 'user:ou_weather' },
      state: {},
    });

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    const handled = await handleCronRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/jobs'),
      {
        gatewayManager: { rpc },
      } as never,
    );

    expect(handled).toBe(true);
    expect(rpc).toHaveBeenCalledWith('cron.add', expect.objectContaining({
      delivery: { mode: 'announce', channel: 'feishu', to: 'user:ou_weather' },
      enabled: false,
      sessionTarget: 'isolated',
    }));
    expect(rpc).toHaveBeenCalledWith('cron.update', {
      id: 'job-1',
      patch: {
        sessionTarget: 'session:cron:job-1',
        enabled: true,
      },
    });
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        id: 'job-1',
        delivery: { mode: 'announce', channel: 'feishu', to: 'user:ou_weather' },
      }),
    );
  });

  it('binds newly created app cron jobs to a stable session before enabling them', async () => {
    parseJsonBodyMock.mockResolvedValue({
      name: 'Daily report',
      message: 'Summarize yesterday',
      schedule: '0 9 * * *',
      enabled: true,
    });

    const rpc = vi.fn()
      .mockResolvedValueOnce({
        id: 'daily-report',
        name: 'Daily report',
        enabled: false,
        createdAtMs: 1,
        updatedAtMs: 1,
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        payload: { kind: 'agentTurn', message: 'Summarize yesterday' },
        delivery: { mode: 'none' },
        sessionTarget: 'isolated',
        state: {},
      })
      .mockResolvedValueOnce({
        id: 'daily-report',
        name: 'Daily report',
        enabled: true,
        createdAtMs: 1,
        updatedAtMs: 2,
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        payload: { kind: 'agentTurn', message: 'Summarize yesterday' },
        delivery: { mode: 'none' },
        sessionTarget: 'session:cron:daily-report',
        state: {},
      });

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    await handleCronRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/jobs'),
      {
        gatewayManager: { rpc },
      } as never,
    );

    expect(rpc).toHaveBeenNthCalledWith(1, 'cron.add', expect.objectContaining({
      enabled: false,
      sessionTarget: 'isolated',
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'cron.update', {
      id: 'daily-report',
      patch: {
        sessionTarget: 'session:cron:daily-report',
        enabled: true,
      },
    });
  });

  it('updates cron jobs with transformed payload and delivery fields', async () => {
    parseJsonBodyMock.mockResolvedValue({
      message: 'Updated prompt',
      delivery: {
        mode: 'announce',
        channel: 'feishu',
        to: 'user:ou_next',
      },
    });

    const rpc = vi.fn().mockResolvedValue({
      id: 'job-2',
      name: 'Updated job',
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 3,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      payload: { kind: 'agentTurn', message: 'Updated prompt' },
      delivery: { mode: 'announce', channel: 'feishu', to: 'user:ou_next' },
      state: {},
    });

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    await handleCronRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/jobs/job-2'),
      {
        gatewayManager: { rpc },
      } as never,
    );

    expect(rpc).toHaveBeenCalledWith('cron.update', {
      id: 'job-2',
      patch: {
        payload: { kind: 'agentTurn', message: 'Updated prompt' },
        delivery: { mode: 'announce', channel: 'feishu', to: 'user:ou_next' },
      },
    });
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        id: 'job-2',
        message: 'Updated prompt',
        delivery: { mode: 'announce', channel: 'feishu', to: 'user:ou_next' },
      }),
    );
  });

  it('passes through delivery.accountId for multi-account cron jobs', async () => {
    parseJsonBodyMock.mockResolvedValue({
      delivery: {
        mode: 'announce',
        channel: 'feishu',
        to: 'user:ou_owner',
        accountId: 'feishu-0d009958',
      },
    });

    const rpc = vi.fn().mockResolvedValue({
      id: 'job-account',
      name: 'Account job',
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 4,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      payload: { kind: 'agentTurn', message: 'Prompt' },
      delivery: { mode: 'announce', channel: 'feishu', accountId: 'feishu-0d009958', to: 'user:ou_owner' },
      state: {},
    });

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    await handleCronRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/jobs/job-account'),
      {
        gatewayManager: { rpc },
      } as never,
    );

    expect(rpc).toHaveBeenCalledWith('cron.update', {
      id: 'job-account',
      patch: {
        delivery: {
          mode: 'announce',
          channel: 'feishu',
          to: 'user:ou_owner',
          accountId: 'feishu-0d009958',
        },
      },
    });
  });

  it('allows WeChat scheduled delivery', async () => {
    parseJsonBodyMock.mockResolvedValue({
      name: 'WeChat delivery',
      message: 'Send update',
      schedule: '0 10 * * *',
      delivery: {
        mode: 'announce',
        channel: 'wechat',
        to: 'wechat:wxid_target',
        accountId: 'wechat-bot',
      },
      enabled: true,
    });

    const rpc = vi.fn().mockResolvedValue({
      id: 'job-wechat',
      name: 'WeChat delivery',
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 2,
      schedule: { kind: 'cron', expr: '0 10 * * *' },
      payload: { kind: 'agentTurn', message: 'Send update' },
      delivery: { mode: 'announce', channel: 'openclaw-weixin', to: 'wechat:wxid_target', accountId: 'wechat-bot' },
      state: {},
    });
    const debouncedRestart = vi.fn();

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    const handled = await handleCronRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/jobs'),
      {
        gatewayManager: { rpc, debouncedRestart, getStatus: () => ({ state: 'running' }) },
      } as never,
    );

    expect(handled).toBe(true);
    expect(ensureWeChatPluginInstalledMock).toHaveBeenCalled();
    expect(ensureWeChatPluginRegistrationMock).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('cron.add', expect.objectContaining({
      delivery: {
        mode: 'announce',
        channel: 'openclaw-weixin',
        to: 'wechat:wxid_target',
        accountId: 'wechat-bot',
      },
    }));
    expect(debouncedRestart).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        id: 'job-wechat',
      }),
    );
  });

  it('restarts after creating a WeChat cron job only when plugin registration changed', async () => {
    ensureWeChatPluginRegistrationMock.mockResolvedValueOnce(true);
    parseJsonBodyMock.mockResolvedValue({
      name: 'WeChat delivery',
      message: 'Send update',
      schedule: '0 10 * * *',
      delivery: {
        mode: 'announce',
        channel: 'wechat',
        to: 'wechat:wxid_target',
        accountId: 'wechat-bot',
      },
      enabled: true,
    });

    const rpc = vi.fn().mockResolvedValue({
      id: 'job-wechat',
      name: 'WeChat delivery',
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 2,
      schedule: { kind: 'cron', expr: '0 10 * * *' },
      payload: { kind: 'agentTurn', message: 'Send update' },
      delivery: { mode: 'announce', channel: 'openclaw-weixin', to: 'wechat:wxid_target', accountId: 'wechat-bot' },
      state: {},
    });
    const debouncedRestart = vi.fn();

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    await handleCronRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/jobs'),
      {
        gatewayManager: { rpc, debouncedRestart, getStatus: () => ({ state: 'running' }) },
      } as never,
    );

    expect(ensureWeChatPluginRegistrationMock).toHaveBeenCalled();
    expect(debouncedRestart).toHaveBeenCalledTimes(1);
  });

  it('recovers WeChat cron jobs when the gateway reports missing outbound configuration', async () => {
    const debouncedRestart = vi.fn();
    const rpc = vi.fn().mockResolvedValue({
      jobs: [
        {
          id: 'job-wechat-recover',
          name: 'WeChat recovery',
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 2,
          schedule: { kind: 'cron', expr: '*/5 * * * *' },
          payload: { kind: 'agentTurn', message: 'Send update' },
          delivery: { mode: 'announce', channel: 'openclaw-weixin', to: 'wechat:wxid_target', accountId: 'wechat-bot' },
          state: {
            lastRunAtMs: 3,
            lastStatus: 'error',
            lastError: 'Error: Outbound not configured for channel: openclaw-weixin',
          },
        },
      ],
    });

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    await handleCronRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/jobs'),
      {
        gatewayManager: { rpc, debouncedRestart, getStatus: () => ({ state: 'running' }) },
      } as never,
    );

    expect(ensureWeChatPluginInstalledMock).toHaveBeenCalled();
    expect(ensureWeChatPluginRegistrationMock).toHaveBeenCalled();
    expect(debouncedRestart).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        jobs: expect.arrayContaining([
          expect.objectContaining({
            id: 'job-wechat-recover',
            delivery: expect.objectContaining({ channel: 'wechat' }),
          }),
        ]),
      }),
    );
  });

  it('falls back to local cron jobs when gateway returns an empty list', async () => {
    const nextRunAtMs = 1776913200000;
    await seedCronJobs([
      {
        id: 'daily-computing-power-report',
        name: 'Daily Computing Power Report',
        enabled: true,
        schedule: { kind: 'cron', expr: '0 11 * * *', tz: 'Asia/Shanghai' },
        payload: { kind: 'agentTurn', message: 'Generate the report deck.' },
        sessionTarget: 'isolated',
        state: { nextRunAtMs },
      },
    ]);

    const rpc = vi.fn().mockResolvedValue({ jobs: [] });

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    const handled = await handleCronRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/jobs'),
      {
        gatewayManager: { rpc },
      } as never,
    );

    expect(handled).toBe(true);
    expect(rpc).toHaveBeenCalledWith('cron.list', expect.objectContaining({ includeDisabled: true }));

    const lastCall = sendJsonMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(200);
    expect(lastCall?.[2]).toEqual(expect.objectContaining({
      gatewayAvailable: true,
      jobs: expect.arrayContaining([
      expect.objectContaining({
        id: 'daily-computing-power-report',
        name: 'Daily Computing Power Report',
        message: 'Generate the report deck.',
        enabled: true,
        nextRun: new Date(nextRunAtMs).toISOString(),
        schedule: expect.objectContaining({
          kind: 'cron',
          expr: '0 11 * * *',
          tz: 'Asia/Shanghai',
        }),
      }),
    ]),
    }));

    const [job] = (lastCall?.[2] as { jobs: Array<Record<string, unknown>> }).jobs;
    expect(typeof job.createdAt).toBe('string');
    expect(typeof job.updatedAt).toBe('string');
  });

  it('falls back to local cron jobs when gateway cron.list throws', async () => {
    await seedCronJobs([
      {
        id: 'job-from-disk',
        name: 'Recovered Job',
        enabled: true,
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        payload: { kind: 'agentTurn', message: 'Recovered prompt' },
        state: {},
      },
    ]);

    const rpc = vi.fn().mockRejectedValue(new Error('Gateway not connected'));

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    await handleCronRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/jobs'),
      {
        gatewayManager: { rpc },
      } as never,
    );

    const lastCall = sendJsonMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(200);
    expect(lastCall?.[2]).toEqual(expect.objectContaining({
      gatewayAvailable: false,
      jobs: expect.arrayContaining([
        expect.objectContaining({
          id: 'job-from-disk',
          name: 'Recovered Job',
          message: 'Recovered prompt',
        }),
      ]),
    }));
  });
});
