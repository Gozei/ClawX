export type SupportedBrandingLocale = 'en' | 'zh';

export type BrandingTextMap = Partial<Record<SupportedBrandingLocale, string>>;

export type BrandingOverrides = Partial<BrandingConfig>;

export interface BrandingConfig {
  productName: string;
  fullName: string;
  vendorName: string;
  chineseName: string;
  slogan: string;
  tagline: BrandingTextMap;
  requestTitle: string;
  uiDisplayName: string;
  userAgentProduct: string;
  trayTitle: string;
}

export const DEFAULT_BRANDING: BrandingConfig = {
  productName: 'Deep AI Worker',
  fullName: 'Deep AI Worker by DeepData',
  vendorName: 'DeepData',
  chineseName: 'Deep AI Worker',
  slogan: 'Let Intelligence Work',
  tagline: {
    en: 'Make intelligence truly operational in the enterprise.',
    zh: '让智能在企业中真正运转起来',
  },
  requestTitle: 'Deep AI Worker',
  uiDisplayName: 'Deep AI Worker UI',
  userAgentProduct: 'Deep AI Worker/1.0',
  trayTitle: 'Deep AI Worker',
};

function mergeTextMap(base: BrandingTextMap, overrides?: BrandingTextMap): BrandingTextMap {
  if (!overrides) return base;
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => typeof value === 'string' && value.trim().length > 0),
    ),
  };
}

export function mergeBranding(
  base: BrandingConfig = DEFAULT_BRANDING,
  overrides?: BrandingOverrides | null,
): BrandingConfig {
  if (!overrides) return base;

  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key, value]) => key !== 'tagline' && typeof value === 'string' && value.trim().length > 0),
    ),
    tagline: mergeTextMap(base.tagline, overrides.tagline),
  };
}

export function toBrandingLocale(language?: string | null): SupportedBrandingLocale {
  if (!language) return 'en';
  if (language.startsWith('zh')) return 'zh';
  return 'en';
}

export function getBrandTagline(branding: BrandingConfig, language?: string | null): string {
  const locale = toBrandingLocale(language);
  return branding.tagline[locale] || branding.tagline.en || branding.slogan;
}

