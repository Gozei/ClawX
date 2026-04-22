import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TitleBar } from '@/components/layout/TitleBar';

const invokeIpcMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

describe('TitleBar platform behavior', () => {
  beforeEach(() => {
    invokeIpcMock.mockReset();
    invokeIpcMock.mockResolvedValue(false);
  });

  it('renders macOS drag region', () => {
    window.electron.platform = 'darwin';

    const { container } = render(<TitleBar />);

    expect(container.querySelector('.drag-region')).toBeInTheDocument();
    expect(screen.queryByTestId('titlebar-minimize-button')).not.toBeInTheDocument();
    expect(invokeIpcMock).not.toHaveBeenCalled();
  });

  it('renders custom controls on Windows', async () => {
    window.electron.platform = 'win32';

    render(<TitleBar />);

    expect(screen.getByTestId('titlebar-minimize-button')).toHaveAccessibleName('最小化');
    expect(screen.getByTestId('titlebar-maximize-button')).toHaveAccessibleName('最大化');
    expect(screen.getByTestId('titlebar-close-button')).toHaveAccessibleName('关闭');

    await waitFor(() => {
      expect(invokeIpcMock).toHaveBeenCalledWith('window:isMaximized');
    });
  });

  it('renders no custom title bar on Linux', () => {
    window.electron.platform = 'linux';

    const { container } = render(<TitleBar />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('titlebar-minimize-button')).not.toBeInTheDocument();
    expect(invokeIpcMock).not.toHaveBeenCalled();
  });
});
