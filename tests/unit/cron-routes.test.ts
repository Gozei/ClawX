import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let tempHomeDir: string | null = null;

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

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

describe('handleCronRoutes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
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
      delivery: expect.objectContaining({ mode: 'announce', to: 'wechat:wxid_target' }),
    }));
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        id: 'job-wechat',
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
    expect(rpc).toHaveBeenCalledWith('cron.list', { includeDisabled: true });

    const lastCall = sendJsonMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(200);
    expect(lastCall?.[2]).toEqual(expect.arrayContaining([
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
    ]));

    const [job] = lastCall?.[2] as Array<Record<string, unknown>>;
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
    expect(lastCall?.[2]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'job-from-disk',
        name: 'Recovered Job',
        message: 'Recovered prompt',
      }),
    ]));
  });
});
