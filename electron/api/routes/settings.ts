import type { IncomingMessage, ServerResponse } from 'http';
import { applyProxySettings } from '../../main/proxy';
import { syncLaunchAtStartupSettingFromStore } from '../../main/launch-at-startup';
import { createMenu } from '../../main/menu';
import { refreshTray } from '../../main/tray';
import { syncProxyConfigToOpenClaw } from '../../utils/openclaw-proxy';
import { getAllSettings, getSetting, resetSettings, setSetting, type AppSettings } from '../../utils/store';
import { applyRuntimeLoggingSettings, patchTouchesLoggingSettings } from '../../utils/logging-config';
import type { HostApiContext } from '../context';
import { emitMutationAudit } from '../audit-utils';
import { parseJsonBody, sendJson } from '../route-utils';

async function handleProxySettingsChange(ctx: HostApiContext): Promise<void> {
  const settings = await getAllSettings();
  await syncProxyConfigToOpenClaw(settings, { preserveExistingWhenDisabled: false });
  await applyProxySettings(settings);
  if (ctx.gatewayManager.getStatus().state === 'running') {
    await ctx.gatewayManager.restart();
  }
}

function patchTouchesProxy(patch: Partial<AppSettings>): boolean {
  return Object.keys(patch).some((key) => (
    key === 'proxyEnabled' ||
    key === 'proxyServer' ||
    key === 'proxyHttpServer' ||
    key === 'proxyHttpsServer' ||
    key === 'proxyAllServer' ||
    key === 'proxyBypassRules'
  ));
}

function patchTouchesLaunchAtStartup(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'launchAtStartup');
}

function patchTouchesNativeMenus(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'language')
    || Object.prototype.hasOwnProperty.call(patch, 'brandingOverrides');
}

async function refreshNativeMenus(ctx: HostApiContext): Promise<void> {
  await createMenu();
  await refreshTray(ctx.mainWindow);
}

export async function handleSettingsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/settings' && req.method === 'GET') {
    sendJson(res, 200, await getAllSettings());
    return true;
  }

  if (url.pathname === '/api/settings' && req.method === 'PUT') {
    const startedAt = Date.now();
    try {
      const patch = await parseJsonBody<Partial<AppSettings>>(req);
      const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
      for (const [key, value] of entries) {
        await setSetting(key, value);
      }
      if (patchTouchesLoggingSettings(patch)) {
        applyRuntimeLoggingSettings(patch);
      }
      if (patchTouchesProxy(patch)) {
        await handleProxySettingsChange(ctx);
      }
      if (patchTouchesLaunchAtStartup(patch)) {
        await syncLaunchAtStartupSettingFromStore();
      }
      if (patchTouchesNativeMenus(patch)) {
        await refreshNativeMenus(ctx);
      }
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'settings.update',
        resourceType: 'settings',
        resourceId: 'application',
        result: Object.keys(patch).length === 0 ? 'noop' : 'success',
        changedKeys: Object.keys(patch),
        metadata: {
          scope: 'bulk',
          changedSettingCount: Object.keys(patch).length,
        },
        force: patchTouchesLoggingSettings(patch),
      });
      sendJson(res, 200, { success: true });
    } catch (error) {
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'settings.update',
        resourceType: 'settings',
        resourceId: 'application',
        result: 'failure',
        error,
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'GET') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      sendJson(res, 200, { value: await getSetting(key) });
    } catch (error) {
      sendJson(res, 404, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'PUT') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    const startedAt = Date.now();
    try {
      const body = await parseJsonBody<{ value: AppSettings[keyof AppSettings] }>(req);
      await setSetting(key, body.value);
      if (
        key === 'logLevel'
        || key === 'auditEnabled'
        || key === 'auditMode'
        || key === 'appLogRetentionDays'
        || key === 'auditLogRetentionDays'
        || key === 'logFileMaxSizeMb'
      ) {
        applyRuntimeLoggingSettings({ [key]: body.value } as Partial<AppSettings>);
      }
      if (
        key === 'proxyEnabled' ||
        key === 'proxyServer' ||
        key === 'proxyHttpServer' ||
        key === 'proxyHttpsServer' ||
        key === 'proxyAllServer' ||
        key === 'proxyBypassRules'
      ) {
        await handleProxySettingsChange(ctx);
      }
      if (key === 'launchAtStartup') {
        await syncLaunchAtStartupSettingFromStore();
      }
      if (key === 'language' || key === 'brandingOverrides') {
        await refreshNativeMenus(ctx);
      }
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'settings.update',
        resourceType: 'settings',
        resourceId: String(key),
        result: 'success',
        changedKeys: [String(key)],
        metadata: {
          scope: 'single',
        },
        force: key === 'logLevel'
          || key === 'auditEnabled'
          || key === 'auditMode'
          || key === 'appLogRetentionDays'
          || key === 'auditLogRetentionDays'
          || key === 'logFileMaxSizeMb',
      });
      sendJson(res, 200, { success: true });
    } catch (error) {
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'settings.update',
        resourceType: 'settings',
        resourceId: String(key),
        result: 'failure',
        changedKeys: [String(key)],
        error,
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/reset' && req.method === 'POST') {
    const startedAt = Date.now();
    try {
      await resetSettings();
      const settings = await getAllSettings();
      applyRuntimeLoggingSettings({
        logLevel: settings.logLevel,
        auditEnabled: settings.auditEnabled,
        auditMode: settings.auditMode,
        appLogRetentionDays: settings.appLogRetentionDays,
        auditLogRetentionDays: settings.auditLogRetentionDays,
        logFileMaxSizeMb: settings.logFileMaxSizeMb,
      });
      await handleProxySettingsChange(ctx);
      await syncLaunchAtStartupSettingFromStore();
      await refreshNativeMenus(ctx);
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'settings.reset',
        resourceType: 'settings',
        resourceId: 'application',
        result: 'success',
        changedKeys: ['*'],
        metadata: {
          scope: 'reset',
        },
        force: true,
      });
      sendJson(res, 200, { success: true, settings });
    } catch (error) {
      emitMutationAudit(req, ctx, {
        startedAt,
        action: 'settings.reset',
        resourceType: 'settings',
        resourceId: 'application',
        result: 'failure',
        error,
        force: true,
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
