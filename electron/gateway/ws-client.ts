import WebSocket from 'ws';
import type { DeviceIdentity } from '../utils/device-identity';
import type { PendingGatewayRequest } from './request-store';
import {
  buildDeviceAuthPayload,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from '../utils/device-identity';
import { DEFAULT_BRANDING } from '../../shared/branding';
import { logger } from '../utils/logger';

export const GATEWAY_CHALLENGE_TIMEOUT_MS = 10_000;
export const GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS = 30_000;

export async function probeGatewayReady(
  port: number,
  timeoutMs = 1500,
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const testWs = new WebSocket(`ws://localhost:${port}/ws`);
    let settled = false;

    const resolveOnce = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        // Use terminate() (TCP RST) instead of close() (WS close handshake)
        // to avoid leaving TIME_WAIT connections on Windows. These probe
        // WebSockets are short-lived and don't need a graceful close.
        testWs.terminate();
      } catch {
        // ignore
      }
      resolve(value);
    };

    const timeout = setTimeout(() => {
      resolveOnce(false);
    }, timeoutMs);

    testWs.on('open', () => {
      // Do not resolve on plain socket open. The gateway can accept the TCP/WebSocket
      // connection before it is ready to issue protocol challenges, which previously
      // caused a false "ready" result and then a full connect() stall.
    });

    testWs.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as { type?: string; event?: string };
        if (message.type === 'event' && message.event === 'connect.challenge') {
          resolveOnce(true);
        }
      } catch {
        // ignore malformed probe payloads
      }
    });

    testWs.on('error', () => {
      resolveOnce(false);
    });

    testWs.on('close', () => {
      resolveOnce(false);
    });
  });
}

// 分阶段探测间隔：启动早期慢探测减少对 Gateway 的干扰，
// 接近就绪时加速以降低响应延迟。
export function getDynamicProbeInterval(elapsedMs: number, _platform?: string): number {
  if (elapsedMs < 5_000) return 500;
  if (elapsedMs < 15_000) return 1000;
  return 500;
}

export async function waitForGatewayReady(options: {
  port: number;
  getProcessExitCode: () => number | null;
  maxWaitMs?: number;
}): Promise<void> {
  const maxWaitMs = options.maxWaitMs ?? 480_000;
  const startTime = Date.now();
  const logPrefix = process.platform === 'win32'
    ? '[Windows Gateway Monitor]'
    : '[Gateway Monitor]';

  let attempts = 0;
  while (Date.now() - startTime < maxWaitMs) {
    attempts++;
    const exitCode = options.getProcessExitCode();
    if (exitCode !== null) {
      logger.error(`Gateway process exited before ready (code=${exitCode})`);
      throw new Error(`Gateway process exited before becoming ready (code=${exitCode})`);
    }

    try {
      const ready = await probeGatewayReady(options.port, 1500);
      if (ready) {
        const elapsedMs = Date.now() - startTime;
        logger.info(
          `${logPrefix} wait-ready outcome=success port=${options.port} attempts=${attempts} elapsed=${elapsedMs}ms`,
        );
        return;
      }
    } catch {
      // Gateway not ready yet.
    }

    const monitorInterval = process.platform === 'win32' ? 5 : 10;
    if (attempts > 1 && attempts % monitorInterval === 0) {
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(0);
      logger.info(
        `${logPrefix} wait-ready outcome=pending port=${options.port} attempts=${attempts} elapsed=${elapsedSec}s`,
      );
    }

    const interval = getDynamicProbeInterval(Date.now() - startTime, process.platform);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(0);
  logger.error(`Gateway failed to become ready after ${attempts} attempts (${totalSec}s) on port ${options.port}`);
  throw new Error(`Gateway failed to start after ${totalSec}s (port ${options.port})`);
}

export function buildGatewayConnectFrame(options: {
  challengeNonce: string;
  token: string;
  deviceIdentity: DeviceIdentity | null;
  platform: string;
  brandingDisplayName?: string;
}): { connectId: string; frame: Record<string, unknown> } {
  const connectId = `connect-${Date.now()}`;
  const role = 'operator';
  const scopes = ['operator.admin'];
  const signedAtMs = Date.now();
  const clientId = 'gateway-client';
  const clientMode = 'ui';

  const device = (() => {
    if (!options.deviceIdentity) return undefined;

    const payload = buildDeviceAuthPayload({
      deviceId: options.deviceIdentity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token: options.token ?? null,
      nonce: options.challengeNonce,
    });
    const signature = signDevicePayload(options.deviceIdentity.privateKeyPem, payload);
    return {
      id: options.deviceIdentity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(options.deviceIdentity.publicKeyPem),
      signature,
      signedAt: signedAtMs,
      nonce: options.challengeNonce,
    };
  })();

  return {
    connectId,
    frame: {
      type: 'req',
      id: connectId,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: clientId,
          displayName: options.brandingDisplayName || DEFAULT_BRANDING.productName,
          version: '0.1.0',
          platform: options.platform,
          mode: clientMode,
        },
        auth: {
          token: options.token,
        },
        caps: [],
        role,
        scopes,
        device,
      },
    },
  };
}

