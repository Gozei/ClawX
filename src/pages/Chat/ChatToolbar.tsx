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
    <div className="flex items-center gap-2">
      <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-[12px] font-medium text-foreground/80 dark:border-white/10 dark:bg-white/5">
        <Bot className="h-3.5 w-3.5 text-primary" />
        <span>{t('toolbar.currentAgent', { agent: currentAgentName })}</span>
      </div>
      {/* Refresh */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => refresh()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.refresh')}</p>
        </TooltipContent>
      </Tooltip>

      <div className="hidden items-center gap-1 rounded-full border border-black/10 bg-white/70 px-1.5 py-1 dark:border-white/10 dark:bg-white/5 md:flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={() => setChatFontScale(chatFontScale - 5)}
              disabled={chatFontScale <= 85}
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('toolbar.fontSmaller')}</p>
          </TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-1 px-2 text-[12px] font-medium text-foreground/75">
          <Type className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{chatFontScale}%</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={() => setChatFontScale(chatFontScale + 5)}
              disabled={chatFontScale >= 120}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('toolbar.fontLarger')}</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Thinking Toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8',
              showThinking && 'bg-primary/10 text-primary',
            )}
            onClick={toggleThinking}
          >
            <Brain className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
