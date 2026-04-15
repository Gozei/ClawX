import { useSyncExternalStore } from 'react';
import lightLogo from '@/assets/branding/logo-whale-light.png';
import darkLogo from '@/assets/branding/logo-whale-dark.png';
import { useBranding } from '@/lib/branding';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';

type ResolvedTheme = 'light' | 'dark';
type ThemeSetting = 'light' | 'dark' | 'system';

const DARK_MODE_MEDIA_QUERY = '(prefers-color-scheme: dark)';

function resolveTheme(theme: ThemeSetting): ResolvedTheme {
  if (theme !== 'system') {
    return theme;
  }

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia(DARK_MODE_MEDIA_QUERY).matches ? 'dark' : 'light';
}

interface AppLogoProps {
  className?: string;
  testId?: string;
}

export function AppLogo({ className, testId }: AppLogoProps) {
  const theme = useSettingsStore((state) => state.theme);
  const branding = useBranding();
  const systemTheme = useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {};
      }

      const mediaQuery = window.matchMedia(DARK_MODE_MEDIA_QUERY);
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', onStoreChange);
        return () => mediaQuery.removeEventListener('change', onStoreChange);
      }

      mediaQuery.addListener(onStoreChange);
      return () => mediaQuery.removeListener(onStoreChange);
    },
    () => resolveTheme('system'),
    () => 'light' as ResolvedTheme,
  );
  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme;

  const logoSrc = resolvedTheme === 'dark' ? lightLogo : darkLogo;

  return (
    <img
      src={logoSrc}
      alt={branding.productName}
      data-testid={testId}
      className={cn('w-auto shrink-0 object-contain', className)}
      draggable={false}
    />
  );
}
