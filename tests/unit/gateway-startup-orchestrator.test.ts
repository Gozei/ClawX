import { describe, expect, it, vi } from 'vitest';
import { runGatewayStartupSequence } from '@electron/gateway/startup-orchestrator';

describe('runGatewayStartupSequence', () => {
  it('retries a transient connect failure without killing a live owned process', async () => {
    const delay = vi.fn().mockResolvedValue(undefined);
    const killOwnedProcess = vi.fn();
    const connect = vi.fn()
      .mockRejectedValueOnce(new Error('Timed out waiting for connect.challenge from Gateway'))
      .mockResolvedValueOnce(undefined);

    await runGatewayStartupSequence({
      port: 18789,
      shouldWaitForPortFree: true,
      maxStartAttempts: 2,
      resetStartupStderrLines: vi.fn(),
      getStartupStderrLines: () => [],
      assertLifecycle: vi.fn(),
      findExistingGateway: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ port: 18789 }),
      connect,
      onConnectedToExistingGateway: vi.fn(),
      waitForPortFree: vi.fn().mockResolvedValue(undefined),
      startProcess: vi.fn().mockResolvedValue(undefined),
      waitForReady: vi.fn().mockResolvedValue(undefined),
      onConnectedToManagedGateway: vi.fn(),
      runDoctorRepair: vi.fn().mockResolvedValue(false),
      onDoctorRepairSuccess: vi.fn(),
      delay,
      isProcessAlive: () => true,
      killOwnedProcess,
    });

    expect(killOwnedProcess).not.toHaveBeenCalled();
    expect(delay).toHaveBeenCalledWith(5000);
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
