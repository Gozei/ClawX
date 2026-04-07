import { DEFAULT_BRANDING, mergeBranding, type BrandingConfig } from '../../shared/branding';
import { getAllSettings } from './store';

export async function getResolvedBranding(): Promise<BrandingConfig> {
  const settings = await getAllSettings();
  return mergeBranding(DEFAULT_BRANDING, settings.brandingOverrides);
}

