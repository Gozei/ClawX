import { useMemo } from 'react';
import { DEFAULT_BRANDING, getBrandTagline, mergeBranding, type BrandingConfig } from '../../shared/branding';
import { useSettingsStore } from '@/stores/settings';

export type ResolvedBranding = BrandingConfig & {
  localizedTagline: string;
  displayName: string;
};

export function resolveRendererBranding(
  language?: string,
  overrides?: Partial<BrandingConfig> | null,
): ResolvedBranding {
  const branding = mergeBranding(DEFAULT_BRANDING, overrides);
  return {
    ...branding,
    localizedTagline: getBrandTagline(branding, language),
    displayName: branding.productName,
  };
}

export function getBrandingSnapshot(): ResolvedBranding {
  const state = useSettingsStore.getState();
  return resolveRendererBranding(state.language, state.brandingOverrides);
}

export function useBranding(): ResolvedBranding {
  const language = useSettingsStore((state) => state.language);
  const brandingOverrides = useSettingsStore((state) => state.brandingOverrides);

  return useMemo(
    () => resolveRendererBranding(language, brandingOverrides),
    [brandingOverrides, language],
  );
}
