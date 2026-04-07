/**
 * Main Layout Component
 * TitleBar at top, then sidebar + content below.
 */
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

export function MainLayout() {
  return (
    <div data-testid="main-layout" className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar />

      {/* Below the title bar: sidebar + content */}
      <div className="flex flex-1 overflow-hidden bg-[#f7f9fc] dark:bg-background">
        <Sidebar />
        <main
          data-testid="main-content"
          className="flex-1 overflow-auto bg-[linear-gradient(180deg,rgba(255,255,255,0.76),rgba(247,249,252,0.94))] p-6 dark:bg-none"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
