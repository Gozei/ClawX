/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Network,
  Bot,
  Puzzle,
  Clock,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeft,
  Plus,
  Terminal,
  ExternalLink,
  Cpu,
  MoreHorizontal,
  Pin,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hostApiFetch } from '@/lib/host-api';
import { useTranslation } from 'react-i18next';
import { AppLogo } from '@/components/branding/AppLogo';
import { useBranding } from '@/lib/branding';

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
          'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-all duration-200',
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

export function Sidebar() {
  const branding = useBranding();
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);

  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
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

  useEffect(() => {
    if (!isGatewayRunning) return;
    let cancelled = false;
    const hasExistingMessages = useChatStore.getState().messages.length > 0;
    (async () => {
      await loadSessions();
      if (cancelled) return;
      await loadHistory(hasExistingMessages);
    })();
    return () => {
      cancelled = true;
    };
  }, [isGatewayRunning, loadHistory, loadSessions]);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const navigate = useNavigate();
  const isOnChat = useLocation().pathname === '/';

  const getSessionLabel = (key: string, displayName?: string, label?: string) =>
    sessionLabels[key] ?? label ?? displayName ?? key;

  const openDevConsole = async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        url?: string;
        error?: string;
      }>('/api/gateway/control-ui');
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
      } else {
        console.error('Failed to get Dev Console URL:', result.error);
      }
    } catch (err) {
      console.error('Error opening Dev Console:', err);
    }
  };

  const { t, i18n } = useTranslation(['common', 'chat']);
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [editingSessionKey, setEditingSessionKey] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [openSessionMenuKey, setOpenSessionMenuKey] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement | null>(null);
  const isSubmittingRenameRef = useRef(false);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (!editingSessionKey || !renameInputRef.current) return;
    renameInputRef.current.focus();
    renameInputRef.current.select();
  }, [editingSessionKey]);

  useEffect(() => {
    if (!openSessionMenuKey) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (sessionMenuRef.current && !sessionMenuRef.current.contains(event.target as Node)) {
        setOpenSessionMenuKey(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenSessionMenuKey(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openSessionMenuKey]);

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

  const renderSessionRow = (s: typeof sessions[number]) => {
    const agentId = getAgentIdFromSessionKey(s.key);
    const agentName = agentNameById[agentId] || agentId;
    const sessionLabel = getSessionLabel(s.key, s.displayName, s.label);
    const isEditing = editingSessionKey === s.key;
    const isMenuOpen = openSessionMenuKey === s.key;

    return (
      <div key={s.key} className="group relative flex items-center" data-testid={`sidebar-session-${s.key}`}>
        {isEditing ? (
          <div
            className={cn(
              'w-full rounded-xl px-3 py-2 pr-12 text-left text-[13px]',
              isOnChat && currentSessionKey === s.key
                ? 'bg-white text-foreground font-medium shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10'
                : 'text-foreground/75',
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-foreground/70 ring-1 ring-black/5 dark:bg-white/[0.08] dark:ring-white/10">
                {agentName}
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
              'w-full rounded-xl px-3 py-2 pr-12 text-left text-[13px] transition-all duration-200',
              'hover:bg-[#eef3fb] dark:hover:bg-white/5',
              isOnChat && currentSessionKey === s.key
                ? 'bg-white text-foreground font-medium shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10'
                : 'text-foreground/75',
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-foreground/70 ring-1 ring-black/5 dark:bg-white/[0.08] dark:ring-white/10">
                {agentName}
              </span>
              <span
                className="truncate"
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
            ref={isMenuOpen ? sessionMenuRef : null}
            className="absolute right-1 flex items-center"
            data-testid={`sidebar-session-menu-root-${s.key}`}
          >
            {s.pinned && (
              <div
                data-testid={`sidebar-session-pin-indicator-${s.key}`}
                className={cn(
                  'pointer-events-none absolute right-0 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-all',
                  isMenuOpen ? 'opacity-0' : 'opacity-100 group-hover:opacity-0',
                )}
              >
                <Pin className="h-3.5 w-3.5 fill-current rotate-45" />
              </div>
            )}
            <button
              aria-label="Session actions"
              data-testid={`sidebar-session-menu-trigger-${s.key}`}
              aria-expanded={isMenuOpen}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpenSessionMenuKey((currentKey) => currentKey === s.key ? null : s.key);
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

            {isMenuOpen && (
              <div className="absolute right-0 top-8 z-20 min-w-[120px] overflow-hidden rounded-xl border border-black/8 bg-white py-1 shadow-[0_12px_28px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-[#12161f]">
                <button
                  type="button"
                  data-testid={`sidebar-session-menu-rename-${s.key}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpenSessionMenuKey(null);
                    startRenamingSession(s.key, sessionLabel);
                  }}
                  className="flex w-full items-center px-3 py-2 text-left text-[13px] text-foreground/85 transition-colors hover:bg-[#eef3fb] dark:hover:bg-white/5"
                >
                  {sessionMenuLabels.rename}
                </button>
                <button
                  type="button"
                  data-testid={`sidebar-session-menu-pin-${s.key}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpenSessionMenuKey(null);
                    void toggleSessionPin(s.key);
                  }}
                  className="flex w-full items-center px-3 py-2 text-left text-[13px] text-foreground/85 transition-colors hover:bg-[#eef3fb] dark:hover:bg-white/5"
                >
                  {s.pinned ? sessionMenuLabels.unpin : sessionMenuLabels.pin}
                </button>
                <button
                  type="button"
                  data-testid={`sidebar-session-menu-delete-${s.key}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpenSessionMenuKey(null);
                    setSessionToDelete({
                      key: s.key,
                      label: sessionLabel,
                    });
                  }}
                  className="flex w-full items-center px-3 py-2 text-left text-[13px] text-destructive transition-colors hover:bg-destructive/10"
                >
                  {t('common:actions.delete')}
                </button>
              </div>
            )}
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

  const navItems = [
    { to: '/dashboard', icon: <LayoutDashboard className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.dashboard'), testId: 'sidebar-nav-dashboard' },
    { to: '/models', icon: <Cpu className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.models'), testId: 'sidebar-nav-models' },
    { to: '/agents', icon: <Bot className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.agents'), testId: 'sidebar-nav-agents' },
    { to: '/channels', icon: <Network className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.channels'), testId: 'sidebar-nav-channels' },
    { to: '/skills', icon: <Puzzle className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.skills'), testId: 'sidebar-nav-skills' },
    { to: '/cron', icon: <Clock className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.cronTasks'), testId: 'sidebar-nav-cron' },
  ];

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'flex shrink-0 flex-col border-r border-black/6 bg-[#f3f6fb] text-foreground/90 transition-all duration-300 dark:bg-background',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Top Header Toggle */}
      <div className={cn("flex items-center px-3 py-3 h-14 border-b border-black/5", sidebarCollapsed ? "justify-center" : "justify-between")}>
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
          className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:bg-white hover:text-foreground dark:hover:bg-white/10"
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
        <button
          data-testid="sidebar-new-chat"
          onClick={() => {
            const { messages } = useChatStore.getState();
            if (messages.length > 0) {
              newSession();
            }
            navigate('/');
          }}
          className={cn(
            'group mb-2 flex w-full items-center gap-2.5 rounded-2xl px-3.5 py-3 text-[14px] font-semibold transition-all duration-200',
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

      {/* Session list — below Settings, only when expanded */}
      {!sidebarCollapsed && sessions.length > 0 && (
        <div className="mt-3 flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-3">
          {pinnedSessions.length > 0 && (
            <div data-testid="sidebar-pinned-sessions">
              <div className="px-3 pb-1 text-[11px] font-medium text-muted-foreground/70 tracking-[0.01em]">
                Pinned
              </div>
              {pinnedSessions.map(renderSessionRow)}
            </div>
          )}
          {unpinnedSessions.length > 0 && (
            <div data-testid="sidebar-session-list">
              {unpinnedSessions.map(renderSessionRow)}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto border-t border-black/5 p-2.5">
        <NavLink
            to="/settings"
            data-testid="sidebar-nav-settings"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-all duration-200',
                'text-foreground/78 hover:bg-[#eef3fb] dark:hover:bg-white/5',
                isActive && 'bg-white text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10',
                sidebarCollapsed ? 'justify-center px-0' : ''
              )
            }
          >
          {({ isActive }) => (
            <>
              <div className={cn("flex shrink-0 items-center justify-center", isActive ? "text-primary" : "text-muted-foreground")}>
                <SettingsIcon className="h-[18px] w-[18px]" strokeWidth={2} />
              </div>
              {!sidebarCollapsed && <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{t('sidebar.settings')}</span>}
            </>
          )}
        </NavLink>

        <Button
          data-testid="sidebar-open-dev-console"
          variant="ghost"
          className={cn(
            'mt-1 flex h-auto w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-all duration-200',
            'text-foreground/78 hover:bg-[#eef3fb] dark:hover:bg-white/5',
            sidebarCollapsed ? 'justify-center px-0' : 'justify-start'
          )}
          onClick={openDevConsole}
        >
          <div className="flex shrink-0 items-center justify-center text-muted-foreground">
            <Terminal className="h-[18px] w-[18px]" strokeWidth={2} />
          </div>
          {!sidebarCollapsed && (
            <>
              <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">{t('common:sidebar.openClawPage')}</span>
              <ExternalLink className="h-3 w-3 shrink-0 ml-auto opacity-50 text-muted-foreground" />
            </>
          )}
        </Button>
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
    </aside>
  );
}
