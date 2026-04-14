/**
 * Root Application Component
 * Handles routing and global providers
 */
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Component, lazy, Suspense, useEffect, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Loader2, Rocket } from 'lucide-react';
import { Toaster } from 'sonner';
import i18n from './i18n';
import { MainLayout } from './components/layout/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PageLoader } from './components/common/LoadingSpinner';
import { useSettingsStore } from './stores/settings';
import { useGatewayStore } from './stores/gateway';
import { useProviderStore } from './stores/providers';
import { useUpdateStore } from './stores/update';
import { applyGatewayTransportPreference } from './lib/api-client';
import { cn } from '@/lib/utils';

const Chat = lazy(() => import('./pages/Chat').then((module) => ({ default: module.Chat })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const Models = lazy(() => import('./pages/Models').then((module) => ({ default: module.Models })));
const Agents = lazy(() => import('./pages/Agents').then((module) => ({ default: module.Agents })));
const Channels = lazy(() => import('./pages/Channels').then((module) => ({ default: module.Channels })));
const Skills = lazy(() => import('./pages/Skills').then((module) => ({ default: module.Skills })));
const Cron = lazy(() => import('./pages/Cron').then((module) => ({ default: module.Cron })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));
const Setup = lazy(() => import('./pages/Setup').then((module) => ({ default: module.Setup })));

function RouteLoader() {
  return (
    <div className="flex h-screen items-center justify-center">
      <PageLoader />
    </div>
  );
}

function UpdateInstallOverlay() {
  const status = useUpdateStore((state) => state.status);
  const installPhaseStartedAt = useUpdateStore((state) => state.installPhaseStartedAt);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (status !== 'installing' || !installPhaseStartedAt) {
      setElapsedSeconds(0);
      return;
    }

    const tick = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - installPhaseStartedAt) / 1000)));
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => { window.clearInterval(timer); };
  }, [installPhaseStartedAt, status]);

  if (status !== 'installing') {
    return null;
  }

  const platform = window.electron.platform;
  const detailKey = platform === 'linux'
    ? 'updates.installOverlay.detailLinux'
    : platform === 'darwin'
      ? 'updates.installOverlay.detailMac'
      : 'updates.installOverlay.detailWindows';

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-slate-950/56 px-6 backdrop-blur-sm">
      <div className="w-full max-w-[520px] rounded-[28px] border border-white/15 bg-[#0f1726]/96 p-7 text-white shadow-[0_32px_120px_rgba(15,23,42,0.42)]">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-500/18 text-blue-200 ring-1 ring-blue-300/20">
            <Rocket className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-blue-100/90">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-[13px] font-medium">
                {i18n.t('settings:updates.installOverlay.badge')}
              </span>
            </div>
            <h2 className="mt-3 text-[24px] font-semibold tracking-[-0.02em] text-white">
              {i18n.t('settings:updates.installOverlay.title')}
            </h2>
            <p className="mt-3 text-[15px] leading-7 text-slate-200/88">
              {i18n.t('settings:updates.installOverlay.description')}
            </p>
            <p className="mt-3 text-[14px] leading-6 text-amber-100/88">
              {i18n.t(`settings:${detailKey}`)}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <div className="rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white/90 ring-1 ring-white/12">
                {i18n.t('settings:updates.installOverlay.elapsed', { seconds: elapsedSeconds })}
              </div>
              <div className={cn(
                'rounded-full px-3 py-1.5 text-[12px] font-medium ring-1',
                elapsedSeconds >= 8
                  ? 'bg-amber-400/12 text-amber-100 ring-amber-300/20'
                  : 'bg-white/8 text-white/82 ring-white/10',
              )}>
                {elapsedSeconds >= 8
                  ? i18n.t('settings:updates.installOverlay.slowHint')
                  : i18n.t('settings:updates.installOverlay.waitHint')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Error Boundary to catch and display React rendering errors
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React Error Boundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px',
          color: '#1f2937',
          background: '#f7f8fa',
          minHeight: '100vh',
          fontFamily: '"Tencent Sans", "Volcano Sans", "PingFang SC", sans-serif'
        }}>
          <div style={{
            maxWidth: '720px',
            margin: '80px auto',
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '20px',
            padding: '28px',
            boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)'
          }}>
            <h1 style={{ fontSize: '24px', marginBottom: '10px', color: '#111827' }}>页面加载失败</h1>
            <p style={{ fontSize: '14px', lineHeight: 1.7, color: '#6b7280', margin: 0 }}>
              这个页面刚才出了点问题。你可以先刷新应用，如果问题重复出现，我会继续帮你定位。
            </p>
            {this.state.error?.message ? (
              <div style={{
                marginTop: '18px',
                padding: '14px 16px',
                borderRadius: '12px',
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                fontSize: '13px',
                color: '#374151',
                wordBreak: 'break-word'
              }}>
                {this.state.error.message}
              </div>
            ) : null}
          </div>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              display: 'block',
              margin: '0 auto',
              marginTop: '-56px',
              padding: '10px 18px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '999px',
              cursor: 'pointer'
            }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const skipSetupForE2E = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('e2eSkipSetup') === '1';
  const initSettings = useSettingsStore((state) => state.init);
  const theme = useSettingsStore((state) => state.theme);
  const language = useSettingsStore((state) => state.language);
  const setupComplete = useSettingsStore((state) => state.setupComplete);
  const initGateway = useGatewayStore((state) => state.init);
  const initProviders = useProviderStore((state) => state.init);
  const initUpdateStore = useUpdateStore((state) => state.init);

  useEffect(() => {
    initSettings();
  }, [initSettings]);

  // Sync i18n language with persisted settings on mount
  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  // Initialize Gateway connection on mount
  useEffect(() => {
    initGateway();
  }, [initGateway]);

  // Initialize provider snapshot on mount
  useEffect(() => {
    initProviders();
  }, [initProviders]);

  useEffect(() => {
    void initUpdateStore();
  }, [initUpdateStore]);

  // Redirect to setup wizard if not complete
  useEffect(() => {
    if (!setupComplete && !skipSetupForE2E && !location.pathname.startsWith('/setup')) {
      navigate('/setup');
    }
  }, [setupComplete, skipSetupForE2E, location.pathname, navigate]);

  // Listen for navigation events from main process
  useEffect(() => {
    const handleNavigate = (...args: unknown[]) => {
      const path = args[0];
      if (typeof path === 'string') {
        navigate(path);
      }
    };

    const unsubscribe = window.electron.ipcRenderer.on('navigate', handleNavigate);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigate]);

  // Apply theme
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  useEffect(() => {
    applyGatewayTransportPreference();
  }, []);

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            {/* Setup wizard (shown on first launch) */}
            <Route path="/setup/*" element={<Setup />} />

            {/* Main application routes */}
            <Route element={<MainLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/" element={<Chat />} />
              <Route path="/models" element={<Models />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/skills" element={<Skills />} />
              <Route path="/cron" element={<Cron />} />
              <Route path="/settings/*" element={<Settings />} />
            </Route>
          </Routes>
        </Suspense>

        {/* Global toast notifications */}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          style={{ zIndex: 99999 }}
        />
        <UpdateInstallOverlay />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
