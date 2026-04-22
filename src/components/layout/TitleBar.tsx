/**
 * TitleBar Component
 * macOS: empty drag region (native traffic lights handled by hiddenInset).
 * Windows: drag region with custom minimize/maximize/close controls.
 * Linux: use native window chrome (no custom title bar).
 */
import { useEffect, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { invokeIpc } from '@/lib/api-client';

const windowControlButtonClass = 'flex h-full w-11 items-center justify-center text-[#5c6a7f] transition-colors hover:bg-[#ebf1fb] hover:text-[#1f2937] dark:text-[#c9d4e3] dark:hover:bg-white/[0.08] dark:hover:text-white';
const windowCloseButtonClass = 'flex h-full w-11 items-center justify-center text-[#5c6a7f] transition-colors hover:bg-[#e81123] hover:text-white dark:text-[#c9d4e3] dark:hover:bg-[#e81123] dark:hover:text-white';
const controlIconProps = { strokeWidth: 2.25 };

export function TitleBar() {
  const platform = window.electron?.platform;

  if (platform === 'darwin') {
    // macOS: just a drag region, traffic lights are native
    return <div className="drag-region h-10 shrink-0 border-b border-black/5 bg-[#f7f9fc]/95 backdrop-blur supports-[backdrop-filter]:bg-[#f7f9fc]/80 dark:bg-background" />;
  }

  // Linux keeps the native frame/title bar for better IME compatibility.
  if (platform !== 'win32') {
    return null;
  }

  return <WindowsTitleBar />;
}

function WindowsTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // Check initial state
    invokeIpc('window:isMaximized').then((val) => {
      setMaximized(val as boolean);
    });
  }, []);

  const handleMinimize = () => {
    invokeIpc('window:minimize');
  };

  const handleMaximize = () => {
    invokeIpc('window:maximize').then(() => {
      invokeIpc('window:isMaximized').then((val) => {
        setMaximized(val as boolean);
      });
    });
  };

  const handleClose = () => {
    invokeIpc('window:close');
  };

  return (
    <div className="drag-region flex h-10 shrink-0 items-center justify-end border-b border-black/5 bg-[#f7f9fc]/95 backdrop-blur supports-[backdrop-filter]:bg-[#f7f9fc]/80 dark:bg-background">
      {/* Right: Window Controls */}
      <div className="no-drag flex h-full">
        <button
          onClick={handleMinimize}
          className={windowControlButtonClass}
          data-testid="titlebar-minimize-button"
          aria-label="最小化"
          title="最小化"
        >
          <Minus className="h-4 w-4" {...controlIconProps} />
        </button>
        <button
          onClick={handleMaximize}
          className={windowControlButtonClass}
          data-testid="titlebar-maximize-button"
          aria-label={maximized ? '还原' : '最大化'}
          title={maximized ? '还原' : '最大化'}
        >
          {maximized ? <Copy className="h-4 w-4" {...controlIconProps} /> : <Square className="h-4 w-4" {...controlIconProps} />}
        </button>
        <button
          onClick={handleClose}
          className={windowCloseButtonClass}
          data-testid="titlebar-close-button"
          aria-label="关闭"
          title="关闭"
        >
          <X className="h-4 w-4" {...controlIconProps} />
        </button>
      </div>
    </div>
  );
}
