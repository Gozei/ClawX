import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  connectGatewaySocket: vi.fn(),
  getSetting: vi.fn(),
  lastToken: null as string | null,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

vi.mock('@electron/gateway/ws-client', () => ({
  connectGatewaySocket: state.connectGatewaySocket,
  waitForGatewayReady: vi.fn(),
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: state.getSetting,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@electron/utils/branding', () => ({
  getResolvedBranding: vi.fn(async () => ({ productName: 'Deep AI Worker' })),
}));

vi.mock('@electron/utils/telemetry', () => ({
  captureTelemetryEvent: vi.fn(),
  trackMetric: vi.fn(),
}));

function createMockWs() {
  return {
    readyState: 1,
    on: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

describe('GatewayManager connect token selection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.getSetting.mockResolvedValue('settings-token');
    state.connectGatewaySocket.mockImplementation(async (options: {
      getToken: () => Promise<string>;
      onHandshakeComplete: (ws: ReturnType<typeof createMockWs>) => void;
    }) => {
      const ws = createMockWs();
      const token = await options.getToken();
      state.lastToken = token;
      options.onHandshakeComplete(ws);
      return ws;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    state.lastToken = null;
  });

  it('reuses the managed launch token for owned gateway processes', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    (manager as unknown as { ownsProcess: boolean }).ownsProcess = true;
    (manager as unknown as { connectionToken: string }).connectionToken = 'launch-token';

    await (manager as unknown as { connect: (port: number) => Promise<void> }).connect(18789);

    expect(state.lastToken).toBe('launch-token');
    expect(state.getSetting).not.toHaveBeenCalled();

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('falls back to the persisted setting when there is no owned process token', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    (manager as unknown as { ownsProcess: boolean }).ownsProcess = false;
    (manager as unknown as { connectionToken: string | null }).connectionToken = 'stale-launch-token';

    await (manager as unknown as { connect: (port: number) => Promise<void> }).connect(18789);

    expect(state.lastToken).toBe('settings-token');
    expect(state.getSetting).toHaveBeenCalledWith('gatewayToken');

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('prefers an explicit external token when provided', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    (manager as unknown as { ownsProcess: boolean }).ownsProcess = true;
    (manager as unknown as { connectionToken: string }).connectionToken = 'launch-token';

    await (manager as unknown as { connect: (port: number, token?: string) => Promise<void> }).connect(18789, 'external-token');

    expect(state.lastToken).toBe('external-token');
    expect(state.getSetting).not.toHaveBeenCalled();

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });
});
