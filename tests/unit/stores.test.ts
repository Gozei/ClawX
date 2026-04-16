/**
 * Zustand Stores Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';

describe('Settings Store', () => {
  beforeEach(() => {
    // Reset store to default state
    useSettingsStore.setState({
      theme: 'system',
      language: 'en',
      sidebarCollapsed: false,
      sidebarWidth: 256,
      devModeUnlocked: false,
      gatewayAutoStart: true,
      gatewayPort: 18789,
      autoCheckUpdate: true,
      autoDownloadUpdate: false,
      startMinimized: false,
      launchAtStartup: false,
      telemetryEnabled: true,
      logLevel: 'debug',
      auditEnabled: true,
      auditMode: 'minimal',
      appLogRetentionDays: 14,
      auditLogRetentionDays: 30,
      logFileMaxSizeMb: 64,
      updateChannel: 'stable',
    });
  });
  
  it('should have default values', () => {
    const state = useSettingsStore.getState();
    expect(state.theme).toBe('system');
    expect(state.sidebarCollapsed).toBe(false);
    expect(state.gatewayAutoStart).toBe(true);
    expect(state.logLevel).toBe('debug');
    expect(state.auditEnabled).toBe(true);
    expect(state.appLogRetentionDays).toBe(14);
  });
  
  it('should update theme', () => {
    const { setTheme } = useSettingsStore.getState();
    setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
  });
  
  it('should toggle sidebar collapsed state', () => {
    const { setSidebarCollapsed } = useSettingsStore.getState();
    setSidebarCollapsed(true);
    expect(useSettingsStore.getState().sidebarCollapsed).toBe(true);
  });

  it('should update sidebar width', () => {
    const { setSidebarWidth } = useSettingsStore.getState();
    setSidebarWidth(320);
    expect(useSettingsStore.getState().sidebarWidth).toBe(320);
  });
  
  it('should unlock dev mode', () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true },
      },
    });

    const { setDevModeUnlocked } = useSettingsStore.getState();
    setDevModeUnlocked(true);

    expect(useSettingsStore.getState().devModeUnlocked).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      'hostapi:fetch',
      expect.objectContaining({
        path: '/api/settings/devModeUnlocked',
        method: 'PUT',
      }),
    );
  });

  it('should persist launch-at-startup setting through host api', () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true },
      },
    });

    const { setLaunchAtStartup } = useSettingsStore.getState();
    setLaunchAtStartup(true);

    expect(useSettingsStore.getState().launchAtStartup).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      'hostapi:fetch',
      expect.objectContaining({
        path: '/api/settings/launchAtStartup',
        method: 'PUT',
      }),
    );
  });

  it('should persist logging preferences through host api', () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: 200,
          ok: true,
          json: { success: true },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: 200,
          ok: true,
          json: { success: true },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: 200,
          ok: true,
          json: { success: true },
        },
      });

    const { setLogLevel, setAuditEnabled, setAuditMode } = useSettingsStore.getState();
    setLogLevel('warn');
    setAuditEnabled(false);
    setAuditMode('full');

    const state = useSettingsStore.getState();
    expect(state.logLevel).toBe('warn');
    expect(state.auditEnabled).toBe(false);
    expect(state.auditMode).toBe('full');
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      'hostapi:fetch',
      expect.objectContaining({
        path: '/api/settings/logLevel',
        method: 'PUT',
      }),
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      'hostapi:fetch',
      expect.objectContaining({
        path: '/api/settings/auditEnabled',
        method: 'PUT',
      }),
    );
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      'hostapi:fetch',
      expect.objectContaining({
        path: '/api/settings/auditMode',
        method: 'PUT',
      }),
    );
  });

  it('should persist log retention policy through host api in a single request', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true },
      },
    });

    await useSettingsStore.getState().saveLoggingPolicy({
      appLogRetentionDays: 21,
      auditLogRetentionDays: 45,
      logFileMaxSizeMb: 96,
    });

    const state = useSettingsStore.getState();
    expect(state.appLogRetentionDays).toBe(21);
    expect(state.auditLogRetentionDays).toBe(45);
    expect(state.logFileMaxSizeMb).toBe(96);
    expect(invoke).toHaveBeenCalledWith(
      'hostapi:fetch',
      expect.objectContaining({
        path: '/api/settings',
        method: 'PUT',
        body: JSON.stringify({
          appLogRetentionDays: 21,
          auditLogRetentionDays: 45,
          logFileMaxSizeMb: 96,
        }),
      }),
    );
  });
});

describe('Gateway Store', () => {
  beforeEach(() => {
    // Reset store
    useGatewayStore.setState({
      status: { state: 'stopped', port: 18789 },
      isInitialized: false,
    });
  });
  
  it('should have default status', () => {
    const state = useGatewayStore.getState();
    expect(state.status.state).toBe('stopped');
    expect(state.status.port).toBe(18789);
  });
  
  it('should update status', () => {
    const { setStatus } = useGatewayStore.getState();
    setStatus({ state: 'running', port: 18789, pid: 12345 });
    
    const state = useGatewayStore.getState();
    expect(state.status.state).toBe('running');
    expect(state.status.pid).toBe(12345);
  });

  it('should proxy gateway rpc through ipc', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({ success: true, result: { ok: true } });

    const result = await useGatewayStore.getState().rpc<{ ok: boolean }>('chat.history', { limit: 10 }, 5000);

    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('gateway:rpc', 'chat.history', { limit: 10 }, 5000);
  });
});
