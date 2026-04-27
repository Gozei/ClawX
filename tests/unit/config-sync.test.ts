import { describe, expect, it } from 'vitest';
import {
  resolveChannelStartupPolicyForConfiguredChannels,
  stripSystemdSupervisorEnv,
  withUtf8RuntimeEnv,
} from '@electron/gateway/config-sync-env';

describe('stripSystemdSupervisorEnv', () => {
  it('removes systemd supervisor marker env vars', () => {
    const env = {
      PATH: '/usr/bin:/bin',
      OPENCLAW_SYSTEMD_UNIT: 'openclaw-gateway.service',
      INVOCATION_ID: 'abc123',
      SYSTEMD_EXEC_PID: '777',
      JOURNAL_STREAM: '8:12345',
      OTHER: 'keep-me',
    };

    const result = stripSystemdSupervisorEnv(env);

    expect(result).toEqual({
      PATH: '/usr/bin:/bin',
      OTHER: 'keep-me',
    });
  });

  it('keeps unrelated variables unchanged', () => {
    const env = {
      NODE_ENV: 'production',
      OPENCLAW_GATEWAY_TOKEN: 'token',
      CLAWDBOT_SKIP_CHANNELS: '0',
    };

    expect(stripSystemdSupervisorEnv(env)).toEqual(env);
  });

  it('does not mutate source env object', () => {
    const env = {
      OPENCLAW_SYSTEMD_UNIT: 'openclaw-gateway.service',
      VALUE: '1',
    };
    const before = { ...env };

    const result = stripSystemdSupervisorEnv(env);

    expect(env).toEqual(before);
    expect(result).toEqual({ VALUE: '1' });
  });
});

describe('withUtf8RuntimeEnv', () => {
  it('sets UTF-8 defaults without removing existing env vars', () => {
    const result = withUtf8RuntimeEnv({
      PATH: '/usr/bin:/bin',
      OPENCLAW_GATEWAY_TOKEN: 'token',
    });

    expect(result).toMatchObject({
      PATH: '/usr/bin:/bin',
      OPENCLAW_GATEWAY_TOKEN: 'token',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      LC_CTYPE: 'C.UTF-8',
    });
  });
});

describe('resolveChannelStartupPolicyForConfiguredChannels', () => {
  it('does not export a stale skip-channel environment when no channels are configured', () => {
    expect(resolveChannelStartupPolicyForConfiguredChannels([])).toEqual({
      skipChannels: false,
      channelStartupSummary: 'idle(no configured channels)',
    });
  });

  it('reports configured channels without enabling the skip-channel guard', () => {
    expect(resolveChannelStartupPolicyForConfiguredChannels(['openclaw-weixin'])).toEqual({
      skipChannels: false,
      channelStartupSummary: 'enabled(openclaw-weixin)',
    });
  });
});
