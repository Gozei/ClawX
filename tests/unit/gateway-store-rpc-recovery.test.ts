import { beforeEach, describe, expect, it, vi } from 'vitest';

const { hostApiFetchMock, invokeIpcMock } = vi.hoisted(() => ({
  hostApiFetchMock: vi.fn(),
  invokeIpcMock: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

describe('gateway store rpc recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('preflights chat.send with gateway health before dispatch', async () => {
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/gateway/health') {
        return { ok: true, uptime: 12 };
      }
      throw new Error(`Unexpected host API call: ${path}`);
    });
    invokeIpcMock.mockResolvedValue({ success: true, result: { runId: 'run-1' } });

    const { useGatewayStore } = await import('@/stores/gateway');
    useGatewayStore.setState({
      status: { state: 'running', port: 18789, pid: 1234, connectedAt: Date.now() - 12_000 },
      health: null,
      isInitialized: true,
      lastError: null,
    });

    const result = await useGatewayStore.getState().rpc<{ runId: string }>(
      'chat.send',
      { sessionKey: 'agent:main:main', message: 'hello' },
      120_000,
    );

    expect(result.runId).toBe('run-1');
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/gateway/health');
    expect(invokeIpcMock).toHaveBeenCalledWith(
      'gateway:rpc',
      'chat.send',
      { sessionKey: 'agent:main:main', message: 'hello' },
      120_000,
    );
  });

  it('restarts the gateway when chat.send preflight detects an unresponsive socket', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/api/gateway/health') {
        return { ok: false, error: 'Gateway ping timeout after 3000ms' };
      }
      if (path === '/api/gateway/restart') {
        return { success: true };
      }
      throw new Error(`Unexpected host API call: ${path} ${init?.method || ''}`);
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    useGatewayStore.setState({
      status: { state: 'running', port: 18789, pid: 1234, connectedAt: Date.now() - 15_000 },
      health: null,
      isInitialized: true,
      lastError: null,
    });

    await expect(
      useGatewayStore.getState().rpc(
        'chat.send',
        { sessionKey: 'agent:main:main', message: 'hello' },
        120_000,
      ),
    ).rejects.toThrow('Gateway is connected but not responding');

    await Promise.resolve();

    expect(invokeIpcMock).not.toHaveBeenCalled();
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(1, '/api/gateway/health');
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(2, '/api/gateway/restart', { method: 'POST' });
    expect(useGatewayStore.getState().status.state).toBe('starting');
  });

  it('restarts the gateway after a critical RPC timeout', async () => {
    hostApiFetchMock.mockResolvedValue({ success: true });
    invokeIpcMock.mockResolvedValue({ success: false, error: 'Error: RPC timeout: chat.history' });

    const { useGatewayStore } = await import('@/stores/gateway');
    useGatewayStore.setState({
      status: { state: 'running', port: 18789, pid: 1234, connectedAt: Date.now() - 30_000 },
      health: null,
      isInitialized: true,
      lastError: null,
    });

    await expect(
      useGatewayStore.getState().rpc('chat.history', { sessionKey: 'agent:main:main', limit: 1 }, 60_000),
    ).rejects.toThrow('RPC timeout: chat.history');

    await Promise.resolve();

    expect(invokeIpcMock).toHaveBeenCalledWith(
      'gateway:rpc',
      'chat.history',
      { sessionKey: 'agent:main:main', limit: 1 },
      60_000,
    );
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/gateway/restart', { method: 'POST' });
    expect(useGatewayStore.getState().status.state).toBe('starting');
  });

  it('cooldowns repeated automatic restarts for the same failure burst', async () => {
    hostApiFetchMock.mockResolvedValue({ success: true });
    invokeIpcMock.mockResolvedValue({ success: false, error: 'Error: RPC timeout: chat.history' });

    const { useGatewayStore } = await import('@/stores/gateway');
    useGatewayStore.setState({
      status: { state: 'running', port: 18789, pid: 1234, connectedAt: Date.now() - 30_000 },
      health: null,
      isInitialized: true,
      lastError: null,
    });

    await expect(
      useGatewayStore.getState().rpc('chat.history', { sessionKey: 'agent:main:main', limit: 1 }, 60_000),
    ).rejects.toThrow('RPC timeout: chat.history');
    await Promise.resolve();

    useGatewayStore.setState({
      status: { state: 'running', port: 18789, pid: 1234, connectedAt: Date.now() - 30_000 },
    });

    await expect(
      useGatewayStore.getState().rpc('chat.history', { sessionKey: 'agent:main:main', limit: 1 }, 60_000),
    ).rejects.toThrow('RPC timeout: chat.history');
    await Promise.resolve();

    expect(hostApiFetchMock).toHaveBeenCalledTimes(1);
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/gateway/restart', { method: 'POST' });
  });
});
