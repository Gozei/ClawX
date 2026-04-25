import type { MarketplaceSkillDetail } from '@/types/skill';

export type MarketplaceModerationState = {
  isSuspicious: boolean;
  isMalwareBlocked: boolean;
  summary?: string;
  reasonCodes: string[];
};

const SUSPICIOUS_INSTALL_FORCE_MESSAGE = 'Use --force to install suspicious skills in non-interactive mode';

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function getMarketplaceModerationState(detail?: MarketplaceSkillDetail | null): MarketplaceModerationState {
  const info = detail?.moderationInfo;
  if (!info || typeof info !== 'object') {
    return {
      isSuspicious: false,
      isMalwareBlocked: false,
      reasonCodes: [],
    };
  }

  const record = info as Record<string, unknown>;
  return {
    isSuspicious: readBoolean(record.isSuspicious),
    isMalwareBlocked: readBoolean(record.isMalwareBlocked),
    summary: readString(record.summary),
    reasonCodes: readStringArray(record.reasonCodes),
  };
}

export function isSuspiciousInstallForceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(SUSPICIOUS_INSTALL_FORCE_MESSAGE);
}