// Gateway 内部 model-pricing 等初始化可能阻塞事件循环 ~60 秒。
// 在此期间 Gateway 能发 connect.challenge 但无法处理 connect RPC，
// 其自身的 ws handshake timeout 会先关闭连接。
// 此函数在握手阶段被 Gateway 关闭时自动重试，避免上层重启进程。
const CONNECT_MAX_RETRIES = 2;
const CONNECT_RETRY_DELAY_MS = 2_000;
const RETRYABLE_CONNECT_ERROR_PATTERN =
  /closed before handshake|Connect handshake timeout|Timed out waiting for connect\.challenge/i;

function attemptSingleConnect(options: {
  port: number;
  deviceIdentity: DeviceIdentity | null;
  platform: string;
  brandingDisplayName?: string;
  pendingRequests: Map<string, PendingGatewayRequest>;
  getToken: () => Promise<string>;
  onHandshakeComplete: (ws: WebSocket) => void;
  onMessage: (message: unknown) => void;
  onCloseAfterHandshake: (code: number) => void;
  challengeTimeoutMs: number;
  connectTimeoutMs: number;
}): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const wsUrl = `ws://localhost:${options.port}/ws`;
    const ws = new WebSocket(wsUrl);
    let handshakeComplete = false;
    let connectId: string | null = null;
    let handshakeTimeout: NodeJS.Timeout | null = null;
    let challengeTimer: NodeJS.Timeout | null = null;
    let challengeReceived = false;
    let settled = false;

    const cleanupHandshakeRequest = () => {
      if (challengeTimer) {
        clearTimeout(challengeTimer);
        challengeTimer = null;
      }
      if (handshakeTimeout) {
        clearTimeout(handshakeTimeout);
        handshakeTimeout = null;
      }
      if (connectId && options.pendingRequests.has(connectId)) {
        const request = options.pendingRequests.get(connectId);
        if (request) {
          clearTimeout(request.timeout);
        }
        options.pendingRequests.delete(connectId);
      }
    };

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanupHandshakeRequest();
      resolve(ws);
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanupHandshakeRequest();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const sendConnectHandshake = async (challengeNonce: string) => {
      logger.debug('Sending connect handshake with challenge nonce');

      const currentToken = await options.getToken();
      const connectPayload = buildGatewayConnectFrame({
        challengeNonce,
        token: currentToken,
        deviceIdentity: options.deviceIdentity,
        platform: options.platform,
      });
      connectId = connectPayload.connectId;

      ws.send(JSON.stringify(connectPayload.frame));

      const requestTimeout = setTimeout(() => {
        if (!handshakeComplete) {
          logger.error('Gateway connect handshake timed out');
          ws.close();
          rejectOnce(new Error('Connect handshake timeout'));
        }
      }, options.connectTimeoutMs);
      handshakeTimeout = requestTimeout;

      options.pendingRequests.set(connectId, {
        resolve: () => {
          handshakeComplete = true;
          logger.debug('Gateway connect handshake completed');
          options.onHandshakeComplete(ws);
          resolveOnce();
        },
        reject: (error) => {
          logger.error('Gateway connect handshake failed:', error);
          rejectOnce(error);
        },
        timeout: requestTimeout,
      });
    };

    challengeTimer = setTimeout(() => {
      if (!challengeReceived && !settled) {
        logger.error('Gateway connect.challenge not received within timeout');
        ws.close();
        rejectOnce(new Error('Timed out waiting for connect.challenge from Gateway'));
      }
    }, options.challengeTimeoutMs);

    ws.on('open', () => {
      logger.debug('Gateway WebSocket opened, waiting for connect.challenge...');
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (
          !challengeReceived &&
          typeof message === 'object' && message !== null &&
          message.type === 'event' && message.event === 'connect.challenge'
        ) {
          challengeReceived = true;
          if (challengeTimer) {
            clearTimeout(challengeTimer);
            challengeTimer = null;
          }
          const nonce = message.payload?.nonce as string | undefined;
          if (!nonce) {
            rejectOnce(new Error('Gateway connect.challenge missing nonce'));
            return;
          }
          logger.debug('Received connect.challenge, sending handshake');
          void sendConnectHandshake(nonce);
          return;
        }

        options.onMessage(message);
      } catch (error) {
        logger.debug('Failed to parse Gateway WebSocket message:', error);
      }
    });

    ws.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || 'unknown';
      logger.warn(`Gateway WebSocket closed (code=${code}, reason=${reasonStr}, handshake=${handshakeComplete ? 'ok' : 'pending'})`);
      if (!handshakeComplete) {
        rejectOnce(new Error(`WebSocket closed before handshake: ${reasonStr}`));
        return;
      }
      cleanupHandshakeRequest();
      options.onCloseAfterHandshake(code);
    });

    ws.on('error', (error) => {
      if (error.message?.includes('closed before handshake') || (error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        logger.debug(`Gateway WebSocket connection error (transient): ${error.message}`);
      } else {
        logger.error('Gateway WebSocket error:', error);
      }
      if (!handshakeComplete) {
        rejectOnce(error);
      }
    });
  });
}

