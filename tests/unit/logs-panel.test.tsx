import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LogsPanel } from '@/components/settings/LogsPanel';
import { useSettingsStore } from '@/stores/settings';

const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    initReactI18next: actual.initReactI18next ?? { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        if (key === 'logs.count') {
          return `${String(options?.count ?? 0)} entries`;
        }
        return key;
      },
      i18n: { language: 'zh-CN' },
    }),
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('LogsPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useSettingsStore.setState({
      logLevel: 'debug',
      auditEnabled: true,
      auditMode: 'minimal',
      appLogRetentionDays: 14,
      auditLogRetentionDays: 30,
      logFileMaxSizeMb: 64,
    });
  });

  it('stays collapsed by default and only loads logs after expanding', async () => {
    hostApiFetchMock.mockResolvedValueOnce({
      files: [],
      timezone: 'Asia/Shanghai',
    });
    hostApiFetchMock.mockResolvedValueOnce({
      kind: 'app',
      timezone: 'Asia/Shanghai',
    });

    render(<LogsPanel onOpenFolder={() => undefined} />);

    expect(hostApiFetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('logs.collapsedHint')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('settings-logs-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('settings-logs-panel')).toBeInTheDocument();
      expect(screen.getByText('0 entries')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(hostApiFetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByTestId('settings-logs-results')).toHaveTextContent('logs.empty');
    });
  });

  it('shows visible logging policy controls and saves policy changes in one request', async () => {
    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
    });

    render(<LogsPanel onOpenFolder={() => undefined} />);

    fireEvent.change(screen.getByTestId('settings-app-log-retention-input'), { target: { value: '21' } });
    fireEvent.change(screen.getByTestId('settings-audit-log-retention-input'), { target: { value: '45' } });
    fireEvent.change(screen.getByTestId('settings-log-file-max-size-input'), { target: { value: '96' } });
    fireEvent.click(screen.getByTestId('settings-save-log-policy'));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/settings', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          appLogRetentionDays: 21,
          auditLogRetentionDays: 45,
          logFileMaxSizeMb: 96,
        }),
      }));
      expect(useSettingsStore.getState().appLogRetentionDays).toBe(21);
      expect(useSettingsStore.getState().auditLogRetentionDays).toBe(45);
      expect(useSettingsStore.getState().logFileMaxSizeMb).toBe(96);
    });
  });
});
