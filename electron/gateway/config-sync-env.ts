export const SUPERVISED_SYSTEMD_ENV_KEYS = [
  'OPENCLAW_SYSTEMD_UNIT',
  'INVOCATION_ID',
  'SYSTEMD_EXEC_PID',
  'JOURNAL_STREAM',
] as const;

export type GatewayEnv = Record<string, string | undefined>;

const UTF8_RUNTIME_ENV: GatewayEnv = {
  PYTHONIOENCODING: 'utf-8',
  PYTHONUTF8: '1',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  LC_CTYPE: 'C.UTF-8',
};

/**
 * OpenClaw CLI treats certain environment variables as systemd supervisor hints.
 * When present in ClawX-owned child-process launches, it can mistakenly enter
 * a supervised process retry loop. Strip those variables so startup follows
 * ClawX lifecycle.
 */
export function stripSystemdSupervisorEnv(env: GatewayEnv): GatewayEnv {
  const next = { ...env };
  for (const key of SUPERVISED_SYSTEMD_ENV_KEYS) {
    delete next[key];
  }
  return next;
}

/**
 * Force UTF-8 defaults for the Gateway and tools it launches. This prevents
 * Windows console/OEM-codepage output from being decoded as UTF-8 later in the
 * chat event stream.
 */
export function withUtf8RuntimeEnv(env: GatewayEnv): GatewayEnv {
  return {
    ...env,
    ...UTF8_RUNTIME_ENV,
  };
}
