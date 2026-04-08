import { getBrandTagline, type BrandingConfig } from '../../shared/branding';
import { resolveSupportedLanguage, type LanguageCode } from '../../shared/language';
import type { GatewayLifecycleState } from '../gateway/process-policy';
import { getSetting } from '../utils/store';

type NativeMenuMessages = {
  tray: {
    showProduct: (productName: string) => string;
    gatewayStatus: string;
    gatewayStates: Record<GatewayLifecycleState, string>;
    quickActions: string;
    openChat: string;
    openSettings: string;
    checkForUpdates: string;
    quitProduct: (productName: string) => string;
  };
  appMenu: {
    aboutProduct: (productName: string) => string;
    preferences: string;
    services: string;
    hideProduct: (productName: string) => string;
    hideOthers: string;
    showAll: string;
    quitProduct: (productName: string) => string;
    file: string;
    newChat: string;
    closeWindow: string;
    edit: string;
    undo: string;
    redo: string;
    cut: string;
    copy: string;
    paste: string;
    pasteAndMatchStyle: string;
    delete: string;
    selectAll: string;
    view: string;
    reload: string;
    forceReload: string;
    toggleDevTools: string;
    actualSize: string;
    zoomIn: string;
    zoomOut: string;
    toggleFullScreen: string;
    navigate: string;
    overview: string;
    chat: string;
    channels: string;
    skills: string;
    cron: string;
    settings: string;
    window: string;
    minimize: string;
    zoom: string;
    bringAllToFront: string;
    help: string;
    website: string;
    reportIssue: string;
    openClawDocs: string;
  };
};

const NATIVE_MENU_MESSAGES: Record<LanguageCode, NativeMenuMessages> = {
  en: {
    tray: {
      showProduct: (productName) => `Show ${productName}`,
      gatewayStatus: 'Gateway Status',
      gatewayStates: {
        stopped: 'Stopped',
        starting: 'Starting',
        running: 'Running',
        error: 'Error',
        reconnecting: 'Reconnecting',
      },
      quickActions: 'Quick Actions',
      openChat: 'Open Chat',
      openSettings: 'Open Settings',
      checkForUpdates: 'Check for Updates...',
      quitProduct: (productName) => `Quit ${productName}`,
    },
    appMenu: {
      aboutProduct: (productName) => `About ${productName}`,
      preferences: 'Preferences...',
      services: 'Services',
      hideProduct: (productName) => `Hide ${productName}`,
      hideOthers: 'Hide Others',
      showAll: 'Show All',
      quitProduct: (productName) => `Quit ${productName}`,
      file: 'File',
      newChat: 'New Chat',
      closeWindow: 'Close Window',
      edit: 'Edit',
      undo: 'Undo',
      redo: 'Redo',
      cut: 'Cut',
      copy: 'Copy',
      paste: 'Paste',
      pasteAndMatchStyle: 'Paste and Match Style',
      delete: 'Delete',
      selectAll: 'Select All',
      view: 'View',
      reload: 'Reload',
      forceReload: 'Force Reload',
      toggleDevTools: 'Toggle Developer Tools',
      actualSize: 'Actual Size',
      zoomIn: 'Zoom In',
      zoomOut: 'Zoom Out',
      toggleFullScreen: 'Toggle Full Screen',
      navigate: 'Navigate',
      overview: 'Overview',
      chat: 'Chat',
      channels: 'Channels',
      skills: 'Skills',
      cron: 'Cron Tasks',
      settings: 'Settings',
      window: 'Window',
      minimize: 'Minimize',
      zoom: 'Zoom',
      bringAllToFront: 'Bring All to Front',
      help: 'Help',
      website: 'Website',
      reportIssue: 'Report Issue',
      openClawDocs: 'OpenClaw Docs',
    },
  },
  zh: {
    tray: {
      showProduct: (productName) => `显示 ${productName}`,
      gatewayStatus: '网关状态',
      gatewayStates: {
        stopped: '已停止',
        starting: '启动中',
        running: '运行中',
        error: '异常',
        reconnecting: '重连中',
      },
      quickActions: '快捷操作',
      openChat: '打开对话',
      openSettings: '打开设置',
      checkForUpdates: '检查更新...',
      quitProduct: (productName) => `退出 ${productName}`,
    },
    appMenu: {
      aboutProduct: (productName) => `关于 ${productName}`,
      preferences: '偏好设置...',
      services: '服务',
      hideProduct: (productName) => `隐藏 ${productName}`,
      hideOthers: '隐藏其他',
      showAll: '显示全部',
      quitProduct: (productName) => `退出 ${productName}`,
      file: '文件',
      newChat: '新建对话',
      closeWindow: '关闭窗口',
      edit: '编辑',
      undo: '撤销',
      redo: '重做',
      cut: '剪切',
      copy: '复制',
      paste: '粘贴',
      pasteAndMatchStyle: '粘贴并匹配样式',
      delete: '删除',
      selectAll: '全选',
      view: '显示',
      reload: '重新载入',
      forceReload: '强制重新载入',
      toggleDevTools: '切换开发者工具',
      actualSize: '实际大小',
      zoomIn: '放大',
      zoomOut: '缩小',
      toggleFullScreen: '切换全屏',
      navigate: '导航',
      overview: '总览',
      chat: '对话',
      channels: '渠道',
      skills: '技能',
      cron: '定时任务',
      settings: '设置',
      window: '窗口',
      minimize: '最小化',
      zoom: '缩放',
      bringAllToFront: '前置全部窗口',
      help: '帮助',
      website: '官网',
      reportIssue: '反馈问题',
      openClawDocs: 'OpenClaw 文档',
    },
  },
};

export function getNativeMenuMessages(language: string | null | undefined): NativeMenuMessages {
  return NATIVE_MENU_MESSAGES[resolveSupportedLanguage(language)];
}

export async function getCurrentNativeMenuMessages(): Promise<NativeMenuMessages> {
  const language = await getSetting('language');
  return getNativeMenuMessages(language);
}

export async function getCurrentNativeMenuLanguage(): Promise<LanguageCode> {
  const language = await getSetting('language');
  return resolveSupportedLanguage(language);
}

export function getTrayTooltip(
  branding: BrandingConfig,
  language: string | null | undefined,
  gatewayState?: GatewayLifecycleState,
): string {
  if (gatewayState) {
    const stateLabel = getNativeMenuMessages(language).tray.gatewayStates[gatewayState];
    return `${branding.trayTitle} - ${stateLabel}`;
  }
  return `${branding.trayTitle} - ${getBrandTagline(branding, language)}`;
}
