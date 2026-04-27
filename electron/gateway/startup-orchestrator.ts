import { logger } from '../utils/logger';
import { LifecycleSupersededError } from './lifecycle-controller';
import { getGatewayStartupRecoveryAction } from './startup-recovery';

export interface ExistingGatewayInfo {
  port: number;
  externalToken?: string;
}

type StartupHooks = {
  port: number;
  ownedPid?: never; // Removed: pid is now read dynamically in findExistingGateway to avoid stale-snapshot bug
  shouldWaitForPortFree: boolean;
  maxStartAttempts?: number;
  resetStartupStderrLines: () => void;
  getStartupStderrLines: () => string[];
  assertLifecycle: (phase: string) => void;
  findExistingGateway: (port: number) => Promise<ExistingGatewayInfo | null>;
  connect: (port: number, externalToken?: string) => Promise<void>;
  onConnectedToExistingGateway: () => void;
  waitForPortFree: (port: number) => Promise<void>;
  startProcess: () => Promise<void>;
  waitForReady: (port: number) => Promise<void>;
  onConnectedToManagedGateway: () => void;
  runDoctorRepair: () => Promise<boolean>;
  onDoctorRepairSuccess: () => void;
  delay: (ms: number) => Promise<void>;
  /** Gateway 进程是否仍在运行（用于握手超时后判断是否可以直接重试 connect） */
  isProcessAlive?: () => boolean;
  /** 终止已拥有的 Gateway 进程（重试启动新进程前避免端口冲突） */
  killOwnedProcess?: () => void;
};

function isHandshakeTimeoutError(error: unknown): boolean {
  return error instanceof Error && /Connect handshake timeout/i.test(error.message);
}

function logStartupMonitor(message: string): void {
  const prefix = process.platform === 'win32'
    ? '[Windows Gateway Monitor]'
    : '[Gateway Monitor]';
  logger.info(`${prefix} ${message}`);
}

