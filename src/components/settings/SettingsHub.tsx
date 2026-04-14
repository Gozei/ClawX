import { useMemo, type ComponentType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Cpu,
  Languages,
  MonitorCog,
  Moon,
  Network,
  Settings2,
  Sun,
  TerminalSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { SUPPORTED_LANGUAGES } from '@/i18n';
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

  const nextTheme = useMemo(() => {
    if (theme === 'dark') return 'light';
    if (theme === 'light') return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark';
  }, [theme]);

  const ThemeIcon = theme === 'dark' ? Moon : Sun;
  const languageLabel = SUPPORTED_LANGUAGES.find((item) => item.code === language)?.label ?? language.toUpperCase();
  const nextLanguage = language === 'zh' ? 'en' : 'zh';

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
    toast.success(t('settingsHub.language.changed', { language: SUPPORTED_LANGUAGES.find((item) => item.code === nextLanguage)?.label ?? nextLanguage }));
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
  }> = [
    {
      key: 'models',
      label: t('settingsHub.menu.models'),
      testId: 'settings-hub-menu-models',
      icon: Cpu,
      onClick: () => navigateFromMenu('/models'),
      selected: selectedKey === 'models',
      trailing: <ChevronRight className="h-4 w-4 text-muted-foreground/70" />,
    },
    {
      key: 'channels',
      label: t('settingsHub.menu.channels'),
      testId: 'settings-hub-menu-channels',
      icon: Network,
      onClick: () => navigateFromMenu('/channels'),
      selected: selectedKey === 'channels',
      trailing: <ChevronRight className="h-4 w-4 text-muted-foreground/70" />,
    },
    {
      key: 'theme',
      label: t('settingsHub.menu.theme'),
      testId: 'settings-hub-menu-theme',
      icon: MonitorCog,
      onClick: handleToggleTheme,
      trailing: <ThemeIcon className="h-4 w-4 text-muted-foreground/80" />,
    },
    {
      key: 'language',
      label: t('settingsHub.menu.language'),
      testId: 'settings-hub-menu-language',
      icon: Languages,
      onClick: handleToggleLanguage,
      trailing: <span className="text-xs font-semibold text-muted-foreground/80">{languageLabel}</span>,
    },
    {
      key: 'settings',
      label: t('settingsHub.menu.settings'),
      testId: 'settings-hub-menu-settings',
      icon: Settings2,
      onClick: () => navigateFromMenu('/settings'),
      selected: selectedKey === 'settings',
      trailing: <ChevronRight className="h-4 w-4 text-muted-foreground/70" />,
    },
    {
      key: 'console',
      label: t('settingsHub.menu.console'),
      testId: 'settings-hub-menu-console',
      icon: TerminalSquare,
      onClick: () => { void handleOpenConsole(); },
      trailing: <ChevronRight className="h-4 w-4 text-muted-foreground/70" />,
    },
  ];

  return (
    <>
      <div
        data-testid="settings-hub-sheet"
        className={cn(
          'w-full max-w-[360px] overflow-hidden rounded-[24px] border border-black/8 bg-white/96 shadow-[0_24px_80px_rgba(15,23,42,0.24)] backdrop-blur dark:border-white/10 dark:bg-[#0e131b]/96',
          mode === 'sheet' && 'ml-0',
        )}
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
                  className={cn(
                    'group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors',
                    item.selected
                      ? 'bg-[#eef3fb] text-foreground dark:bg-white/88 dark:text-[#111827]'
                      : 'text-foreground/82 hover:bg-[#f3f6fb] dark:text-white/82 dark:hover:bg-white/88 dark:hover:text-[#111827]',
                  )}
                >
                  <div className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
                    item.selected
                      ? 'border-black/5 bg-white text-primary dark:border-black/10 dark:bg-white dark:text-[#111827]'
                      : 'border-black/5 bg-black/[0.03] text-muted-foreground dark:border-white/10 dark:bg-white/[0.04] dark:group-hover:border-black/10 dark:group-hover:bg-white dark:group-hover:text-[#111827]',
                  )}>
                    <Icon className="h-[18px] w-[18px]" />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{item.label}</span>
                  <span className={cn(item.selected ? 'dark:text-[#111827]' : '')}>
                    {item.trailing}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </>
  );
}

export default SettingsHub;
