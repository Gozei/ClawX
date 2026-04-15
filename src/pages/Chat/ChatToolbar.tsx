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

  return (
    <div className="flex items-center gap-2 md:gap-2.5">
      <div className="hidden min-w-0 items-center gap-2 rounded-[10px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.03))] px-3 py-2 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md sm:flex">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/18 bg-primary/10 text-primary">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground/38">
            {t('toolbar.currentAgentLabel', '对话对象')}
          </div>
          <div className="truncate text-[13px] font-semibold text-foreground/88">
            {currentAgentName}
          </div>
        </div>
      </div>

      <div className="hidden items-center gap-1 rounded-[10px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] px-1.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md md:flex">
        <div className="pl-1.5 pr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/34">
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
        <div className="flex min-w-[58px] items-center justify-center gap-1 rounded-md bg-black/[0.04] px-2.5 py-1 text-[12px] font-semibold text-foreground/76 dark:bg-white/[0.04]">
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

      <div className="flex items-center gap-1.5 rounded-[10px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] px-1.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md text-foreground/70 hover:bg-white/8 hover:text-foreground"
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
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-3 py-2 text-[12px] font-semibold transition',
                showThinking
                  ? 'bg-primary/14 text-primary'
                  : 'text-foreground/64 hover:bg-white/8 hover:text-foreground',
              )}
              onClick={toggleThinking}
            >
              <Brain className="h-4 w-4" />
              <span className="hidden lg:inline">
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