export async function connectGatewaySocket(options: {
  port: number;
  deviceIdentity: DeviceIdentity | null;
  platform: string;
  brandingDisplayName?: string;
  pendingRequests: Map<string, PendingGatewayRequest>;
  getToken: () => Promise<string>;
  onHandshakeComplete: (ws: WebSocket) => void;
  onMessage: (message: unknown) => void;
  onCloseAfterHandshake: (code: number) => void;
  challengeTimeoutMs?: number;
  connectTimeoutMs?: number;
}): Promise<WebSocket> {
  const challengeTimeoutMs = options.challengeTimeoutMs ?? GATEWAY_CHALLENGE_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS;

  for (let attempt = 0; attempt <= CONNECT_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      logger.debug(`Connect retry ${attempt}/${CONNECT_MAX_RETRIES} after ${CONNECT_RETRY_DELAY_MS}ms`);
      await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_DELAY_MS));
    }
    // 重试时使用更长的 challenge timeout，因为 Gateway 刚从 model-pricing
    // 等阻塞操作恢复，可能需要更多时间才能发出 challenge。
    const effectiveChallengeTimeout = attempt > 0 ? Math.max(challengeTimeoutMs, 30_000) : challengeTimeoutMs;
    logger.debug(`Connecting Gateway WebSocket (ws://localhost:${options.port}/ws)${attempt > 0 ? ` [retry ${attempt}]` : ''}`);
    try {
      return await attemptSingleConnect({
        ...options,
        challengeTimeoutMs: effectiveChallengeTimeout,
        connectTimeoutMs,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // 仅在 Gateway 主动关闭 WS（handshake 阶段）或 RPC 超时时重试，
      // 其他错误（如 ECONNREFUSED）直接抛出。
      const isRetryable = RETRYABLE_CONNECT_ERROR_PATTERN.test(msg);
      if (!isRetryable || attempt >= CONNECT_MAX_RETRIES) {
        throw error;
      }
      logger.warn(`Gateway connection attempt ${attempt + 1} failed (${msg}), will retry...`);
    }
  }
  throw new Error('Connect retries exhausted (unreachable)');
}
