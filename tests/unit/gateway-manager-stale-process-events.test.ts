import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  launchGatewayProcess: vi.fn(),
  prepareGatewayLaunchContext: vi.fn(),
  unloadLaunchctlGatewayService: vi.fn(),
  loggerDebug: vi.fn(),
}));

class MockGatewayChild extends EventEmitter {
  pid?: number;
  kill = vi.fn();

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

vi.mock('@electron/gateway/config-sync', () => ({
  prepareGatewayLaunchContext: state.prepareGatewayLaunchContext,
}));

vi.mock('@electron/gateway/process-launcher', () => ({
  launchGatewayProcess: state.launchGatewayProcess,
}));

vi.mock('@electron/gateway/supervisor', () => ({
  findExistingGatewayProcess: vi.fn(),
  runOpenClawDoctorRepair: vi.fn(),
  terminateOwnedGatewayProcess: vi.fn(),
  unloadLaunchctlGatewayService: state.unloadLaunchctlGatewayService,
  waitForPortFree: vi.fn(),
  warmupManagedPythonReadiness: vi.fn(),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: state.loggerDebug,
  },
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: vi.fn(async () => undefined),
}));

vi.mock('@electron/utils/telemetry', () => ({
  captureTelemetryEvent: vi.fn(),
  trackMetric: vi.fn(),
}));

describe('GatewayManager stale process events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.prepareGatewayLaunchContext.mockResolvedValue({
      appSettings: { gatewayToken: 'launch-token' },
      openclawDir: '/tmp/openclaw',
      entryScript: '/tmp/openclaw/dist/cli.js',
      gatewayArgs: ['gateway'],
      forkEnv: {},
      mode: 'dev',
      binPathExists: false,
      loadedProviderKeyCount: 0,
      proxySummary: 'disabled',
      channelStartupSummary: 'skipped(no configured channels)',
      discoverySummary: 'mdns=minimal',
    });
    state.unloadLaunchctlGatewayService.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores exit and error callbacks from a superseded gateway child', async () => {
    const firstChild = new MockGatewayChild(1001);
    const secondChild = new MockGatewayChild(1002);
    const launchOptions: Array<{
      onExit: (child: MockGatewayChild, code: number | null) => void;
      onError: (error: Error) => void;
    }> = [];

    state.launchGatewayProcess
      .mockImplementationOnce(async (options) => {
        launchOptions.push(options);
        return { child: firstChild, lastSpawnSummary: 'first' };
      })
      .mockImplementationOnce(async (options) => {
        launchOptions.push(options);
        return { child: secondChild, lastSpawnSummary: 'second' };
      });

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    await (manager as unknown as { startProcess: () => Promise<void> }).startProcess();
    await (manager as unknown as { startProcess: () => Promise<void> }).startProcess();

    launchOptions[0].onExit(firstChild, 1);
    launchOptions[0].onError(new Error('late stale error'));

    expect((manager as unknown as { process: MockGatewayChild | null }).process).toBe(secondChild);
    expect((manager as unknown as { ownsProcess: boolean }).ownsProcess).toBe(true);
    expect((manager as unknown as { processExitCode: number | null }).processExitCode).toBeNull();
    expect(state.loggerDebug).toHaveBeenCalledWith(
      'Ignoring stale Gateway process exit (pid=1001, code=1)',
    );
    expect(state.loggerDebug).toHaveBeenCalledWith(
      'Ignoring stale Gateway process error (pid=1001)',
    );
  });
});
