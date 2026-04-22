/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Bot,
  Puzzle,
  Clock,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeft,
  Plus,
  MoreHorizontal,
  Pin,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useUpdateStore } from '@/stores/update';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useTranslation } from 'react-i18next';
import { AppLogo } from '@/components/branding/AppLogo';
import { useBranding } from '@/lib/branding';
import { SettingsHub } from '@/components/settings/SettingsHub';
import { isSessionRunning } from '@/stores/chat/session-running';

const SIDEBAR_EXPANDED_MIN_WIDTH = 240;
const SIDEBAR_EXPANDED_MAX_WIDTH = 420;
const SIDEBAR_COLLAPSED_WIDTH = 64;
const SESSION_AGENT_BADGE_WIDTH = 'w-[63px]';
let lastSkillsSearchSnapshot = '';

function sanitizeSkillsSearch(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('marketplace');
  const next = params.toString();
  return next ? `?${next}` : '';
}

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  collapsed?: boolean;
  onClick?: () => void;
  testId?: string;
}

function NavItem({ to, icon, label, badge, collapsed, onClick, testId }: NavItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      data-testid={testId}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[14px] font-medium transition-all duration-200',
          'text-foreground/78 hover:bg-[#eef3fb] hover:text-foreground dark:hover:bg-white/5',
          isActive
            ? 'bg-white text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10'
            : '',
          collapsed && 'justify-center px-0'
        )
      }
    >
      {({ isActive }) => (
        <>
          <div className={cn("flex shrink-0 items-center justify-center", isActive ? "text-primary" : "text-muted-foreground")}>
            {icon}
          </div>
          {!collapsed && (
            <>
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
              {badge && (
                <Badge variant="secondary" className="ml-auto shrink-0">
                  {badge}
                </Badge>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );
}

const SESSION_NAME_MAX_CHARS = 30;

function limitSessionName(value: string): string {
  return Array.from(value).slice(0, SESSION_NAME_MAX_CHARS).join('');
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function formatGatewayRestartElapsed(seconds: number, isChinese: boolean): string {
  const totalSeconds = Math.max(0, seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  if (minutes < 1) {
    return isChinese ? `${totalSeconds}\u79d2` : `${totalSeconds}s`;
  }

  return isChinese
    ? `${minutes}\u5206${remainingSeconds}\u79d2`
    : `${minutes}m ${remainingSeconds}s`;
}

function formatSidebarVersion(version: string | null | undefined): string {
  const trimmed = (version || '').trim();
  if (!trimmed) return 'v0.0.0';
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

function formatSidebarGatewayStateLabel(
  state: 'stopped' | 'starting' | 'running' | 'error' | 'reconnecting',
  isChinese: boolean,
): string {
  if (isChinese) {
    switch (state) {
      case 'running':
        return '正常';
      case 'starting':
        return '启动中';
      case 'reconnecting':
        return '重连中';
      case 'error':
        return '异常';
      default:
        return '未启动';
    }
  }

  switch (state) {
    case 'running':
      return 'healthy';
    case 'starting':
      return 'starting';
    case 'reconnecting':
      return 'reconnecting';
    case 'error':
      return 'error';
    default:
      return 'stopped';
  }
}

export function Sidebar() {
  const branding = useBranding();
  const location = useLocation();
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const sidebarWidth = useSettingsStore((state) => state.sidebarWidth);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);
  const setSidebarWidth = useSettingsStore((state) => state.setSidebarWidth);

  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sending = useChatStore((s) => s.sending);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const sendStage = useChatStore((s) => s.sendStage);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const sessionRunningState = useChatStore((s) => s.sessionRunningState ?? {});
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const toggleSessionPin = useChatStore((s) => s.toggleSessionPin);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadHistory = useChatStore((s) => s.loadHistory);

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const currentVersion = useUpdateStore((s) => s.currentVersion);

  useEffect(() => {
    let cancelled = false;
    const hasExistingMessages = useChatStore.getState().messages.length > 0;
    (async () => {
      await loadSessions();
      if (cancelled) return;
      await loadHistory(hasExistingMessages || !isGatewayRunning);
    })();
    return () => {
      cancelled = true;
    };
  }, [isGatewayRunning, loadHistory, loadSessions]);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const navigate = useNavigate();
  const isOnChat = location.pathname === '/';
  const [lastSkillsSearch, setLastSkillsSearch] = useState(lastSkillsSearchSnapshot);

  useEffect(() => {
    if (location.pathname === '/skills') {
      const sanitizedSearch = sanitizeSkillsSearch(location.search);
      lastSkillsSearchSnapshot = sanitizedSearch;
      setLastSkillsSearch(sanitizedSearch);
    }
  }, [location.pathname, location.search]);

  const getSessionLabel = (key: string, displayName?: string, label?: string) =>
    sessionLabels[key] ?? label ?? displayName ?? key;

  const { t, i18n } = useTranslation(['common', 'chat']);
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [editingSessionKey, setEditingSessionKey] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [openSessionMenuKey, setOpenSessionMenuKey] = useState<string | null>(null);
  const [settingsHubOpen, setSettingsHubOpen] = useState(false);
  const [gatewayHintNow, setGatewayHintNow] = useState(() => Date.now());
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const sessionMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const sessionMenuAnchorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const isSubmittingRenameRef = useRef(false);
  const resizeStartXRef = useRef<number | null>(null);
  const resizeStartWidthRef = useRef(sidebarWidth);
  const gatewayHintStartAtRef = useRef<number | null>(null);
  const [sessionMenuPosition, setSessionMenuPosition] = useState<{ right: number; top: number; transform: string } | null>(null);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (!editingSessionKey || !renameInputRef.current) return;
    renameInputRef.current.focus();
    renameInputRef.current.select();
  }, [editingSessionKey]);

  const resolveSessionMenuPosition = useCallback((sessionKey: string) => {
    const anchor = sessionMenuAnchorRefs.current[sessionKey];
    if (!anchor) {
      return null;
    }

    const rect = anchor.getBoundingClientRect();
    const viewportPadding = 12;
    const estimatedMenuHeight = 112;
    const right = Math.max(window.innerWidth - rect.right, viewportPadding);
    const canOpenBelow = rect.bottom + 6 + estimatedMenuHeight <= window.innerHeight - viewportPadding;

    return canOpenBelow
      ? { right, top: rect.bottom + 6, transform: 'translateY(0)' }
      : { right, top: rect.top - 6, transform: 'translateY(-100%)' };
  }, []);

  const updateSessionMenuPosition = useCallback(() => {
    if (!openSessionMenuKey) {
      setSessionMenuPosition(null);
      return;
    }

    setSessionMenuPosition(resolveSessionMenuPosition(openSessionMenuKey));
  }, [openSessionMenuKey, resolveSessionMenuPosition]);

  useLayoutEffect(() => {
    if (!openSessionMenuKey) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const anchor = sessionMenuAnchorRefs.current[openSessionMenuKey];
      if (!sessionMenuPanelRef.current?.contains(target) && !anchor?.contains(target)) {
        setOpenSessionMenuKey(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenSessionMenuKey(null);
      }
    };
    const handleViewportChange = () => updateSessionMenuPosition();

    updateSessionMenuPosition();
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [openSessionMenuKey, updateSessionMenuPosition]);

  useEffect(() => {
    if (!settingsHubOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsHubOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [settingsHubOpen]);

  useEffect(() => {
    if (!(gatewayStatus.state === 'starting' || gatewayStatus.state === 'reconnecting')) {
      gatewayHintStartAtRef.current = null;
      return;
    }

    const now = Date.now();
    if (gatewayHintStartAtRef.current == null) {
      gatewayHintStartAtRef.current = now;
    }
    setGatewayHintNow(now);

    const timer = window.setInterval(() => {
      setGatewayHintNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [gatewayStatus.state]);

  const agentNameById = useMemo(
    () => Object.fromEntries((agents ?? []).map((agent) => [agent.id, agent.name])),
    [agents],
  );

  const sessionMenuLabels = useMemo(() => {
    if (i18n.resolvedLanguage?.startsWith('zh')) {
      return {
        rename: '\u91cd\u547d\u540d',
        pin: '\u7f6e\u9876',
        unpin: '\u53d6\u6d88\u7f6e\u9876',
      };
    }

    return {
      rename: 'Rename',
      pin: 'Pin',
      unpin: 'Unpin',
    };
  }, [i18n.resolvedLanguage]);

  const isChinese = i18n.resolvedLanguage?.startsWith('zh') ?? false;
  const sessionSectionLabel = isChinese ? '会话记录' : 'Session History';
  const gatewayRestartHintLabel = isChinese ? '网关启动中' : 'Gateway starting';
  const showGatewayRestartHint = gatewayStatus.state === 'starting' || gatewayStatus.state === 'reconnecting';
  const sidebarVersionLabel = isChinese ? '版本' : 'Version';
  const sidebarGatewayStateLabel = formatSidebarGatewayStateLabel(gatewayStatus.state, isChinese);
  const sidebarSystemStatusLabel = isChinese
    ? (isGatewayRunning ? '系统运行正常' : `系统状态异常：${sidebarGatewayStateLabel}`)
    : (isGatewayRunning ? 'System healthy' : `System degraded: ${sidebarGatewayStateLabel}`);
  const sidebarVersionValue = formatSidebarVersion(currentVersion);
  const gatewayRestartElapsedSeconds = gatewayHintStartAtRef.current == null
    ? 0
    : Math.floor((gatewayHintNow - gatewayHintStartAtRef.current) / 1000);
  const gatewayRestartElapsedLabel = showGatewayRestartHint
    ? formatGatewayRestartElapsed(gatewayRestartElapsedSeconds, isChinese)
    : '';
  const currentSessionRunSnapshot = useMemo(() => ({
    currentSessionKey,
    sending,
    pendingFinal,
    sendStage,
    streamingMessage,
    streamingTools,
  }), [currentSessionKey, pendingFinal, sending, sendStage, streamingMessage, streamingTools]);

  const startRenamingSession = (sessionKey: string, currentLabel: string) => {
    isSubmittingRenameRef.current = false;
    setEditingSessionKey(sessionKey);
    setEditingSessionName(limitSessionName(currentLabel));
  };

  const cancelRenamingSession = () => {
    setEditingSessionKey(null);
    setEditingSessionName('');
  };

  const submitSessionRename = async () => {
    if (!editingSessionKey || isSubmittingRenameRef.current) return;
    isSubmittingRenameRef.current = true;
    const targetSessionKey = editingSessionKey;
    const normalized = limitSessionName(editingSessionName.trim());
    if (!normalized) {
      cancelRenamingSession();
      isSubmittingRenameRef.current = false;
      return;
    }

    cancelRenamingSession();

    try {
      await renameSession(targetSessionKey, normalized);
    } catch (error) {
      console.error('Failed to rename session:', error);
    } finally {
      isSubmittingRenameRef.current = false;
    }
  };

  const startSidebarResize = (event: { clientX: number; preventDefault: () => void }) => {
    if (sidebarCollapsed) return;
    event.preventDefault();
    resizeStartXRef.current = event.clientX;
    resizeStartWidthRef.current = sidebarWidth;

    const handlePointerMove = (moveEvent: MouseEvent) => {
      if (resizeStartXRef.current == null) return;
      const deltaX = moveEvent.clientX - resizeStartXRef.current;
      const nextWidth = Math.max(
        SIDEBAR_EXPANDED_MIN_WIDTH,
        Math.min(SIDEBAR_EXPANDED_MAX_WIDTH, resizeStartWidthRef.current + deltaX),
      );
      setSidebarWidth(nextWidth);
    };

    const stopResizing = () => {
      resizeStartXRef.current = null;
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', stopResizing);
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', stopResizing, { once: true });
  };

  const renderSessionRow = (s: typeof sessions[number]) => {
    const agentId = getAgentIdFromSessionKey(s.key);
    const agentName = agentNameById[agentId] || agentId;
    const sessionLabel = getSessionLabel(s.key, s.displayName, s.label);
    const isEditing = editingSessionKey === s.key;
    const isMenuOpen = openSessionMenuKey === s.key;
    const isSessionRunningNow = isSessionRunning(s.key, sessionRunningState, currentSessionRunSnapshot);

    return (
      <div key={s.key} className="group relative flex items-center" data-testid={`sidebar-session-${s.key}`}>
        {isEditing ? (
          <div
            className={cn(
              'w-full rounded-lg px-3 py-1.5 pr-12 text-left text-[13px]',
              isOnChat && currentSessionKey === s.key
                ? 'bg-white text-foreground font-medium shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10'
                : 'text-foreground/75',
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                data-testid={`sidebar-session-role-${s.key}`}
                className={cn(
                  SESSION_AGENT_BADGE_WIDTH,
                  'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white px-2 py-0.5 text-center text-[10px] font-medium text-foreground/70 ring-1 ring-black/5 whitespace-nowrap dark:bg-white/[0.08] dark:ring-white/10',
                )}
                title={agentName}
              >
                <span className="truncate">{agentName}</span>
              </span>
              <input
                ref={renameInputRef}
                value={editingSessionName}
                data-testid="sidebar-session-rename-input"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditingSessionName(limitSessionName(e.target.value))}
                onBlur={() => { void submitSessionRename(); }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submitSessionRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelRenamingSession();
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
              />
            </div>
          </div>
        ) : (
          <button
            onClick={() => {
              switchSession(s.key);
              navigate('/');
            }}
            className={cn(
              'w-full rounded-lg px-3 py-1.5 pr-12 text-left text-[13px] transition-all duration-200',
              'hover:bg-[#eef3fb] dark:hover:bg-white/5',
              isOnChat && currentSessionKey === s.key
                ? 'bg-white text-foreground font-medium shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10'
                : 'text-foreground/75',
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                data-testid={`sidebar-session-role-${s.key}`}
                className={cn(
                  SESSION_AGENT_BADGE_WIDTH,
                  'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white px-2 py-0.5 text-center text-[10px] font-medium text-foreground/70 ring-1 ring-black/5 whitespace-nowrap dark:bg-white/[0.08] dark:ring-white/10',
                )}
                title={agentName}
              >
                <span className="truncate">{agentName}</span>
              </span>
              <span
                data-testid={`sidebar-session-title-${s.key}`}
                className="min-w-0 flex-1 truncate"
                title={sessionLabel}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  startRenamingSession(s.key, sessionLabel);
                }}
              >
                {sessionLabel}
              </span>
            </div>
          </button>
        )}
        {!isEditing && (
          <div
            ref={(node) => {
              sessionMenuAnchorRefs.current[s.key] = node;
            }}
            className="absolute right-1 flex items-center"
            data-testid={`sidebar-session-menu-root-${s.key}`}
          >
            {isSessionRunningNow && (
              <div
                data-testid={`sidebar-session-running-indicator-${s.key}`}
                className={cn(
                  'pointer-events-none absolute right-0 flex h-7 w-7 items-center justify-center rounded-md text-primary transition-all',
                  isMenuOpen ? 'opacity-0' : 'opacity-100 group-hover:opacity-0',
                )}
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </div>
            )}
            {!isSessionRunningNow && s.pinned && (
              <div
                data-testid={`sidebar-session-pin-indicator-${s.key}`}
                className={cn(
                  'pointer-events-none absolute right-0 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-all',
                  isMenuOpen ? 'opacity-0' : 'opacity-100 group-hover:opacity-0',
                )}
              >
                <Pin className="h-3.5 w-3.5 rotate-[28deg]" />
              </div>
            )}
            <button
              aria-label="Session actions"
              data-testid={`sidebar-session-menu-trigger-${s.key}`}
              aria-expanded={isMenuOpen}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpenSessionMenuKey((currentKey) => {
                  if (currentKey === s.key) {
                    setSessionMenuPosition(null);
                    return null;
                  }

                  setSessionMenuPosition(resolveSessionMenuPosition(s.key));
                  return s.key;
                });
              }}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-all',
                isMenuOpen
                  ? 'opacity-100 bg-white text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10'
                  : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:bg-white hover:text-foreground dark:hover:bg-white/10',
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

          </div>
        )}
      </div>
    );
  };

  const pinnedSessions = [...sessions]
    .filter((session) => session.pinned)
    .sort((a, b) => {
      const pinOrderDiff = (a.pinOrder ?? Number.MAX_SAFE_INTEGER) - (b.pinOrder ?? Number.MAX_SAFE_INTEGER);
      if (pinOrderDiff !== 0) return pinOrderDiff;
      return (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0);
    });

  const unpinnedSessions = [...sessions]
    .filter((session) => !session.pinned)
    .sort((a, b) => (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0));

  const renderedSidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
  const activeSessionMenuSession = openSessionMenuKey
    ? sessions.find((session) => session.key === openSessionMenuKey) ?? null
    : null;
  const activeSessionMenuLabel = activeSessionMenuSession
    ? getSessionLabel(activeSessionMenuSession.key, activeSessionMenuSession.displayName, activeSessionMenuSession.label)
    : '';

  const navItems = [
    { to: '/agents', icon: <Bot className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.agents'), testId: 'sidebar-nav-agents' },
    { to: `/skills${lastSkillsSearch}`, icon: <Puzzle className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.skills'), testId: 'sidebar-nav-skills' },
    { to: '/cron', icon: <Clock className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.cronTasks'), testId: 'sidebar-nav-cron' },
  ];

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'relative flex shrink-0 flex-col border-r border-black/6 bg-[#f3f6fb] text-foreground/90 transition-[width] duration-200 dark:bg-background'
      )}
      style={{ width: `${renderedSidebarWidth}px` }}
    >
      {/* Top Header Toggle */}
      <div
        data-testid="sidebar-top-header"
        className={cn("flex h-14 items-center border-b border-black/5 px-3 py-3", sidebarCollapsed ? "justify-center" : "justify-between")}
      >
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2.5 overflow-hidden">
            <AppLogo testId="sidebar-brand-logo" className="h-[22.5px]" />
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-[-0.01em] truncate whitespace-nowrap text-foreground/95">
                {branding.productName}
              </div>
              <div className="text-[11px] tracking-[0.02em] text-muted-foreground/90">
                by {branding.vendorName}
              </div>
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-lg text-muted-foreground hover:bg-white hover:text-foreground dark:hover:bg-white/10"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="h-[18px] w-[18px]" />
          ) : (
            <PanelLeftClose className="h-[18px] w-[18px]" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 px-2.5 py-3">
        {!sidebarCollapsed && showGatewayRestartHint && (
          <div
            data-testid="sidebar-gateway-restarting-hint"
            className="mb-2 rounded-[14px] border border-red-200/80 bg-red-50/95 px-3.5 py-2 text-[12px] font-medium text-red-600 shadow-[0_4px_14px_rgba(248,113,113,0.10)] dark:border-red-300/20 dark:bg-red-400/10 dark:text-red-200"
          >
            <div className="inline-flex items-center">
              <span>{gatewayRestartHintLabel}</span>
              <span
                data-testid="sidebar-gateway-restarting-elapsed"
                className="ml-1 text-red-600/80 dark:text-red-200/80"
              >
                {isChinese ? `（${gatewayRestartElapsedLabel}）` : `(${gatewayRestartElapsedLabel})`}
              </span>
              <span
                aria-hidden="true"
                data-testid="sidebar-gateway-restarting-ellipsis"
                className="ml-1 inline-flex w-[18px] justify-start"
              >
                {[0, 1, 2].map((index) => (
                  <span
                    key={index}
                    className="inline-block motion-safe:animate-pulse"
                    style={{
                      animationDelay: `${index * 160}ms`,
                      animationDuration: '1.1s',
                    }}
                  >
                    .
                  </span>
                ))}
              </span>
            </div>
          </div>
        )}
        <button
          data-testid="sidebar-new-chat"
          onClick={() => {
            const {
              messages,
              currentSessionKey: activeSessionKey,
              sessions: persistedSessions,
            } = useChatStore.getState();
            const hasPersistedCurrentSession = persistedSessions.some((session) => session.key === activeSessionKey);

            if (messages.length > 0 || hasPersistedCurrentSession) {
              newSession();
            }
            navigate('/');
          }}
          className={cn(
            'group mb-2 flex w-full items-center gap-2.5 rounded-[16px] px-3.5 py-3 text-[14px] font-semibold transition-all duration-200',
            'border-0 bg-[linear-gradient(135deg,#4f8df7_0%,#2f6fe4_100%)] text-white shadow-[0_14px_34px_rgba(47,111,228,0.28)]',
            'hover:-translate-y-0.5 hover:bg-[linear-gradient(135deg,#5b97fb_0%,#3169d6_100%)] hover:shadow-[0_18px_38px_rgba(47,111,228,0.34)] active:translate-y-0',
            sidebarCollapsed && 'justify-center px-0',
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/16 ring-1 ring-white/20 transition group-hover:bg-white/20">
            <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </div>
          {!sidebarCollapsed && <span className="flex-1 overflow-hidden text-left text-ellipsis whitespace-nowrap">{t('sidebar.newChat')}</span>}
        </button>

        {navItems.map((item) => (
          <NavItem
            key={item.to}
            {...item}
            collapsed={sidebarCollapsed}
          />
        ))}
      </nav>

      {/* Session list */}
      {!sidebarCollapsed && (
        <div className="mt-2 flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-2">
          <div className="px-3 pb-1.5 text-[11px] font-medium text-muted-foreground/70 tracking-[0.01em]">
            {sessionSectionLabel}
          </div>
          <div data-testid="sidebar-pinned-sessions">
            {pinnedSessions.map(renderSessionRow)}
          </div>
          <div data-testid="sidebar-session-list">
            {unpinnedSessions.map(renderSessionRow)}
          </div>
        </div>
      )}

      {openSessionMenuKey && activeSessionMenuSession && sessionMenuPosition && createPortal(
        <div
          ref={sessionMenuPanelRef}
          data-testid={`sidebar-session-menu-panel-${openSessionMenuKey}`}
          className="fixed z-[180] min-w-[120px] overflow-hidden rounded-lg border border-black/8 bg-white py-1 shadow-[0_12px_28px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-[#12161f]"
          style={{
            right: `${sessionMenuPosition.right}px`,
            top: `${sessionMenuPosition.top}px`,
            transform: sessionMenuPosition.transform,
          }}
        >
          <button
            type="button"
            data-testid={`sidebar-session-menu-rename-${openSessionMenuKey}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpenSessionMenuKey(null);
              startRenamingSession(openSessionMenuKey, activeSessionMenuLabel);
            }}
            className="flex w-full items-center px-3 py-2 text-left text-[13px] text-foreground/85 transition-colors hover:bg-[#eef3fb] dark:hover:bg-white/5"
          >
            {sessionMenuLabels.rename}
          </button>
          <button
            type="button"
            data-testid={`sidebar-session-menu-pin-${openSessionMenuKey}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpenSessionMenuKey(null);
              void toggleSessionPin(openSessionMenuKey);
            }}
            className="flex w-full items-center px-3 py-2 text-left text-[13px] text-foreground/85 transition-colors hover:bg-[#eef3fb] dark:hover:bg-white/5"
          >
            {activeSessionMenuSession.pinned ? sessionMenuLabels.unpin : sessionMenuLabels.pin}
          </button>
          <button
            type="button"
            data-testid={`sidebar-session-menu-delete-${openSessionMenuKey}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpenSessionMenuKey(null);
              setSessionToDelete({
                key: openSessionMenuKey,
                label: activeSessionMenuLabel,
              });
            }}
            className="flex w-full items-center px-3 py-2 text-left text-[13px] text-destructive transition-colors hover:bg-destructive/10"
          >
            {t('common:actions.delete')}
          </button>
        </div>,
        document.body,
      )}

      {/* Footer */}
      <div className="relative mt-auto border-t border-black/5 p-2.5">
        <Button
          data-testid="sidebar-nav-settings"
          variant="ghost"
          className={cn(
            'flex h-auto w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-all duration-200',
            'text-foreground/78 hover:bg-[#eef3fb] dark:hover:bg-white/5',
            sidebarCollapsed ? 'justify-center px-0' : 'justify-start',
          )}
          onClick={() => setSettingsHubOpen(true)}
        >
          <div className="flex shrink-0 items-center justify-center text-muted-foreground">
            <SettingsIcon className="h-[18px] w-[18px]" strokeWidth={2} />
          </div>
          {!sidebarCollapsed && <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">{t('sidebar.settings')}</span>}
        </Button>

        {!sidebarCollapsed && (
          <div
            data-testid="sidebar-system-summary"
            className="mt-2 flex items-center gap-3 rounded-[16px] border border-black/8 bg-transparent px-3.5 py-2.5 dark:border-white/10"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[12px] font-medium text-foreground/72">
                <span>{sidebarVersionLabel}</span>
                <span
                  data-testid="sidebar-system-version"
                  className="min-w-0 truncate font-semibold text-foreground/92"
                >
                  {sidebarVersionValue}
                </span>
              </div>
            </div>
            <span
              data-testid="sidebar-system-status"
              aria-label={sidebarSystemStatusLabel}
              title={sidebarSystemStatusLabel}
              className={cn(
                'h-3 w-3 shrink-0 rounded-full ring-4',
                isGatewayRunning ? 'bg-green-500 ring-green-500/15' : 'bg-red-500 ring-red-500/15',
              )}
            />
          </div>
        )}

        {settingsHubOpen && (
          <div
            data-testid="settings-hub-sheet-container"
            className="absolute bottom-full left-2.5 z-[130] mb-2 flex w-fit flex-col bg-transparent"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="w-fit">
              <SettingsHub mode="sheet" onRequestClose={() => setSettingsHubOpen(false)} />
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!sessionToDelete}
        title={t('common:actions.confirm')}
        message={t('common:sidebar.deleteSessionConfirm', { label: sessionToDelete?.label })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!sessionToDelete) return;
          await deleteSession(sessionToDelete.key);
          if (currentSessionKey === sessionToDelete.key) navigate('/');
          setSessionToDelete(null);
        }}
        onCancel={() => setSessionToDelete(null)}
      />
      {!sidebarCollapsed && (
        <div
          data-testid="sidebar-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={startSidebarResize}
          className="absolute inset-y-0 -right-1 z-20 hidden w-2 cursor-col-resize md:block"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/8 transition-colors hover:bg-primary/45" />
        </div>
      )}

      {settingsHubOpen && (
        <div
          className="fixed inset-0 z-[120] bg-black/28 dark:bg-black/52"
          onClick={() => setSettingsHubOpen(false)}
        />
      )}
    </aside>
  );
}
