/**
 * Settings State Store
 * Manages application settings
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '@/i18n';
import { hostApiFetch } from '@/lib/host-api';
import type { BrandingOverrides } from '../../shared/branding';
import { resolveSupportedLanguage } from '../../shared/language';
import {
  DEFAULT_APP_LOG_RETENTION_DAYS,
  DEFAULT_AUDIT_LOG_RETENTION_DAYS,
  DEFAULT_LOG_FILE_MAX_SIZE_MB,
  normalizeAppLogLevel,
  normalizeAuditMode,
  normalizeLogFileMaxSizeMb,
  normalizeLogRetentionDays,
  type AppLogLevel,
  type AuditMode,
} from '../../shared/logging';
import { confirmGatewayImpact } from '@/lib/gateway-impact-confirm';

type Theme = 'light' | 'dark' | 'system';
type UpdateChannel = 'stable' | 'beta' | 'dev';
export type ChatProcessDisplayMode = 'all' | 'files' | 'hidden';
export type AssistantMessageStyle = 'bubble' | 'stream';
export type GuideSeenVersions = Record<string, number>;

interface SettingsState {
  // General
  theme: Theme;
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  telemetryEnabled: boolean;
  logLevel: AppLogLevel;
  auditEnabled: boolean;
  auditMode: AuditMode;
  appLogRetentionDays: number;
  auditLogRetentionDays: number;
  logFileMaxSizeMb: number;
  brandingOverrides: BrandingOverrides;
  chatProcessDisplayMode: ChatProcessDisplayMode;
  hideInternalRoutineProcesses: boolean;
  assistantMessageStyle: AssistantMessageStyle;
  chatFontScale: number;
  dreamModeEnabled: boolean;
  fileStorageBaseDir: string;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;

  // Update
  updateChannel: UpdateChannel;
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;

  // UI State
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  devModeUnlocked: boolean;
  guideSeenVersions: GuideSeenVersions;

  // Setup
  setupComplete: boolean;

  // Actions
  init: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: string) => void;
  setStartMinimized: (value: boolean) => void;
  setLaunchAtStartup: (value: boolean) => void;
  setTelemetryEnabled: (value: boolean) => void;
  setLogLevel: (value: AppLogLevel) => void;
  setAuditEnabled: (value: boolean) => void;
  setAuditMode: (value: AuditMode) => void;
  saveLoggingPolicy: (patch: {
    appLogRetentionDays: number;
    auditLogRetentionDays: number;
    logFileMaxSizeMb: number;
  }) => Promise<void>;
  setChatProcessDisplayMode: (value: ChatProcessDisplayMode) => void;
  setHideInternalRoutineProcesses: (value: boolean) => void;
  setAssistantMessageStyle: (value: AssistantMessageStyle) => void;
  setChatFontScale: (value: number) => void;
  setDreamModeEnabled: (value: boolean) => Promise<boolean>;
  setFileStorageBaseDir: (value: string) => void;
  setGatewayAutoStart: (value: boolean) => void;
  setGatewayPort: (port: number) => void;
  setProxyEnabled: (value: boolean) => void;
  setProxyServer: (value: string) => void;
  setProxyHttpServer: (value: string) => void;
  setProxyHttpsServer: (value: string) => void;
  setProxyAllServer: (value: string) => void;
  setProxyBypassRules: (value: string) => void;
  setUpdateChannel: (channel: UpdateChannel) => void;
  setAutoCheckUpdate: (value: boolean) => void;
  setAutoDownloadUpdate: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setSidebarWidth: (value: number) => void;
  setDevModeUnlocked: (value: boolean) => void;
  markGuideSeen: (guideId: string, version: number) => void;
  markSetupComplete: () => void;
  resetSettings: () => void;
}

const defaultSettings = {
  theme: 'system' as Theme,
  language: resolveSupportedLanguage('zh'),
  startMinimized: false,
  launchAtStartup: false,
  telemetryEnabled: true,
  logLevel: normalizeAppLogLevel('debug'),
  auditEnabled: true,
  auditMode: normalizeAuditMode('minimal'),
  appLogRetentionDays: normalizeLogRetentionDays(DEFAULT_APP_LOG_RETENTION_DAYS, DEFAULT_APP_LOG_RETENTION_DAYS),
  auditLogRetentionDays: normalizeLogRetentionDays(DEFAULT_AUDIT_LOG_RETENTION_DAYS, DEFAULT_AUDIT_LOG_RETENTION_DAYS),
  logFileMaxSizeMb: normalizeLogFileMaxSizeMb(DEFAULT_LOG_FILE_MAX_SIZE_MB, DEFAULT_LOG_FILE_MAX_SIZE_MB),
  brandingOverrides: {},
  chatProcessDisplayMode: 'files' as ChatProcessDisplayMode,
  hideInternalRoutineProcesses: true,
  assistantMessageStyle: 'bubble' as AssistantMessageStyle,
  chatFontScale: 100,
  dreamModeEnabled: false,
  fileStorageBaseDir: '',
  gatewayAutoStart: true,
  gatewayPort: 18789,
  proxyEnabled: false,
  proxyServer: '',
  proxyHttpServer: '',
  proxyHttpsServer: '',
  proxyAllServer: '',
  proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
  updateChannel: 'stable' as UpdateChannel,
  autoCheckUpdate: true,
  autoDownloadUpdate: false,
  sidebarCollapsed: false,
  sidebarWidth: 256,
  devModeUnlocked: false,
  guideSeenVersions: {} as GuideSeenVersions,
  setupComplete: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      init: async () => {
        try {
          const settings = await hostApiFetch<Partial<typeof defaultSettings> & {
            userUploadBaseDir?: string;
            assistantOutputBaseDir?: string;
          }>('/api/settings');
          const resolvedLanguage = settings.language
            ? resolveSupportedLanguage(settings.language)
            : undefined;
          const resolvedFileStorageBaseDir = typeof settings.fileStorageBaseDir === 'string'
            ? settings.fileStorageBaseDir.trim()
            : '';
          const legacyUploadBaseDir = typeof settings.userUploadBaseDir === 'string'
            ? settings.userUploadBaseDir.trim()
            : '';
          const legacyOutputBaseDir = typeof settings.assistantOutputBaseDir === 'string'
            ? settings.assistantOutputBaseDir.trim()
            : '';
          set((state) => ({
            ...state,
            ...settings,
            fileStorageBaseDir: resolvedFileStorageBaseDir || legacyUploadBaseDir || legacyOutputBaseDir,
            ...(resolvedLanguage ? { language: resolvedLanguage } : {}),
          }));
          if (resolvedLanguage) {
            i18n.changeLanguage(resolvedLanguage);
          }
        } catch {
          // Keep renderer-persisted settings as a fallback when the main
          // process store is not reachable.
        }
      },

      setTheme: (theme) => {
        set({ theme });
        void hostApiFetch('/api/settings/theme', {
          method: 'PUT',
          body: JSON.stringify({ value: theme }),
        }).catch(() => { });
      },
      setLanguage: (language) => {
        const resolvedLanguage = resolveSupportedLanguage(language);
        i18n.changeLanguage(resolvedLanguage);
        set({ language: resolvedLanguage });
        void hostApiFetch('/api/settings/language', {
          method: 'PUT',
          body: JSON.stringify({ value: resolvedLanguage }),
        }).catch(() => { });
      },
      setStartMinimized: (startMinimized) => set({ startMinimized }),
      setLaunchAtStartup: (launchAtStartup) => {
        set({ launchAtStartup });
        void hostApiFetch('/api/settings/launchAtStartup', {
          method: 'PUT',
          body: JSON.stringify({ value: launchAtStartup }),
        }).catch(() => { });
      },
      setTelemetryEnabled: (telemetryEnabled) => {
        set({ telemetryEnabled });
        void hostApiFetch('/api/settings/telemetryEnabled', {
          method: 'PUT',
          body: JSON.stringify({ value: telemetryEnabled }),
        }).catch(() => { });
      },
      setLogLevel: (logLevel) => {
        const normalized = normalizeAppLogLevel(logLevel);
        set({ logLevel: normalized });
        void hostApiFetch('/api/settings/logLevel', {
          method: 'PUT',
          body: JSON.stringify({ value: normalized }),
        }).catch(() => { });
      },
      setAuditEnabled: (auditEnabled) => {
        set({ auditEnabled });
        void hostApiFetch('/api/settings/auditEnabled', {
          method: 'PUT',
          body: JSON.stringify({ value: auditEnabled }),
        }).catch(() => { });
      },
      setAuditMode: (auditMode) => {
        const normalized = normalizeAuditMode(auditMode);
        set({ auditMode: normalized });
        void hostApiFetch('/api/settings/auditMode', {
          method: 'PUT',
          body: JSON.stringify({ value: normalized }),
        }).catch(() => { });
      },
      saveLoggingPolicy: async (patch) => {
        const normalizedPatch = {
          appLogRetentionDays: normalizeLogRetentionDays(
            patch.appLogRetentionDays,
            defaultSettings.appLogRetentionDays,
          ),
          auditLogRetentionDays: normalizeLogRetentionDays(
            patch.auditLogRetentionDays,
            defaultSettings.auditLogRetentionDays,
          ),
          logFileMaxSizeMb: normalizeLogFileMaxSizeMb(
            patch.logFileMaxSizeMb,
            defaultSettings.logFileMaxSizeMb,
          ),
        };
        await hostApiFetch('/api/settings', {
          method: 'PUT',
          body: JSON.stringify(normalizedPatch),
        });
        set(normalizedPatch);
      },
      setChatProcessDisplayMode: (chatProcessDisplayMode) => {
        set({ chatProcessDisplayMode });
        void hostApiFetch('/api/settings/chatProcessDisplayMode', {
          method: 'PUT',
          body: JSON.stringify({ value: chatProcessDisplayMode }),
        }).catch(() => { });
      },
      setHideInternalRoutineProcesses: (hideInternalRoutineProcesses) => {
        set({ hideInternalRoutineProcesses });
        void hostApiFetch('/api/settings/hideInternalRoutineProcesses', {
          method: 'PUT',
          body: JSON.stringify({ value: hideInternalRoutineProcesses }),
        }).catch(() => { });
      },
      setAssistantMessageStyle: (assistantMessageStyle) => {
        set({ assistantMessageStyle });
        void hostApiFetch('/api/settings/assistantMessageStyle', {
          method: 'PUT',
          body: JSON.stringify({ value: assistantMessageStyle }),
        }).catch(() => { });
      },
      setChatFontScale: (chatFontScale) => {
        const normalized = Math.max(85, Math.min(120, Math.round(chatFontScale)));
        set({ chatFontScale: normalized });
        void hostApiFetch('/api/settings/chatFontScale', {
          method: 'PUT',
          body: JSON.stringify({ value: normalized }),
        }).catch(() => { });
      },
      setDreamModeEnabled: async (dreamModeEnabled) => {
        const confirmed = await confirmGatewayImpact({
          mode: 'restart',
          willApplyChanges: true,
        });
        if (!confirmed) {
          return false;
        }
        await hostApiFetch('/api/settings/dreamModeEnabled', {
          method: 'PUT',
          body: JSON.stringify({ value: dreamModeEnabled }),
        });
        set({ dreamModeEnabled });
        return true;
      },
      setFileStorageBaseDir: (fileStorageBaseDir) => {
        const normalized = fileStorageBaseDir.trim();
        set({ fileStorageBaseDir: normalized });
        void hostApiFetch('/api/settings/fileStorageBaseDir', {
          method: 'PUT',
          body: JSON.stringify({ value: normalized }),
        }).catch(() => { });
      },
      setGatewayAutoStart: (gatewayAutoStart) => {
        set({ gatewayAutoStart });
        void hostApiFetch('/api/settings/gatewayAutoStart', {
          method: 'PUT',
          body: JSON.stringify({ value: gatewayAutoStart }),
        }).catch(() => { });
      },
      setGatewayPort: (gatewayPort) => {
        set({ gatewayPort });
        void hostApiFetch('/api/settings/gatewayPort', {
          method: 'PUT',
          body: JSON.stringify({ value: gatewayPort }),
        }).catch(() => { });
      },
      setProxyEnabled: (proxyEnabled) => set({ proxyEnabled }),
      setProxyServer: (proxyServer) => set({ proxyServer }),
      setProxyHttpServer: (proxyHttpServer) => set({ proxyHttpServer }),
      setProxyHttpsServer: (proxyHttpsServer) => set({ proxyHttpsServer }),
      setProxyAllServer: (proxyAllServer) => set({ proxyAllServer }),
      setProxyBypassRules: (proxyBypassRules) => set({ proxyBypassRules }),
      setUpdateChannel: (updateChannel) => set({ updateChannel }),
      setAutoCheckUpdate: (autoCheckUpdate) => set({ autoCheckUpdate }),
      setAutoDownloadUpdate: (autoDownloadUpdate) => set({ autoDownloadUpdate }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setDevModeUnlocked: (devModeUnlocked) => {
        set({ devModeUnlocked });
        void hostApiFetch('/api/settings/devModeUnlocked', {
          method: 'PUT',
          body: JSON.stringify({ value: devModeUnlocked }),
        }).catch(() => { });
      },
      markGuideSeen: (guideId, version) => {
        const normalizedGuideId = guideId.trim();
        const normalizedVersion = Number.isFinite(version) ? Math.max(0, Math.floor(version)) : 0;
        if (!normalizedGuideId || normalizedVersion <= 0) {
          return;
        }
        set((state) => ({
          guideSeenVersions: {
            ...state.guideSeenVersions,
            [normalizedGuideId]: normalizedVersion,
          },
        }));
      },
      markSetupComplete: () => set({ setupComplete: true }),
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: 'clawx-settings',
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<SettingsState> | undefined),
      }),
    }
  )
);
