import { useEffect, useState } from 'react';
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
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme));

  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setResolvedTheme(resolveTheme(theme));
      return;
    }

    const mediaQuery = window.matchMedia(DARK_MODE_MEDIA_QUERY);
    const updateResolvedTheme = () => {
      setResolvedTheme(mediaQuery.matches ? 'dark' : 'light');
    };

    updateResolvedTheme();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateResolvedTheme);
      return () => mediaQuery.removeEventListener('change', updateResolvedTheme);
    }

    mediaQuery.addListener(updateResolvedTheme);
    return () => mediaQuery.removeListener(updateResolvedTheme);
  }, [theme]);

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
