import { forwardRef, useCallback, type ForwardedRef, type ReactNode, type RefObject } from 'react';
import { Virtuoso, type ContextProp, type ItemProps, type ListProps, type ScrollerProps, type VirtuosoHandle } from 'react-virtuoso';
import { useTranslation } from 'react-i18next';
import { AppLogo } from '@/components/branding/AppLogo';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { CHAT_CONTENT_COLUMN_MAX_WIDTH_CLASS, CHAT_CONTENT_COLUMN_WIDTH_CSS } from './layout';
import type { ChatListItem, ChatVirtuosoContext } from './transcript-types';

const CHAT_SCROLL_TOP_BREATHING_ROOM_PX = 20;

type ChatTranscriptListProps = {
  chatListContext: ChatVirtuosoContext;
  chatListItems: ChatListItem[];
  chatListRef: RefObject<VirtuosoHandle | null>;
  currentSessionKey: string;
  isEmpty: boolean;
  renderItem: (index: number, item: ChatListItem) => ReactNode;
  setScrollContainerNode: (node: HTMLDivElement | null) => void;
  showSessionLoadingState: boolean;
};

function assignForwardedRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

function ChatContentMeasureRail({ horizontalOffsetPx = 0 }: { horizontalOffsetPx?: number }) {
  return (
    <div
      aria-hidden="true"
      data-testid="chat-content-measure-rail"
      className={cn(CHAT_CONTENT_COLUMN_MAX_WIDTH_CLASS, 'pointer-events-none absolute left-0 right-0 top-0 mx-auto h-px min-w-0 opacity-0')}
      style={{
        width: CHAT_CONTENT_COLUMN_WIDTH_CSS,
        transform: horizontalOffsetPx === 0 ? undefined : `translateX(${horizontalOffsetPx}px)`,
      }}
    />
  );
}

const ChatVirtuosoScroller = forwardRef<HTMLDivElement, ScrollerProps & ContextProp<ChatVirtuosoContext>>(
  function ChatVirtuosoScroller({ children, context, style, tabIndex, ...restProps }, ref) {
    const resolvedClassName = (restProps as { className?: string }).className;
    const handleRef = useCallback((node: HTMLDivElement | null) => {
      assignForwardedRef(ref, node);
      context.setScrollElement(node);
    }, [context, ref]);

    return (
      <div
        ref={handleRef}
        tabIndex={tabIndex}
        {...restProps}
        data-testid="chat-scroll-container"
        data-chat-scroll-container="true"
        className={cn('relative flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 pb-8', resolvedClassName)}
        style={{
          ...style,
          overflowAnchor: context.disableOverflowAnchor ? 'none' : style?.overflowAnchor,
          overflowX: 'hidden',
          scrollbarGutter: context.scrollbarGutter ?? 'stable both-edges',
        }}
      >
        <ChatContentMeasureRail horizontalOffsetPx={context.horizontalOffsetPx} />
        {children}
      </div>
    );
  },
);

function ChatVirtuosoHeader() {
  return (
    <div
      aria-hidden="true"
      data-testid="chat-scroll-top-inset"
      style={{ height: `${CHAT_SCROLL_TOP_BREATHING_ROOM_PX}px`, flexShrink: 0 }}
    />
  );
}

const ChatVirtuosoList = forwardRef<HTMLDivElement, ListProps & ContextProp<ChatVirtuosoContext>>(
  function ChatVirtuosoList({ children, context, style, ...restProps }, ref) {
    const resolvedClassName = (restProps as { className?: string }).className;
    return (
      <div
        ref={ref}
        {...restProps}
        data-testid="chat-content-column"
        data-chat-content-column="true"
        className={cn(CHAT_CONTENT_COLUMN_MAX_WIDTH_CLASS, 'mx-auto flex min-w-0 flex-col gap-4', resolvedClassName)}
        style={{
          ...style,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          transform: context.horizontalOffsetPx === 0 ? undefined : `translateX(${context.horizontalOffsetPx}px)`,
          width: CHAT_CONTENT_COLUMN_WIDTH_CSS,
        }}
      >
        {children}
      </div>
    );
  },
);

