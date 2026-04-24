import { useMemo, useState, type ComponentType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Archive,
  LayoutDashboard,
  Cpu,
  Languages,
  MonitorCog,
  Moon,
  Network,
  RefreshCw,
  Settings2,
  Sun,
  TerminalSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useSettingsStore } from '@/stores/settings';
import { useUpdateStore } from '@/stores/update';
import { hostApiFetch } from '@/lib/host-api';

type SettingsHubProps = {
  mode?: 'sheet';
  onRequestClose?: () => void;
};

type ControlUiResult = {
  success: boolean;
  url?: string;
  error?: string;
};

export function SettingsHub({ mode = 'sheet', onRequestClose }: SettingsHubProps) {
  const { t } = useTranslation(['settings', 'common']);
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
  const downloadUpdate = useUpdateStore((state) => state.downloadUpdate);
  const clearUpdateError = useUpdateStore((state) => state.clearError);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

  const resolvedTheme = useMemo(() => {
    if (theme === 'dark' || theme === 'light') return theme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }, [theme]);

  const nextTheme = useMemo(() => {
    if (theme === 'dark') return 'light';
    if (theme === 'light') return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark';
  }, [theme]);

  const nextLanguage = language === 'zh' ? 'en' : 'zh';
  const nextLanguageLabel = nextLanguage === 'zh' ? '\u4e2d\u6587' : 'English';

  const navigateFromMenu = (path: string) => {
    navigate(path);
    onRequestClose?.();
  };

  const handleToggleTheme = () => {
    setTheme(nextTheme);
    toast.success(t('settingsHub.theme.changed', { theme: t(`settingsHub.theme.${nextTheme}`) }));
  };

  const handleToggleLanguage = () => {
    setLanguage(nextLanguage);
    toast.success(t('settingsHub.language.changed', { language: nextLanguageLabel }));
  };

  const handleCheckUpdates = async () => {
    if (checkingUpdates) return;
    setCheckingUpdates(true);
    clearUpdateError();
    try {
      await checkForUpdates();
      const { status, error } = useUpdateStore.getState();
      if (status === 'available') {
        setUpdateDialogOpen(true);
        return;
      }
      if (status === 'not-available') {
        toast.success(t('settingsHub.update.latest'));
        return;
      }
      toast.error(error || t('settingsHub.update.failed'));
    } catch {
      const { error } = useUpdateStore.getState();
      toast.error(error || t('settingsHub.update.failed'));
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleConfirmUpdate = async () => {
    setUpdateDialogOpen(false);
    await downloadUpdate({ autoInstallAfterDownload: true });
    const { status, error } = useUpdateStore.getState();
    if (status === 'error') {
      toast.error(error || t('settingsHub.update.failed'));
      return;
    }
    toast.success(t('settingsHub.update.started'));
    onRequestClose?.();
  };

  const handleOpenConsole = async () => {
    try {
      const result = await hostApiFetch<ControlUiResult>('/api/gateway/control-ui');
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
        onRequestClose?.();
      } else {
        toast.error(result.error || t('settingsHub.console.failed'));
      }
    } catch (fetchError) {
      toast.error(String(fetchError));
    }
  };

  const selectedKey = location.pathname.startsWith('/models')
    ? 'models'
    : location.pathname.startsWith('/channels')
      ? 'channels'
      : location.pathname.startsWith('/settings/archives')
        ? 'archives'
      : location.pathname.startsWith('/dashboard')
        ? 'dashboard'
      : location.pathname.startsWith('/settings')
        ? 'settings'
        : '';

  const menuItems: Array<{
    key: string;
    label: string;
    testId: string;
    icon: ComponentType<{ className?: string }>;
    onClick: () => void;
    selected?: boolean;
    trailing?: React.ReactNode;
    disabled?: boolean;
  }> = [
    {
      key: 'dashboard',
      label: t('settingsHub.menu.dashboard'),
      testId: 'settings-hub-menu-dashboard',
      icon: LayoutDashboard,
      onClick: () => navigateFromMenu('/dashboard'),
      selected: selectedKey === 'dashboard',
    },
    {
      key: 'models',
      label: t('settingsHub.menu.models'),
      testId: 'settings-hub-menu-models',
      icon: Cpu,
      onClick: () => navigateFromMenu('/models'),
      selected: selectedKey === 'models',
    },
    {
      key: 'channels',
      label: t('settingsHub.menu.channels'),
      testId: 'settings-hub-menu-channels',
      icon: Network,
      onClick: () => navigateFromMenu('/channels'),
      selected: selectedKey === 'channels',
    },
    {
      key: 'archives',
      label: t('settingsHub.menu.archives'),
      testId: 'settings-hub-menu-archives',
      icon: Archive,
      onClick: () => navigateFromMenu('/settings/archives'),
      selected: selectedKey === 'archives',
    },
    {
      key: 'theme',
      label: t('settingsHub.menu.theme'),
      testId: 'settings-hub-menu-theme',
      icon: MonitorCog,
      onClick: handleToggleTheme,
      trailing: (
        <span className="inline-flex items-center gap-1.5 text-[12px]">
          <Sun className={cn('h-3.5 w-3.5', resolvedTheme === 'light' ? 'text-foreground dark:text-white' : 'text-muted-foreground/60 dark:text-white/42')} />
          <span className="text-muted-foreground/55 dark:text-white/35">/</span>
          <Moon className={cn('h-3.5 w-3.5', resolvedTheme === 'dark' ? 'text-foreground dark:text-white' : 'text-muted-foreground/60 dark:text-white/42')} />
        </span>
      ),
    },
    {
      key: 'language',
      label: t('settingsHub.menu.language'),
      testId: 'settings-hub-menu-language',
      icon: Languages,
      onClick: handleToggleLanguage,
      trailing: (
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold">
          <span className={cn(language === 'zh' ? 'text-foreground dark:text-white' : 'text-muted-foreground/60 dark:text-white/42')}>{'\u4e2d\u6587'}</span>
          <span className="text-muted-foreground/55 dark:text-white/35">/</span>
          <span className={cn(language === 'en' ? 'text-foreground dark:text-white' : 'text-muted-foreground/60 dark:text-white/42')}>English</span>
        </span>
      ),
    },
    {
      key: 'settings',
      label: t('settingsHub.menu.settings'),
      testId: 'settings-hub-menu-settings',
      icon: Settings2,
      onClick: () => navigateFromMenu('/settings'),
      selected: selectedKey === 'settings',
    },
    {
      key: 'checkUpdates',
      label: t('settingsHub.menu.checkUpdates'),
      testId: 'settings-hub-menu-check-updates',
      icon: RefreshCw,
      onClick: () => { void handleCheckUpdates(); },
      trailing: checkingUpdates ? (
        <span className="text-[12px] font-medium">
          {t('settingsHub.update.checking')}
        </span>
      ) : undefined,
      disabled: checkingUpdates,
    },
    {
      key: 'console',
      label: t('settingsHub.menu.console'),
      testId: 'settings-hub-menu-console',
      icon: TerminalSquare,
      onClick: () => { void handleOpenConsole(); },
    },
  ];

  return (
    <div
      data-testid="settings-hub-sheet"
      className={cn(
        'overflow-hidden rounded-[24px] border border-black/8 bg-background/95 shadow-[0_12px_28px_rgba(15,23,42,0.10)] backdrop-blur-sm supports-[backdrop-filter]:bg-background/88 dark:border-white/10 dark:bg-card/95 dark:shadow-[0_12px_28px_rgba(0,0,0,0.24)] dark:supports-[backdrop-filter]:bg-card/88',
        mode === 'sheet' && 'ml-0',
      )}
      style={{ width: '300px', maxWidth: 'calc(100vw - 2rem)' }}
    >
      <aside className="w-full p-4">
        <div className="space-y-1.5">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                data-testid={item.testId}
                onClick={item.onClick}
                disabled={item.disabled}
                data-selected={item.selected ? 'true' : 'false'}
                className={cn(
                  'group flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[14px] font-medium transition-all duration-200',
                  item.disabled && 'cursor-not-allowed opacity-70',
                  item.selected
                    ? 'bg-white text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-1 ring-black/5 dark:bg-white/10 dark:text-white dark:ring-white/10'
                    : 'text-foreground/78 hover:bg-[#eef3fb] hover:text-foreground dark:text-white/78 dark:hover:bg-white/5 dark:hover:text-white',
                )}
              >
                <div
                  data-testid={`${item.testId}-icon`}
                  data-slot="settings-hub-icon-shell"
                  data-selected={item.selected ? 'true' : 'false'}
                  className={cn(
                    'flex shrink-0 items-center justify-center transition-colors duration-200',
                    item.selected
                      ? 'text-primary dark:text-white'
                      : 'text-muted-foreground group-hover:text-foreground dark:text-white/56 dark:group-hover:text-white/84',
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </div>
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{item.label}</span>
                {item.trailing ? (
                  <span
                    data-slot="settings-hub-trailing"
                    data-selected={item.selected ? 'true' : 'false'}
                    className={cn(
                      'shrink-0 transition-colors duration-200',
                      item.selected
                        ? 'text-foreground/70 dark:text-white/80'
                        : 'text-muted-foreground/78 group-hover:text-foreground/72 dark:text-white/46 dark:group-hover:text-white/72',
                    )}
                  >
                    {item.trailing}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </aside>
      <ConfirmDialog
        open={updateDialogOpen}
        title={t('settingsHub.update.dialogTitle')}
        message={t('settingsHub.update.dialogMessage')}
        confirmLabel={t('settingsHub.update.confirm')}
        cancelLabel={t('common:actions.cancel')}
        onConfirm={handleConfirmUpdate}
        onCancel={() => setUpdateDialogOpen(false)}
      />
    </div>
  );
}

export default SettingsHub;
