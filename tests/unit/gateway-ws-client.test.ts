import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wsState = vi.hoisted(() => ({
  sockets: [] as unknown[],
  MockWebSocket: class MockWebSocket {
    readonly sentFrames: string[] = [];
    readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    readyState = 1;
    readonly close = vi.fn((code = 1000, reason = '') => {
      this.readyState = 3;
      queueMicrotask(() => {
        this.emit('close', code, Buffer.from(String(reason)));
      });
    });
    readonly send = vi.fn((payload: string) => {
      this.sentFrames.push(payload);
    });

    constructor(public readonly url: string) {
      wsState.sockets.push(this);
    }

    on(event: string, callback: (...args: unknown[]) => void): this {
      const current = this.listeners.get(event) ?? new Set();
      current.add(callback);
      this.listeners.set(event, current);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const callback of this.listeners.get(event) ?? []) {
        callback(...args);
      }
    }

    emitOpen(): void {
      this.emit('open');
    }

    emitJsonMessage(message: unknown): void {
      this.emit('message', Buffer.from(JSON.stringify(message)));
    }
  },
}));

type MockWebSocket = InstanceType<typeof wsState.MockWebSocket>;

vi.mock('ws', () => ({
  default: wsState.MockWebSocket,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS,
  connectGatewaySocket,
  getDynamicProbeInterval,
} from '@electron/gateway/ws-client';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function getLatestSocket(): MockWebSocket {
  const socket = wsState.sockets[wsState.sockets.length - 1];
  if (!socket) {
    throw new Error('Expected a mocked WebSocket instance');
  }
  return socket as MockWebSocket;
}

describe('connectGatewaySocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsState.sockets.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    wsState.sockets.length = 0;
  });

  it('keeps the handshake alive long enough for slower gateway restart responses', async () => {
    const pendingRequests = new Map();
    const onHandshakeComplete = vi.fn();

    const connectionPromise = connectGatewaySocket({
      port: 18789,
      deviceIdentity: null,
      platform: 'win32',
      pendingRequests,
      getToken: vi.fn().mockResolvedValue('token-123'),
      onHandshakeComplete,
      onMessage: (message) => {
        if (typeof message !== 'object' || message === null) return;
        const msg = message as { type?: string; id?: string; ok?: boolean; payload?: unknown; error?: unknown };
        if (msg.type !== 'res' || typeof msg.id !== 'string') return;
        const pending = pendingRequests.get(msg.id);
        if (!pending) return;
        if (msg.ok === false || msg.error) {
          pending.reject(new Error(String(msg.error ?? 'Gateway request failed')));
          return;
        }
        pending.resolve(msg.payload ?? msg);
      },
      onCloseAfterHandshake: vi.fn(),
    });

    const socket = getLatestSocket();
    socket.emitOpen();
    socket.emitJsonMessage({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'nonce-123' },
    });

    await flushMicrotasks();

    expect(socket.sentFrames).toHaveLength(1);
    const connectFrame = JSON.parse(socket.sentFrames[0]) as { id: string; method: string };
    expect(connectFrame.method).toBe('connect');
    expect(pendingRequests.size).toBe(1);

    await vi.advanceTimersByTimeAsync(GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS - 1_000);
    expect(onHandshakeComplete).not.toHaveBeenCalled();

    socket.emitJsonMessage({
      type: 'res',
      id: connectFrame.id,
      ok: true,
      payload: { protocol: 3 },
    });

    await expect(connectionPromise).resolves.toBe(socket);
    expect(onHandshakeComplete).toHaveBeenCalledWith(socket);
    expect(pendingRequests.size).toBe(0);
  });

  it('still fails when the connect response exceeds the configured timeout after handshake retries are exhausted', async () => {
    const pendingRequests = new Map();

    const connectionPromise = connectGatewaySocket({
      port: 18789,
      deviceIdentity: null,
      platform: 'win32',
      pendingRequests,
      getToken: vi.fn().mockResolvedValue('token-123'),
      onHandshakeComplete: vi.fn(),
      onMessage: vi.fn(),
      onCloseAfterHandshake: vi.fn(),
      connectTimeoutMs: 1_000,
    });
    const connectionErrorPromise = connectionPromise.then(
      () => null,
      (error) => error,
    );

    const socket = getLatestSocket();
    socket.emitOpen();
    socket.emitJsonMessage({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'nonce-123' },
    });

    await flushMicrotasks();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await vi.advanceTimersByTimeAsync(1_001);
      await flushMicrotasks();

      if (attempt === 2) {
        break;
      }

      await vi.advanceTimersByTimeAsync(2_000);
      const retrySocket = getLatestSocket();
      retrySocket.emitOpen();
      retrySocket.emitJsonMessage({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: `nonce-retry-${attempt}` },
      });
      await flushMicrotasks();
    }

    const connectionError = await connectionErrorPromise;
    expect(connectionError).toBeInstanceOf(Error);
    expect((connectionError as Error).message).toBe('Connect handshake timeout');
    await flushMicrotasks();
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(pendingRequests.size).toBe(0);
  });
});

describe('getDynamicProbeInterval', () => {
  it('returns 2000ms for the first 30s on non-Windows platforms', () => {
    expect(getDynamicProbeInterval(0)).toBe(2000);
    expect(getDynamicProbeInterval(15_000)).toBe(2000);
    expect(getDynamicProbeInterval(29_999)).toBe(2000);
  });

  it('returns 1000ms between 30s and 120s on non-Windows platforms', () => {
    expect(getDynamicProbeInterval(30_000)).toBe(1000);
    expect(getDynamicProbeInterval(60_000)).toBe(1000);
    expect(getDynamicProbeInterval(119_999)).toBe(1000);
  });

  it('returns 500ms after 120s on non-Windows platforms', () => {
    expect(getDynamicProbeInterval(120_000)).toBe(500);
    expect(getDynamicProbeInterval(300_000)).toBe(500);
  });

  it('returns 500ms for the first 5s on Windows', () => {
    expect(getDynamicProbeInterval(0, 'win32')).toBe(500);
    expect(getDynamicProbeInterval(2_500, 'win32')).toBe(500);
    expect(getDynamicProbeInterval(4_999, 'win32')).toBe(500);
  });

  it('returns 1000ms between 5s and 15s on Windows', () => {
    expect(getDynamicProbeInterval(5_000, 'win32')).toBe(1000);
    expect(getDynamicProbeInterval(10_000, 'win32')).toBe(1000);
    expect(getDynamicProbeInterval(14_999, 'win32')).toBe(1000);
  });

  it('returns 500ms after 15s on Windows', () => {
    expect(getDynamicProbeInterval(15_000, 'win32')).toBe(500);
    expect(getDynamicProbeInterval(60_000, 'win32')).toBe(500);
  });
});
