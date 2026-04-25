import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

describe('Gateway preload', () => {
  it('forces nested PowerShell commands to emit UTF-8 text', async () => {
    const { getGatewayFetchPreloadSource } = await import('@electron/gateway/process-launcher');
    let capturedArgs: unknown[] = [];
    const original = vi.fn((...args: unknown[]) => {
      capturedArgs = args;
      return { pid: 1 };
    });
    const childProcess = {
      __clawxPatched: false,
      spawn: vi.fn(),
      exec: vi.fn(),
      execFile: original,
      fork: vi.fn(),
      spawnSync: vi.fn(),
      execSync: vi.fn(),
      execFileSync: vi.fn(),
    };

    vm.runInNewContext(getGatewayFetchPreloadSource('Deep AI Worker'), {
      Buffer,
      Response,
      fetch: vi.fn(),
      process: {
        platform: 'win32',
        env: { PATH: 'C:/Windows/System32' },
      },
      require: (moduleName: string) => {
        if (moduleName === 'child_process') return childProcess;
        throw new Error(`Unexpected require: ${moduleName}`);
      },
    });

    childProcess.execFile('powershell.exe', ['-NoProfile', '-Command', 'Write-Output "你好"']);

    expect(capturedArgs[0]).toBe('powershell.exe');
    expect(capturedArgs[1]).toEqual([
      '-NoProfile',
      '-Command',
      expect.stringContaining('[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);'),
    ]);
    expect(String((capturedArgs[1] as string[])[2])).toContain('Write-Output "你好"');
    expect(capturedArgs[2]).toMatchObject({
      windowsHide: true,
      env: {
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
      },
    });
  });
});