export async function runGatewayStartupSequence(hooks: StartupHooks): Promise<void> {
  let configRepairAttempted = false;
  let startAttempts = 0;
  const maxStartAttempts = hooks.maxStartAttempts ?? 3;
  const sequenceStartedAt = Date.now();

  while (true) {
    startAttempts++;
    hooks.assertLifecycle('start');
    hooks.resetStartupStderrLines();
    let stage = 'find-existing';
    const attemptStartedAt = Date.now();

    logStartupMonitor(
      `attempt=${startAttempts}/${maxStartAttempts} stage=${stage} port=${hooks.port} elapsed=${Date.now() - sequenceStartedAt}ms`,
    );

    try {
      logger.debug('Checking for existing Gateway...');
      const existing = await hooks.findExistingGateway(hooks.port);
      hooks.assertLifecycle('start/find-existing');
      if (existing) {
        stage = 'connect-existing';
        logStartupMonitor(
          `attempt=${startAttempts}/${maxStartAttempts} stage=${stage} existingPort=${existing.port} attemptElapsed=${Date.now() - attemptStartedAt}ms totalElapsed=${Date.now() - sequenceStartedAt}ms`,
        );
        logger.debug(`Found existing Gateway on port ${existing.port}`);
        await hooks.connect(existing.port, existing.externalToken);
        hooks.assertLifecycle('start/connect-existing');
        hooks.onConnectedToExistingGateway();
        logStartupMonitor(
          `attempt=${startAttempts}/${maxStartAttempts} stage=connected-existing outcome=success attemptElapsed=${Date.now() - attemptStartedAt}ms totalElapsed=${Date.now() - sequenceStartedAt}ms`,
        );
        return;
      }

      logger.debug('No existing Gateway found, starting new process...');

      if (hooks.shouldWaitForPortFree) {
        stage = 'wait-port-free';
        logStartupMonitor(
          `attempt=${startAttempts}/${maxStartAttempts} stage=${stage} attemptElapsed=${Date.now() - attemptStartedAt}ms totalElapsed=${Date.now() - sequenceStartedAt}ms`,
        );
        await hooks.waitForPortFree(hooks.port);
        hooks.assertLifecycle('start/wait-port');
      }

      stage = 'start-process';
      logStartupMonitor(
        `attempt=${startAttempts}/${maxStartAttempts} stage=${stage} attemptElapsed=${Date.now() - attemptStartedAt}ms totalElapsed=${Date.now() - sequenceStartedAt}ms`,
      );
      await hooks.startProcess();
      hooks.assertLifecycle('start/start-process');

      stage = 'wait-ready';
      logStartupMonitor(
        `attempt=${startAttempts}/${maxStartAttempts} stage=${stage} attemptElapsed=${Date.now() - attemptStartedAt}ms totalElapsed=${Date.now() - sequenceStartedAt}ms`,
      );
      await hooks.waitForReady(hooks.port);
      hooks.assertLifecycle('start/wait-ready');

      stage = 'connect';
      logStartupMonitor(
        `attempt=${startAttempts}/${maxStartAttempts} stage=${stage} attemptElapsed=${Date.now() - attemptStartedAt}ms totalElapsed=${Date.now() - sequenceStartedAt}ms`,
      );
      await hooks.connect(hooks.port);
      hooks.assertLifecycle('start/connect');

      hooks.onConnectedToManagedGateway();
      logStartupMonitor(
        `attempt=${startAttempts}/${maxStartAttempts} stage=connected-managed outcome=success attemptElapsed=${Date.now() - attemptStartedAt}ms totalElapsed=${Date.now() - sequenceStartedAt}ms`,
      );
      return;
    } catch (error) {
      if (error instanceof LifecycleSupersededError) {
        throw error;
      }

      logStartupMonitor(
        `attempt=${startAttempts}/${maxStartAttempts} stage=${stage} outcome=error attemptElapsed=${Date.now() - attemptStartedAt}ms totalElapsed=${Date.now() - sequenceStartedAt}ms error=${String(error)}`,
      );

      // 握手超时但 Gateway 进程仍活着：跳过进程重启，直接重试 connect。
      // 这避免了因端口占用导致的死锁（旧进程仍占端口，新进程无法启动）。
      if (
        isHandshakeTimeoutError(error)
        && hooks.isProcessAlive?.()
        && startAttempts < maxStartAttempts
      ) {
        startAttempts++;
        logger.warn(
          `Handshake timeout but Gateway process alive, retrying connect only... (${startAttempts}/${maxStartAttempts})`,
        );
        logStartupMonitor(
          `attempt=${startAttempts}/${maxStartAttempts} stage=retry-connect trigger=handshake-timeout totalElapsed=${Date.now() - sequenceStartedAt}ms`,
        );
        try {
          hooks.assertLifecycle('start/retry-connect');
          await hooks.connect(hooks.port);
          hooks.assertLifecycle('start/connect');
          hooks.onConnectedToManagedGateway();
          logStartupMonitor(
            `attempt=${startAttempts}/${maxStartAttempts} stage=retry-connect outcome=success totalElapsed=${Date.now() - sequenceStartedAt}ms`,
          );
          return;
        } catch (retryError) {
          if (retryError instanceof LifecycleSupersededError) throw retryError;
          logger.warn(`Connect-only retry also failed: ${String(retryError)}`);
          logStartupMonitor(
            `attempt=${startAttempts}/${maxStartAttempts} stage=retry-connect outcome=error totalElapsed=${Date.now() - sequenceStartedAt}ms error=${String(retryError)}`,
          );
          // 继续走标准恢复路径
        }
      }

      const recoveryAction = getGatewayStartupRecoveryAction({
        startupError: error,
        startupStderrLines: hooks.getStartupStderrLines(),
        configRepairAttempted,
        attempt: startAttempts,
        maxAttempts: maxStartAttempts,
      });

      if (recoveryAction === 'repair') {
        configRepairAttempted = true;
        logger.warn(
          'Detected invalid OpenClaw config during Gateway startup; running doctor repair before retry',
        );
        const repaired = await hooks.runDoctorRepair();
        if (repaired) {
          logger.info('OpenClaw doctor repair completed; retrying Gateway startup');
          hooks.onDoctorRepairSuccess();
          continue;
        }
        logger.error('OpenClaw doctor repair failed; not retrying Gateway startup');
      }

      if (recoveryAction === 'retry') {
        logger.warn(`Transient start error: ${String(error)}. Retrying... (${startAttempts}/${maxStartAttempts})`);
        // 重试前终止旧 Gateway 进程，避免端口冲突死锁
        if (hooks.isProcessAlive?.()) {
          logger.warn('Gateway process is still alive after transient start error; retrying without killing it');
          await hooks.delay(5000);
          continue;
        }
        hooks.killOwnedProcess?.();
        await hooks.delay(1000);
        continue;
      }

      throw error;
    }
  }
}
