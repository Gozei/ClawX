import { describe, expect, it } from 'vitest';
import { DEFAULT_BRANDING } from '../../shared/branding';
import {
  getNativeMenuMessages,
  getTrayTooltip,
} from '../../electron/main/native-localization';

describe('native localization', () => {
  it('returns Chinese labels for zh', () => {
    const labels = getNativeMenuMessages('zh');

    expect(labels.tray.gatewayStatus).toBe('网关状态');
    expect(labels.tray.openSettings).toBe('打开设置');
    expect(labels.appMenu.file).toBe('文件');
    expect(labels.appMenu.settings).toBe('设置');
  });

  it('returns English labels for en and unsupported locales', () => {
    expect(getNativeMenuMessages('en').tray.quickActions).toBe('Quick Actions');
    expect(getNativeMenuMessages('fr-FR').appMenu.help).toBe('Help');
  });

  it('formats the tray tooltip with localized gateway state', () => {
    expect(getTrayTooltip(DEFAULT_BRANDING, 'zh', 'running')).toBe('Deep AI Worker - 运行中');
    expect(getTrayTooltip(DEFAULT_BRANDING, 'en', 'stopped')).toBe('Deep AI Worker - Stopped');
  });
});
