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

  it('dispatches chat.send without a gateway health preflight', async () => {
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
    expect(hostApiFetchMock).not.toHaveBeenCalled();
    expect(invokeIpcMock).toHaveBeenCalledWith(
      'gateway:rpc',
      'chat.send',
      { sessionKey: 'agent:main:main', message: 'hello' },
      120_000,
    );
  });

  it('does not restart the gateway when chat.send fails during an active turn', async () => {
    hostApiFetchMock.mockResolvedValue({ success: true });
    invokeIpcMock.mockResolvedValue({ success: false, error: 'Error: Gateway not connected' });

    const { useChatStore } = await import('../../src/stores/chat');
    const { useGatewayStore } = await import('@/stores/gateway');
    useChatStore.setState({
      sending: true,
      pendingFinal: false,
      activeRunId: null,
      sessionRunningState: {},
    } as never);
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
    ).rejects.toThrow('Gateway not connected');

    await Promise.resolve();

    expect(invokeIpcMock).toHaveBeenCalledWith(
      'gateway:rpc',
      'chat.send',
      { sessionKey: 'agent:main:main', message: 'hello' },
      120_000,
    );
    expect(hostApiFetchMock).not.toHaveBeenCalled();
    expect(useGatewayStore.getState().status.state).toBe('running');
  });

  it('does not restart the gateway for chat.history timeouts during an active turn', async () => {
    hostApiFetchMock.mockResolvedValue({ success: true });
    invokeIpcMock.mockResolvedValue({ success: false, error: 'Error: RPC timeout: chat.history' });

    const { useChatStore } = await import('../../src/stores/chat');
    const { useGatewayStore } = await import('@/stores/gateway');
    useChatStore.setState({
      sending: true,
      pendingFinal: false,
      activeRunId: 'run-live',
      sessionRunningState: { 'agent:main:main': true },
    } as never);
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
    expect(hostApiFetchMock).not.toHaveBeenCalled();
    expect(useGatewayStore.getState().status.state).toBe('running');
  });

  it('restarts the gateway after an idle critical RPC timeout', async () => {
    hostApiFetchMock.mockResolvedValue({ success: true });
    invokeIpcMock.mockResolvedValue({ success: false, error: 'Error: RPC timeout: chat.history' });

    const { useChatStore } = await import('../../src/stores/chat');
    const { useGatewayStore } = await import('@/stores/gateway');
    useChatStore.setState({
      sending: false,
      pendingFinal: false,
      activeRunId: null,
      sessionRunningState: {},
    } as never);
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

    const { useChatStore } = await import('../../src/stores/chat');
    const { useGatewayStore } = await import('@/stores/gateway');
    useChatStore.setState({
      sending: false,
      pendingFinal: false,
      activeRunId: null,
      sessionRunningState: {},
    } as never);
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
