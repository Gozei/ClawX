/**
 * Chat Toolbar
 * Session selector, new session, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { useMemo } from 'react';
import { RefreshCw, Brain, Bot, Type, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export function ChatToolbar() {
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const agents = useAgentsStore((s) => s.agents);
  const chatFontScale = useSettingsStore((s) => s.chatFontScale);
  const setChatFontScale = useSettingsStore((s) => s.setChatFontScale);
  const { t } = useTranslation('chat');
  const currentAgentName = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId)?.name ?? currentAgentId,
    [agents, currentAgentId],
  );
  const toolbarPanelClassName = '';
  const toolbarTextClassName = 'text-[13px] font-semibold leading-none';

  return (
    <div data-testid="chat-toolbar" className="flex h-full w-full items-center justify-between gap-4">
      <div
        data-testid="chat-toolbar-current-agent"
        className="flex min-w-0 items-center gap-2 text-left text-foreground/84"
        title={currentAgentName}
      >
        <Bot className="h-4 w-4 shrink-0 text-primary" />
        <div
          data-testid="chat-toolbar-current-agent-name"
          className={cn(toolbarTextClassName, 'min-w-0 truncate text-foreground/88')}
        >
          {currentAgentName}
        </div>
      </div>

      <div
        data-testid="chat-toolbar-reading"
        className={cn(toolbarPanelClassName, 'hidden h-8 items-center gap-1 px-1.5 md:flex')}
      >
        <div
          data-testid="chat-toolbar-reading-label"
          className={cn(toolbarTextClassName, 'pl-1.5 pr-1 text-foreground/72')}
        >
          {t('toolbar.readingLabel', '阅读')}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md text-foreground/70 hover:bg-white/8 hover:text-foreground"
              onClick={() => setChatFontScale(chatFontScale - 5)}
              disabled={chatFontScale <= 85}
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{t('toolbar.fontSmaller')}</p>
          </TooltipContent>
        </Tooltip>
        <div className="flex h-7 min-w-[64px] items-center justify-center gap-1 rounded-md bg-black/[0.04] px-2.5 text-[13px] font-semibold leading-none text-foreground/76 dark:bg-white/[0.04]">
          <Type className="h-3.5 w-3.5 text-muted-foreground/90" />
          <span>{chatFontScale}%</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md text-foreground/70 hover:bg-white/8 hover:text-foreground"
              onClick={() => setChatFontScale(chatFontScale + 5)}
              disabled={chatFontScale >= 120}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{t('toolbar.fontLarger')}</p>
          </TooltipContent>
        </Tooltip>
      </div>

      <div
        data-testid="chat-toolbar-actions"
        className={cn(toolbarPanelClassName, 'flex h-8 items-center gap-1.5 px-1.5')}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md text-foreground/70 hover:bg-white/8 hover:text-foreground"
              onClick={() => refresh()}
              disabled={loading}
              data-testid="chat-refresh-button"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{t('toolbar.refresh')}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid="chat-thinking-toggle"
              className={cn(
                'inline-flex h-7 items-center gap-2 rounded-md px-3 text-[13px] font-semibold leading-none transition',
                showThinking
                  ? 'bg-primary/14 text-primary'
                  : 'text-foreground/64 hover:bg-white/8 hover:text-foreground',
              )}
              onClick={toggleThinking}
            >
              <Brain className="h-4 w-4" />
              <span data-testid="chat-thinking-label" className="hidden lg:inline">
                {showThinking ? t('toolbar.thinkingOn', '思考已显示') : t('toolbar.thinkingOff', '显示思考')}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