const ChatVirtuosoItem = forwardRef<HTMLDivElement, ItemProps<ChatListItem> & ContextProp<ChatVirtuosoContext>>(
  function ChatVirtuosoItem({ children, item, style, ...restProps }, ref) {
    return (
      <div
        ref={ref}
        {...restProps}
        data-chat-scroll-anchor="true"
        data-chat-scroll-anchor-key={item.key}
        data-chat-scroll-anchor-type={item.type}
        style={{
          ...style,
          boxSizing: 'border-box',
          marginTop: 0,
          marginLeft: 0,
          marginRight: 0,
          padding: 0,
          width: '100%',
        }}
        className="min-w-0 last:mb-10"
      >
        {children}
      </div>
    );
  },
);

function ChatLoadingTranscript({ setScrollContainerNode }: { setScrollContainerNode: (node: HTMLDivElement | null) => void }) {
  return (
    <div
      ref={setScrollContainerNode}
      data-testid="chat-scroll-container"
      data-chat-scroll-container="true"
      className="flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 pt-5 pb-8"
      style={{ scrollbarGutter: 'stable both-edges' }}
    >
      <div
        data-testid="chat-content-column"
        className={cn(CHAT_CONTENT_COLUMN_MAX_WIDTH_CLASS, 'mx-auto flex min-h-full min-w-0 items-center justify-center')}
        style={{ width: CHAT_CONTENT_COLUMN_WIDTH_CSS }}
      >
        <div data-testid="chat-session-loading" className="bg-background shadow-lg rounded-full border border-border p-2.5">
          <LoadingSpinner size="md" />
        </div>
      </div>
    </div>
  );
}

function ChatEmptyTranscript({ setScrollContainerNode }: { setScrollContainerNode: (node: HTMLDivElement | null) => void }) {
  return (
    <div
      ref={setScrollContainerNode}
      data-testid="chat-scroll-container"
      data-chat-scroll-container="true"
      className="flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 pt-5 pb-8"
      style={{ scrollbarGutter: 'stable both-edges' }}
    >
      <div
        data-testid="chat-content-column"
        className={cn(CHAT_CONTENT_COLUMN_MAX_WIDTH_CLASS, 'mx-auto min-w-0')}
        style={{ width: CHAT_CONTENT_COLUMN_WIDTH_CSS }}
      >
        <WelcomeScreenMinimal />
      </div>
    </div>
  );
}

function WelcomeScreenMinimal() {
  const { t } = useTranslation('chat');

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full px-2">
        <div className="mx-auto max-w-4xl text-center">
          <AppLogo
            testId="chat-welcome-logo"
            className="mx-auto mb-8 h-10 md:mb-10 md:h-12"
          />
          <h1
            data-testid="chat-welcome-title"
            className="text-[34px] font-semibold tracking-[-0.05em] text-foreground md:text-[50px]"
          >
            {t('welcome.subtitle', '把工作交给我，我来持续推进')}
          </h1>
        </div>
      </div>
    </div>
  );
}

export function ChatTranscriptList({
  chatListContext,
  chatListItems,
  chatListRef,
  currentSessionKey,
  isEmpty,
  renderItem,
  setScrollContainerNode,
  showSessionLoadingState,
}: ChatTranscriptListProps) {
  if (showSessionLoadingState) {
    return <ChatLoadingTranscript setScrollContainerNode={setScrollContainerNode} />;
  }

  if (isEmpty) {
    return <ChatEmptyTranscript setScrollContainerNode={setScrollContainerNode} />;
  }

  return (
    <Virtuoso
      ref={chatListRef}
      key={currentSessionKey}
      className="flex-1 min-h-0 min-w-0 overflow-x-hidden"
      style={{ width: '100%' }}
      data={chatListItems}
      increaseViewportBy={{ top: 720, bottom: 360 }}
      context={chatListContext}
      computeItemKey={(_, item) => item.key}
      initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
      components={{
        Header: ChatVirtuosoHeader,
        Scroller: ChatVirtuosoScroller,
        List: ChatVirtuosoList,
        Item: ChatVirtuosoItem,
      }}
      itemContent={renderItem}
    />
  );
}
