/* eslint-disable react-hooks/set-state-in-effect -- This controller bridges scroll DOM measurements into React state. */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';

const ACTIVE_TURN_BOTTOM_OFFSET_PX = 16;
const ACTIVE_TURN_TOP_OFFSET_PX = 72;
const ACTIVE_TURN_AUTO_SCROLL_DURATION_MS = 500;
const ACTIVE_TURN_PROGRAMMATIC_SCROLL_GUARD_MS = 80;
const ACTIVE_TURN_NEAR_BOTTOM_THRESHOLD_PX = 48;
const DETACHED_USER_SCROLL_CAPTURE_MS = 450;
const SESSION_ENTRY_BOTTOM_STABILIZE_MS = 400;
const SCROLL_TOP_LOCKED_ANCHOR_TYPES = new Set(['active-turn', 'streaming-final', 'activity', 'typing']);

type ActiveTurnAutoScrollMode = 'idle' | 'follow-active-turn';
type ChatScrollMode = 'following' | 'detached' | 'session-entering';
type ChatScrollEventType = 'follow' | 'detach' | 'session-entry' | 'session-entry-complete' | 'session-reset';
type ChatScrollEventReason =
  | 'initial-mount'
  | 'session-switch'
  | 'session-reset'
  | 'session-entry-complete'
  | 'session-entry-interrupted'
  | 'local-send'
  | 'jump-to-latest'
  | 'user-intent';

type ChatScrollEvent = {
  type: ChatScrollEventType;
  reason: ChatScrollEventReason;
  at: number;
};

type ChatScrollState = {
  mode: ChatScrollMode;
  lastEvent: ChatScrollEventType;
  lastReason: ChatScrollEventReason;
  changedAt: number;
  version: number;
};

type DetachedViewportAnchor = {
  anchorType: 'item' | 'block';
  key: string;
  itemType: string | null;
  blockType: string | null;
  offsetTop: number;
  scrollTop: number;
};

type ChatScrollDebugEvent = {
  at: number;
  type: string;
  mode: ChatScrollMode;
  detail?: Record<string, string | number | boolean | null>;
};

type ChatScrollDebugSnapshot = {
  activeTurnAutoScrollMode: ActiveTurnAutoScrollMode;
  activeTurnScrollKey: string | null;
  activeTurnTailSpacerHeight: number;
  anchor: DetachedViewportAnchor | null;
  detachedScrollTop: number | null;
  distanceFromBottom: number | null;
  hasDetachedNewContent: boolean;
  isAtBottom: boolean;
  mode: ChatScrollMode;
  pendingSessionEntry: boolean;
  programmaticGuardRemainingMs: number;
  sending: boolean;
  sessionKey: string;
  stateVersion: number;
};

type ChatScrollDebugApi = {
  clearEvents: () => void;
  getEvents: () => ChatScrollDebugEvent[];
  getSnapshot: () => ChatScrollDebugSnapshot;
};

declare global {
  interface Window {
    __CLAWX_CHAT_SCROLL_DEBUG__?: ChatScrollDebugApi;
  }
}

const INITIAL_CHAT_SCROLL_STATE: ChatScrollState = {
  mode: 'following',
  lastEvent: 'follow',
  lastReason: 'initial-mount',
  changedAt: 0,
  version: 0,
};

const CHAT_SCROLL_TRANSITION_TABLE: Record<ChatScrollMode, Record<ChatScrollEventType, ChatScrollMode>> = {
  following: {
    detach: 'detached',
    follow: 'following',
    'session-entry': 'session-entering',
    'session-entry-complete': 'following',
    'session-reset': 'following',
  },
  detached: {
    detach: 'detached',
    follow: 'following',
    'session-entry': 'session-entering',
    'session-entry-complete': 'detached',
    'session-reset': 'following',
  },
  'session-entering': {
    detach: 'detached',
    follow: 'following',
    'session-entry': 'session-entering',
    'session-entry-complete': 'following',
    'session-reset': 'following',
  },
};

function reduceChatScrollState(state: ChatScrollState, event: ChatScrollEvent): ChatScrollState {
  const nextMode = CHAT_SCROLL_TRANSITION_TABLE[state.mode][event.type];
  if (state.mode === nextMode && state.lastEvent === event.type && state.lastReason === event.reason) {
    return state;
  }

  return {
    mode: nextMode,
    lastEvent: event.type,
    lastReason: event.reason,
    changedAt: event.at,
    version: state.version + 1,
  };
}

function hashDebugValue(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `h:${(hash >>> 0).toString(36)}`;
}

function sanitizeDebugAnchor(anchor: DetachedViewportAnchor | null): DetachedViewportAnchor | null {
  if (!anchor) return null;
  return {
    ...anchor,
    key: hashDebugValue(anchor.key),
  };
}

type UseChatScrollControllerParams = {
  activeTurnScrollKey: string | null;
  chatListItemCount: number;
  currentSessionKey: string;
  isEmpty: boolean;
  latestTranscriptActivitySignature: string;
  loading: boolean;
  sending: boolean;
  showSessionLoadingState: boolean;
};

type ComposerShellPadding = {
  left: number;
  right: number;
};

export function useChatScrollController({
  activeTurnScrollKey,
  chatListItemCount,
  currentSessionKey,
  isEmpty,
  latestTranscriptActivitySignature,
  loading,
  sending,
  showSessionLoadingState,
}: UseChatScrollControllerParams) {
  const [scrollState, dispatchScrollState] = useReducer(reduceChatScrollState, INITIAL_CHAT_SCROLL_STATE);
  const scrollStateRef = useRef<ChatScrollState>(scrollState);
  const debugEventsRef = useRef<ChatScrollDebugEvent[]>([]);
  const chatListRef = useRef<VirtuosoHandle | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const activeTurnViewportAnchorRef = useRef<HTMLDivElement | null>(null);
  const activeTurnAutoScrollModeRef = useRef<ActiveTurnAutoScrollMode>('idle');
  const activeTurnTrackedTurnKeyRef = useRef<string | null>(null);
  const suppressedAutoFollowTurnKeyRef = useRef<string | null>(null);
  const pendingLocalSendFollowBottomRef = useRef(false);
  const pendingSessionEntryBottomRef = useRef(false);
  const pendingSessionEntryUserInterruptedRef = useRef(false);
  const previousSessionKeyRef = useRef(currentSessionKey);
  const hasMountedSessionRef = useRef(false);
  const activeTurnAutoScrollTargetRef = useRef(0);
  const activeTurnAutoScrollFrameRef = useRef<number | null>(null);
  const activeTurnAutoScrollAnimationRef = useRef<{ startTop: number; targetTop: number; startedAt: number } | null>(null);
  const bottomStateProgrammaticGuardUntilRef = useRef(0);
  const detachedViewportAnchorRef = useRef<DetachedViewportAnchor | null>(null);
  const detachedViewportScrollTopRef = useRef<number | null>(null);
  const detachedViewportSignatureRef = useRef<string | null>(null);
  const latestTranscriptActivitySignatureRef = useRef<string | null>(null);
  const pendingSessionEntryPositionedAtRef = useRef<number | null>(null);
  const isAtBottomRef = useRef(true);
  const userScrollIntentUntilRef = useRef(0);
  const detachedViewportRefreshUntilRef = useRef(0);
  const [activeTurnUserInterruptVersion, setActiveTurnUserInterruptVersion] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasDetachedNewContent, setHasDetachedNewContent] = useState(false);
  const [activeTurnTailSpacerHeight, setActiveTurnTailSpacerHeight] = useState(0);
  const [composerShellPadding, setComposerShellPadding] = useState<ComposerShellPadding>({ left: 16, right: 16 });
  const [scrollContainerNode, setScrollContainerNodeState] = useState<HTMLDivElement | null>(null);
  const [contentColumnHorizontalOffsetPx, setContentColumnHorizontalOffsetPx] = useState(0);

  useLayoutEffect(() => {
    scrollStateRef.current = scrollState;
  }, [scrollState]);

  const appendDebugEvent = useCallback((event: Omit<ChatScrollDebugEvent, 'at' | 'mode'>) => {
    const nextEvent: ChatScrollDebugEvent = {
      ...event,
      at: performance.now(),
      mode: scrollStateRef.current.mode,
    };
    debugEventsRef.current = [...debugEventsRef.current.slice(-79), nextEvent];
  }, []);
  const isFollowingLatest = useCallback(() => scrollStateRef.current.mode !== 'detached', []);
  const dispatchScrollModeEvent = useCallback((
    type: ChatScrollEventType,
    reason: ChatScrollEventReason,
  ) => {
    const event: ChatScrollEvent = {
      type,
      reason,
      at: performance.now(),
    };
    const nextState = reduceChatScrollState(scrollStateRef.current, event);
    scrollStateRef.current = nextState;
    appendDebugEvent({
      type: 'transition',
      detail: {
        event: type,
        nextMode: nextState.mode,
        reason,
      },
    });
    dispatchScrollState(event);
  }, [appendDebugEvent]);
  const clearDetachedViewport = useCallback(() => {
    detachedViewportAnchorRef.current = null;
    detachedViewportScrollTopRef.current = null;
    detachedViewportRefreshUntilRef.current = 0;
    userScrollIntentUntilRef.current = 0;
    setHasDetachedNewContent(false);
  }, []);
  const setScrollContainerNode = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node;
    setScrollContainerNodeState((current) => (current === node ? current : node));
  }, []);
  const beginPendingSessionEntryBottom = useCallback(() => {
    dispatchScrollModeEvent('session-entry', 'session-switch');
    clearDetachedViewport();
    pendingSessionEntryBottomRef.current = true;
    pendingSessionEntryUserInterruptedRef.current = false;
    pendingSessionEntryPositionedAtRef.current = null;
  }, [clearDetachedViewport, dispatchScrollModeEvent]);
  const cancelPendingSessionEntryBottom = useCallback((interrupted = false) => {
    pendingSessionEntryBottomRef.current = false;
    pendingSessionEntryUserInterruptedRef.current = interrupted;
    pendingSessionEntryPositionedAtRef.current = null;
    if (interrupted) {
      dispatchScrollModeEvent('detach', 'session-entry-interrupted');
      return;
    }
    if (scrollStateRef.current.mode === 'session-entering') {
      dispatchScrollModeEvent('session-entry-complete', 'session-entry-complete');
    }
  }, [dispatchScrollModeEvent]);
  const captureSemanticAnchor = useCallback(() => {
    const scrollElement = scrollContainerRef.current;
    if (!scrollElement) return null;

    const scrollRect = scrollElement.getBoundingClientRect();
    const anchorElements = Array.from(
      scrollElement.querySelectorAll<HTMLElement>('[data-chat-scroll-block-anchor-key],[data-chat-scroll-anchor-key]'),
    );
    const topBoundary = scrollRect.top + 24;
    const bottomBoundary = scrollRect.bottom;
    const anchorElement = anchorElements.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom >= topBoundary && rect.top <= bottomBoundary;
    }) ?? anchorElements.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom >= scrollRect.top && rect.top <= bottomBoundary;
    });
    const key = anchorElement?.dataset.chatScrollBlockAnchorKey ?? anchorElement?.dataset.chatScrollAnchorKey;
    if (!anchorElement || !key) return null;
    const itemAnchorElement = anchorElement.closest<HTMLElement>('[data-chat-scroll-anchor-key]');

    const anchor: DetachedViewportAnchor = {
      anchorType: anchorElement.dataset.chatScrollBlockAnchorKey ? 'block' : 'item',
      key,
      itemType: anchorElement.dataset.chatScrollAnchorType ?? itemAnchorElement?.dataset.chatScrollAnchorType ?? null,
      blockType: anchorElement.dataset.chatScrollBlockAnchorType ?? null,
      offsetTop: anchorElement.getBoundingClientRect().top - scrollRect.top,
      scrollTop: scrollElement.scrollTop,
    };
    detachedViewportAnchorRef.current = anchor;
    appendDebugEvent({
      type: 'anchor-captured',
      detail: {
        anchorType: anchor.anchorType,
        blockType: anchor.blockType,
        itemType: anchor.itemType,
      },
    });
    return anchor;
  }, [appendDebugEvent]);
  const captureDetachedViewport = useCallback(() => {
    const scrollElement = scrollContainerRef.current;
    if (!scrollElement) return;
    captureSemanticAnchor();
    detachedViewportScrollTopRef.current = scrollElement.scrollTop;
  }, [captureSemanticAnchor]);
  const resumeFollowingLatest = useCallback((reason: ChatScrollEventReason = 'local-send') => {
    dispatchScrollModeEvent('follow', reason);
    clearDetachedViewport();
  }, [clearDetachedViewport, dispatchScrollModeEvent]);
  const pauseFollowingLatest = useCallback(() => {
    dispatchScrollModeEvent('detach', 'user-intent');
    captureDetachedViewport();
  }, [captureDetachedViewport, dispatchScrollModeEvent]);
  const markProgrammaticScroll = useCallback((guardMs = ACTIVE_TURN_PROGRAMMATIC_SCROLL_GUARD_MS) => {
    const nextGuardUntil = performance.now() + guardMs;
    bottomStateProgrammaticGuardUntilRef.current = Math.max(
      bottomStateProgrammaticGuardUntilRef.current,
      nextGuardUntil,
    );
  }, []);
  const restoreDetachedViewport = useCallback(() => {
    const scrollElement = scrollContainerRef.current;
    if (!scrollElement) return;

    const clampScrollTop = (scrollTop: number) => Math.min(
      Math.max(0, scrollTop),
      Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight),
    );
    const applyScrollTopLock = (scrollTop: number) => {
      const nextScrollTop = clampScrollTop(scrollTop);
      if (Math.abs(scrollElement.scrollTop - nextScrollTop) > 1) {
        markProgrammaticScroll();
        scrollElement.scrollTop = nextScrollTop;
      }
      detachedViewportScrollTopRef.current = nextScrollTop;
      if (detachedViewportAnchorRef.current) {
        detachedViewportAnchorRef.current = {
          ...detachedViewportAnchorRef.current,
          scrollTop: nextScrollTop,
        };
      }
      return nextScrollTop;
    };
    const semanticAnchor = detachedViewportAnchorRef.current;
    const restoreLockedScrollTop = (strategy: string) => {
      const lockedScrollTop = detachedViewportScrollTopRef.current;
      if (lockedScrollTop == null) return false;
      applyScrollTopLock(lockedScrollTop);
      appendDebugEvent({
        type: 'detached-restored',
        detail: {
          anchorType: semanticAnchor?.anchorType ?? null,
          blockType: semanticAnchor?.blockType ?? null,
          strategy,
        },
      });
      return true;
    };
    if (sending && restoreLockedScrollTop('sending-lock')) return;
    if (semanticAnchor && SCROLL_TOP_LOCKED_ANCHOR_TYPES.has(semanticAnchor.itemType ?? '')) {
      if (restoreLockedScrollTop('item-lock')) return;
    }
    if (semanticAnchor) {
      const scrollRect = scrollElement.getBoundingClientRect();
      const anchorElement = Array.from(
        scrollElement.querySelectorAll<HTMLElement>(
          semanticAnchor.anchorType === 'block'
            ? '[data-chat-scroll-block-anchor-key]'
            : '[data-chat-scroll-anchor-key]',
        ),
      ).find((element) => (
        semanticAnchor.anchorType === 'block'
          ? element.dataset.chatScrollBlockAnchorKey === semanticAnchor.key
          : element.dataset.chatScrollAnchorKey === semanticAnchor.key
      ));
      if (anchorElement) {
        const currentOffsetTop = anchorElement.getBoundingClientRect().top - scrollRect.top;
        const nextScrollTop = applyScrollTopLock(scrollElement.scrollTop + currentOffsetTop - semanticAnchor.offsetTop);
        detachedViewportAnchorRef.current = {
          ...semanticAnchor,
          scrollTop: nextScrollTop,
        };
        appendDebugEvent({
          type: 'detached-restored',
          detail: {
            anchorType: semanticAnchor.anchorType,
            blockType: semanticAnchor.blockType,
            strategy: 'semantic',
          },
        });
        return;
      }
    }

    if (restoreLockedScrollTop('scroll-top')) return;
    appendDebugEvent({
      type: 'detached-restored',
      detail: {
        anchorType: semanticAnchor?.anchorType ?? null,
        blockType: semanticAnchor?.blockType ?? null,
        strategy: 'missing-scroll-top',
      },
    });
  }, [appendDebugEvent, markProgrammaticScroll, sending]);
  const getDistanceFromBottom = useCallback(() => {
    const scrollElement = scrollContainerRef.current;
    if (!scrollElement) return null;
    return scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop;
  }, []);
  const syncBottomState = useCallback((distanceOverride?: number | null) => {
    const distanceFromBottom = distanceOverride ?? getDistanceFromBottom();
    const nextAtBottom = distanceFromBottom == null
      || distanceFromBottom <= ACTIVE_TURN_NEAR_BOTTOM_THRESHOLD_PX;
    isAtBottomRef.current = nextAtBottom;
    setIsAtBottom((current) => (current === nextAtBottom ? current : nextAtBottom));
    if (nextAtBottom) {
      setHasDetachedNewContent(false);
    }
    return nextAtBottom;
  }, [getDistanceFromBottom]);
  const isScrollNearBottom = useCallback(() => {
    const distanceFromBottom = getDistanceFromBottom();
    return distanceFromBottom != null && distanceFromBottom <= ACTIVE_TURN_NEAR_BOTTOM_THRESHOLD_PX;
  }, [getDistanceFromBottom]);
  const positionScrollNearBottom = useCallback((bottomOffsetPx: number) => {
    const scrollElement = scrollContainerRef.current;
    if (!scrollElement) return;
    markProgrammaticScroll();
    scrollElement.scrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight - bottomOffsetPx);
  }, [markProgrammaticScroll]);
  const getActiveTurnTargetScrollTop = useCallback((scrollElement: HTMLDivElement) => {
    const activeTurnAnchor = activeTurnViewportAnchorRef.current;
    if (!activeTurnAnchor) {
      return Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight - ACTIVE_TURN_BOTTOM_OFFSET_PX);
    }

    const scrollRect = scrollElement.getBoundingClientRect();
    const anchorTop = activeTurnAnchor.getBoundingClientRect().top - scrollRect.top;
    const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    const targetScrollTop = scrollElement.scrollTop + anchorTop - ACTIVE_TURN_TOP_OFFSET_PX;
    return Math.min(Math.max(0, targetScrollTop), maxScrollTop);
  }, []);
  const getDebugSnapshot = useCallback((): ChatScrollDebugSnapshot => {
    const anchor = detachedViewportAnchorRef.current;
    return {
      activeTurnAutoScrollMode: activeTurnAutoScrollModeRef.current,
      activeTurnScrollKey: activeTurnScrollKey ? hashDebugValue(activeTurnScrollKey) : null,
      activeTurnTailSpacerHeight,
      anchor: sanitizeDebugAnchor(anchor),
      detachedScrollTop: detachedViewportScrollTopRef.current,
      distanceFromBottom: getDistanceFromBottom(),
      hasDetachedNewContent,
      isAtBottom,
      mode: scrollStateRef.current.mode,
      pendingSessionEntry: pendingSessionEntryBottomRef.current,
      programmaticGuardRemainingMs: Math.max(0, bottomStateProgrammaticGuardUntilRef.current - performance.now()),
      sending,
      sessionKey: currentSessionKey,
      stateVersion: scrollStateRef.current.version,
    };
  }, [activeTurnScrollKey, activeTurnTailSpacerHeight, currentSessionKey, getDistanceFromBottom, hasDetachedNewContent, isAtBottom, sending]);

  useEffect(() => {
    const debugApi: ChatScrollDebugApi = {
      clearEvents: () => {
        debugEventsRef.current = [];
      },
      getEvents: () => [...debugEventsRef.current],
      getSnapshot: getDebugSnapshot,
    };
    window.__CLAWX_CHAT_SCROLL_DEBUG__ = debugApi;
    return () => {
      if (window.__CLAWX_CHAT_SCROLL_DEBUG__ === debugApi) {
        delete window.__CLAWX_CHAT_SCROLL_DEBUG__;
      }
    };
  }, [getDebugSnapshot]);

  useEffect(() => {
    const scrollElement = scrollContainerNode;
    if (!scrollElement) return;

    const interruptPendingEntry = () => {
      if (!pendingSessionEntryBottomRef.current) return;
      cancelPendingSessionEntryBottom(true);
    };
    const handleKeyboardInterrupt = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Space'].includes(event.code)) return;
      interruptPendingEntry();
    };

    scrollElement.addEventListener('wheel', interruptPendingEntry, { passive: true });
    scrollElement.addEventListener('touchmove', interruptPendingEntry, { passive: true });
    scrollElement.addEventListener('keydown', handleKeyboardInterrupt);

    return () => {
      scrollElement.removeEventListener('wheel', interruptPendingEntry);
      scrollElement.removeEventListener('touchmove', interruptPendingEntry);
      scrollElement.removeEventListener('keydown', handleKeyboardInterrupt);
    };
  }, [cancelPendingSessionEntryBottom, scrollContainerNode]);

  useEffect(() => {
    latestTranscriptActivitySignatureRef.current = null;
    detachedViewportSignatureRef.current = null;
    cancelPendingSessionEntryBottom();
    dispatchScrollModeEvent('session-reset', 'session-reset');
    clearDetachedViewport();
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  }, [cancelPendingSessionEntryBottom, clearDetachedViewport, currentSessionKey, dispatchScrollModeEvent]);

  useLayoutEffect(() => {
    syncBottomState();
  }, [scrollContainerNode, syncBottomState]);

  useEffect(() => {
    const scrollElement = scrollContainerNode;
    if (!scrollElement) return;

    let frameId = 0;
    let resizeObserver: ResizeObserver | null = null;

    const scheduleSync = (refreshDetachedViewport = false) => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const now = performance.now();
        if (
          isFollowingLatest()
          && now < bottomStateProgrammaticGuardUntilRef.current
          && isAtBottomRef.current
        ) {
          syncBottomState(0);
          return;
        }
        syncBottomState();
        if (
          !isFollowingLatest()
          && now >= bottomStateProgrammaticGuardUntilRef.current
          && refreshDetachedViewport
          && now <= detachedViewportRefreshUntilRef.current
        ) {
          captureSemanticAnchor();
          detachedViewportScrollTopRef.current = scrollElement.scrollTop;
        }
      });
    };
    const handleScroll = () => {
      scheduleSync(true);
    };

    scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    scheduleSync(false);

    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => {
        scheduleSync(false);
      });
      resizeObserver.observe(scrollElement);
      const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
      if (contentColumn) {
        resizeObserver.observe(contentColumn);
      }
    }

    return () => {
      cancelAnimationFrame(frameId);
      scrollElement.removeEventListener('scroll', handleScroll);
      resizeObserver?.disconnect();
    };
  }, [captureSemanticAnchor, currentSessionKey, isFollowingLatest, scrollContainerNode, syncBottomState]);

  useLayoutEffect(() => {
    if (!pendingSessionEntryBottomRef.current) return;
    if (pendingSessionEntryUserInterruptedRef.current) {
      cancelPendingSessionEntryBottom();
      return;
    }
    if (sending && activeTurnScrollKey) {
      const shouldKeepFollowing = isScrollNearBottom();
      pendingLocalSendFollowBottomRef.current = shouldKeepFollowing;
      cancelPendingSessionEntryBottom(!shouldKeepFollowing);
      return;
    }
    if (loading || chatListItemCount === 0) return;

    let frame1 = 0;
    let frame2 = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelFrames = () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
    const completeSessionEntryBottom = () => {
      cancelPendingSessionEntryBottom();
      cancelFrames();
      if (settleTimer != null) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
    };
    const scheduleCompletion = () => {
      if (settleTimer != null) {
        clearTimeout(settleTimer);
      }
      const positionedAt = pendingSessionEntryPositionedAtRef.current ?? performance.now();
      pendingSessionEntryPositionedAtRef.current = positionedAt;
      const remainingMs = Math.max(0, SESSION_ENTRY_BOTTOM_STABILIZE_MS - (performance.now() - positionedAt));
      settleTimer = setTimeout(() => {
        completeSessionEntryBottom();
      }, remainingMs);
    };
    const applySessionEntryBottom = () => {
      if (!pendingSessionEntryBottomRef.current) return;
      if (pendingSessionEntryUserInterruptedRef.current) {
        completeSessionEntryBottom();
        return;
      }

      cancelFrames();
      markProgrammaticScroll(SESSION_ENTRY_BOTTOM_STABILIZE_MS + ACTIVE_TURN_PROGRAMMATIC_SCROLL_GUARD_MS);
      frame1 = requestAnimationFrame(() => {
        frame2 = requestAnimationFrame(() => {
          if (!pendingSessionEntryBottomRef.current) return;
          if (pendingSessionEntryUserInterruptedRef.current) {
            completeSessionEntryBottom();
            return;
          }
          positionScrollNearBottom(ACTIVE_TURN_BOTTOM_OFFSET_PX);
          syncBottomState(0);
        });
      });
      scheduleCompletion();
    };

    applySessionEntryBottom();

    return () => {
      cancelFrames();
      if (settleTimer != null) {
        clearTimeout(settleTimer);
      }
    };
  }, [
    activeTurnScrollKey,
    cancelPendingSessionEntryBottom,
    chatListItemCount,
    isScrollNearBottom,
    loading,
    markProgrammaticScroll,
    positionScrollNearBottom,
    sending,
    syncBottomState,
  ]);

  useLayoutEffect(() => {
    const scrollElement = scrollContainerNode;
    if (!scrollElement) {
      setContentColumnHorizontalOffsetPx(0);
      return;
    }

    const updateHorizontalOffset = () => {
      const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
      if (!contentColumn) {
        setContentColumnHorizontalOffsetPx(0);
        return;
      }

      const scrollRect = scrollElement.getBoundingClientRect();
      const contentRect = contentColumn.getBoundingClientRect();
      const actualLeft = contentRect.left - scrollRect.left;
      const expectedLeft = (scrollRect.width - contentRect.width) / 2;
      const drift = expectedLeft - actualLeft;
      setContentColumnHorizontalOffsetPx((current) => {
        const nextOffset = Math.round(current + drift);
        return current === nextOffset ? current : nextOffset;
      });
    };

    updateHorizontalOffset();

    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', updateHorizontalOffset);
      return () => {
        window.removeEventListener('resize', updateHorizontalOffset);
      };
    }

    const observer = new ResizeObserver(() => {
      updateHorizontalOffset();
    });
    observer.observe(scrollElement);
    const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
    if (contentColumn) {
      observer.observe(contentColumn);
    }

    return () => {
      observer.disconnect();
    };
  }, [chatListItemCount, currentSessionKey, loading, scrollContainerNode, sending]);

  useLayoutEffect(() => {
    const scrollElement = scrollContainerNode;
    if (!scrollElement) {
      setComposerShellPadding({ left: 16, right: 16 });
      return;
    }

    const updatePadding = () => {
      const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
      if (!contentColumn) {
        setComposerShellPadding({ left: 16, right: 16 });
        return;
      }

      const scrollRect = scrollElement.getBoundingClientRect();
      const contentRect = contentColumn.getBoundingClientRect();
      const nextLeft = Math.max(16, Math.round(contentRect.left - scrollRect.left));
      const nextRight = Math.max(16, Math.round(scrollRect.right - contentRect.right));
      setComposerShellPadding((current) => (
        current.left === nextLeft && current.right === nextRight
          ? current
          : { left: nextLeft, right: nextRight }
      ));
    };

    updatePadding();

    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', updatePadding);
      return () => {
        window.removeEventListener('resize', updatePadding);
      };
    }

    const observer = new ResizeObserver(() => {
      updatePadding();
    });
    observer.observe(scrollElement);
    const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
    if (contentColumn) {
      observer.observe(contentColumn);
    }
    return () => {
      observer.disconnect();
    };
  }, [contentColumnHorizontalOffsetPx, currentSessionKey, chatListItemCount, loading, scrollContainerNode, sending]);

  useLayoutEffect(() => {
    const scrollElement = scrollContainerNode;
    if (!scrollElement || !sending || !activeTurnScrollKey) {
      setActiveTurnTailSpacerHeight((current) => (current === 0 ? current : 0));
      return;
    }

    let frameId = 0;
    let observer: ResizeObserver | null = null;
    let resizeFallbackAttached = false;

    const updateSpacerHeight = () => {
      const activeTurnAnchor = activeTurnViewportAnchorRef.current;
      if (!activeTurnAnchor) {
        frameId = requestAnimationFrame(updateSpacerHeight);
        return;
      }

      const anchorHeight = activeTurnAnchor.getBoundingClientRect().height;
      const nextHeight = Math.max(
        0,
        Math.round(scrollElement.clientHeight - ACTIVE_TURN_TOP_OFFSET_PX - anchorHeight - ACTIVE_TURN_BOTTOM_OFFSET_PX),
      );
      setActiveTurnTailSpacerHeight((current) => (current === nextHeight ? current : nextHeight));

      if (typeof ResizeObserver !== 'function') {
        if (!resizeFallbackAttached) {
          resizeFallbackAttached = true;
          window.addEventListener('resize', updateSpacerHeight);
        }
        return;
      }

      if (!observer) {
        observer = new ResizeObserver(() => {
          updateSpacerHeight();
        });
        observer.observe(scrollElement);
        observer.observe(activeTurnAnchor);
      }
    };

    updateSpacerHeight();

    return () => {
      cancelAnimationFrame(frameId);
      observer?.disconnect();
      if (resizeFallbackAttached) {
        window.removeEventListener('resize', updateSpacerHeight);
      }
    };
  }, [activeTurnScrollKey, chatListItemCount, scrollContainerNode, sending]);

  useLayoutEffect(() => {
    if (showSessionLoadingState || isEmpty || !scrollContainerRef.current) return;
    if (pendingSessionEntryBottomRef.current) return;
    if (sending && activeTurnScrollKey) return;
    if (!isFollowingLatest()) return;
    if (!isAtBottomRef.current) return;

    let frameId = 0;
    frameId = requestAnimationFrame(() => {
      positionScrollNearBottom(ACTIVE_TURN_BOTTOM_OFFSET_PX);
      syncBottomState(0);
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [
    activeTurnScrollKey,
    isEmpty,
    isFollowingLatest,
    latestTranscriptActivitySignature,
    positionScrollNearBottom,
    sending,
    showSessionLoadingState,
    syncBottomState,
  ]);

  useLayoutEffect(() => {
    const previousSignature = detachedViewportSignatureRef.current;
    detachedViewportSignatureRef.current = latestTranscriptActivitySignature;

    if (previousSignature == null || previousSignature === latestTranscriptActivitySignature) return;
    if (isFollowingLatest()) return;
    if (performance.now() < userScrollIntentUntilRef.current) return;

    if (sending) {
      syncBottomState();
      return;
    }

    const scrollElement = scrollContainerRef.current;
    if (!scrollElement) return;

    restoreDetachedViewport();
    syncBottomState();
  }, [isFollowingLatest, latestTranscriptActivitySignature, restoreDetachedViewport, sending, syncBottomState]);

  useEffect(() => {
    const previousSignature = latestTranscriptActivitySignatureRef.current;
    latestTranscriptActivitySignatureRef.current = latestTranscriptActivitySignature;

    if (previousSignature == null || previousSignature === latestTranscriptActivitySignature) {
      return;
    }

    if (isFollowingLatest() || isScrollNearBottom()) {
      setHasDetachedNewContent(false);
      return;
    }

    setHasDetachedNewContent(true);
  }, [isFollowingLatest, isScrollNearBottom, latestTranscriptActivitySignature]);

  const handleActiveTurnUserInterrupt = useCallback(() => {
    if (activeTurnScrollKey) {
      suppressedAutoFollowTurnKeyRef.current = activeTurnScrollKey;
    }
    pauseFollowingLatest();
    activeTurnAutoScrollModeRef.current = 'idle';
    activeTurnAutoScrollTargetRef.current = 0;
    activeTurnAutoScrollAnimationRef.current = null;
    setActiveTurnUserInterruptVersion((value) => value + 1);
  }, [activeTurnScrollKey, pauseFollowingLatest]);

  useLayoutEffect(() => {
    const scrollElement = scrollContainerNode;
    if (!scrollElement || !sending || !activeTurnScrollKey) return;

    const releaseFollowForUserIntent = (refreshDetachedViewport: boolean) => {
      if (refreshDetachedViewport) {
        const refreshUntil = performance.now() + DETACHED_USER_SCROLL_CAPTURE_MS;
        userScrollIntentUntilRef.current = refreshUntil;
        detachedViewportRefreshUntilRef.current = refreshUntil;
      } else {
        userScrollIntentUntilRef.current = 0;
        detachedViewportRefreshUntilRef.current = 0;
      }
      if (!isFollowingLatest()) return;
      captureDetachedViewport();
      handleActiveTurnUserInterrupt();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      const target = event.target;
      if (!(target instanceof Node)) return;

      const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
      if (contentColumn?.contains(target)) {
        releaseFollowForUserIntent(false);
      }
    };
    const handleKeyboardInterrupt = (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'PageUp' || event.key === 'PageDown' || event.key === 'Home' || event.key === 'End' || event.key === ' ') {
        releaseFollowForUserIntent(true);
      }
    };

    scrollElement.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });
    const handleWheel = () => releaseFollowForUserIntent(true);
    const handleTouchMove = () => releaseFollowForUserIntent(true);
    scrollElement.addEventListener('wheel', handleWheel, { capture: true, passive: true });
    scrollElement.addEventListener('touchmove', handleTouchMove, { capture: true, passive: true });
    scrollElement.addEventListener('keydown', handleKeyboardInterrupt, { capture: true });

    return () => {
      scrollElement.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      scrollElement.removeEventListener('wheel', handleWheel, { capture: true });
      scrollElement.removeEventListener('touchmove', handleTouchMove, { capture: true });
      scrollElement.removeEventListener('keydown', handleKeyboardInterrupt, { capture: true });
    };
  }, [activeTurnScrollKey, captureDetachedViewport, handleActiveTurnUserInterrupt, isFollowingLatest, scrollContainerNode, sending]);

  useEffect(() => {
    if (!hasMountedSessionRef.current) {
      hasMountedSessionRef.current = true;
      previousSessionKeyRef.current = currentSessionKey;
      pendingSessionEntryUserInterruptedRef.current = false;
      if (sending && activeTurnScrollKey) {
        pendingLocalSendFollowBottomRef.current = true;
        resumeFollowingLatest('local-send');
      } else {
        beginPendingSessionEntryBottom();
      }
      return;
    }

    if (previousSessionKeyRef.current === currentSessionKey) {
      return;
    }

    previousSessionKeyRef.current = currentSessionKey;
    pendingSessionEntryUserInterruptedRef.current = false;
    if (sending && activeTurnScrollKey) {
      cancelPendingSessionEntryBottom();
      pendingLocalSendFollowBottomRef.current = true;
      resumeFollowingLatest('local-send');
    } else {
      beginPendingSessionEntryBottom();
    }
    activeTurnAutoScrollModeRef.current = 'idle';
    activeTurnTrackedTurnKeyRef.current = null;
    suppressedAutoFollowTurnKeyRef.current = null;
    setActiveTurnUserInterruptVersion((value) => value + 1);
  }, [
    activeTurnScrollKey,
    beginPendingSessionEntryBottom,
    cancelPendingSessionEntryBottom,
    currentSessionKey,
    resumeFollowingLatest,
    sending,
  ]);

  useEffect(() => {
    if (!sending || !activeTurnScrollKey) {
      if (!sending) {
        pendingLocalSendFollowBottomRef.current = false;
        suppressedAutoFollowTurnKeyRef.current = null;
        activeTurnAutoScrollModeRef.current = 'idle';
        activeTurnTrackedTurnKeyRef.current = activeTurnScrollKey;
      }
      return;
    }

    cancelPendingSessionEntryBottom();

    if (suppressedAutoFollowTurnKeyRef.current === activeTurnScrollKey) {
      pendingLocalSendFollowBottomRef.current = false;
      return;
    }

    const turnChanged = activeTurnTrackedTurnKeyRef.current !== activeTurnScrollKey;
    const shouldFollowActiveTurn = pendingLocalSendFollowBottomRef.current || (isFollowingLatest() && isScrollNearBottom());
    const nextMode: ActiveTurnAutoScrollMode = shouldFollowActiveTurn ? 'follow-active-turn' : 'idle';
    const modeChanged = activeTurnAutoScrollModeRef.current !== nextMode;
    if (!turnChanged && !modeChanged) {
      pendingLocalSendFollowBottomRef.current = false;
      return;
    }

    activeTurnTrackedTurnKeyRef.current = activeTurnScrollKey;
    activeTurnAutoScrollModeRef.current = nextMode;
    pendingLocalSendFollowBottomRef.current = false;
    if (nextMode === 'idle') {
      activeTurnAutoScrollTargetRef.current = 0;
      activeTurnAutoScrollAnimationRef.current = null;
    }
    setActiveTurnUserInterruptVersion((value) => value + 1);
  }, [activeTurnScrollKey, cancelPendingSessionEntryBottom, currentSessionKey, isFollowingLatest, isScrollNearBottom, sending]);

  useEffect(() => {
    const autoScrollMode = activeTurnAutoScrollModeRef.current;
    if (!sending || !activeTurnScrollKey || autoScrollMode === 'idle') return;
    if (suppressedAutoFollowTurnKeyRef.current === activeTurnScrollKey) return;

    let readinessFrame = 0;
    let frame1 = 0;
    let resizeObserver: ResizeObserver | null = null;
    let releasedByUser = false;
    let ignoreScrollEventsUntil = 0;
    let pointerScrollIntentActive = false;
    let attachedScrollElement: HTMLDivElement | null = null;

    const cancelAutoScrollFrame = () => {
      if (activeTurnAutoScrollFrameRef.current != null) {
        cancelAnimationFrame(activeTurnAutoScrollFrameRef.current);
        activeTurnAutoScrollFrameRef.current = null;
      }
    };
    const applyProgrammaticScroll = (nextScrollTop: number) => {
      ignoreScrollEventsUntil = performance.now() + ACTIVE_TURN_PROGRAMMATIC_SCROLL_GUARD_MS;
      const scrollElement = scrollContainerRef.current;
      if (!scrollElement) return;
      scrollElement.scrollTop = nextScrollTop;
    };
    const easeOutCubic = (progress: number) => (1 - ((1 - progress) ** 3));
    const stepAutoScroll = (timestamp: number) => {
      activeTurnAutoScrollFrameRef.current = null;
      if (releasedByUser) return;

      const animation = activeTurnAutoScrollAnimationRef.current;
      const scrollElement = scrollContainerRef.current;
      if (!scrollElement) return;
      if (!animation) return;

      const progress = Math.min(1, (timestamp - animation.startedAt) / ACTIVE_TURN_AUTO_SCROLL_DURATION_MS);
      const easedProgress = easeOutCubic(progress);
      const nextScrollTop = animation.startTop + ((animation.targetTop - animation.startTop) * easedProgress);

      applyProgrammaticScroll(nextScrollTop);

      if (progress >= 1 || Math.abs(animation.targetTop - nextScrollTop) < 1) {
        applyProgrammaticScroll(animation.targetTop);
        activeTurnAutoScrollAnimationRef.current = null;
        return;
      }
      activeTurnAutoScrollFrameRef.current = requestAnimationFrame(stepAutoScroll);
    };
    const startAutoScrollAnimation = (nextTargetScrollTop: number) => {
      const scrollElement = scrollContainerRef.current;
      if (!scrollElement) return;
      const distanceToTarget = nextTargetScrollTop - scrollElement.scrollTop;
      if (distanceToTarget <= 0.5) return;

      activeTurnAutoScrollTargetRef.current = nextTargetScrollTop;
      if (distanceToTarget <= ACTIVE_TURN_NEAR_BOTTOM_THRESHOLD_PX) {
        activeTurnAutoScrollAnimationRef.current = null;
        cancelAutoScrollFrame();
        applyProgrammaticScroll(nextTargetScrollTop);
        return;
      }

      activeTurnAutoScrollAnimationRef.current = {
        startTop: scrollElement.scrollTop,
        targetTop: nextTargetScrollTop,
        startedAt: performance.now(),
      };

      if (activeTurnAutoScrollFrameRef.current == null) {
        activeTurnAutoScrollFrameRef.current = requestAnimationFrame(stepAutoScroll);
      }
    };
    const updateAutoScrollTarget = (scrollElement: HTMLDivElement) => {
      cancelAnimationFrame(frame1);
      frame1 = requestAnimationFrame(() => {
        if (releasedByUser) return;

        const nextTargetScrollTop = getActiveTurnTargetScrollTop(scrollElement);
        if (nextTargetScrollTop > scrollElement.scrollTop + 0.5) {
          startAutoScrollAnimation(nextTargetScrollTop);
        }
      });
    };
    const releaseTopLock = () => {
      if (releasedByUser) return;
      releasedByUser = true;
      activeTurnAutoScrollTargetRef.current = 0;
      activeTurnAutoScrollAnimationRef.current = null;
      resizeObserver?.disconnect();
      cancelAutoScrollFrame();
      cancelAnimationFrame(readinessFrame);
      cancelAnimationFrame(frame1);
      handleActiveTurnUserInterrupt();
    };
    const handleKeyboardInterrupt = (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'PageUp' || event.key === 'PageDown' || event.key === 'Home' || event.key === 'End' || event.key === ' ') {
        releaseTopLock();
      }
    };
    const handlePointerScrollIntentStart = (event: PointerEvent) => {
      pointerScrollIntentActive = true;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      const scrollElement = scrollContainerRef.current;
      const target = event.target;
      if (!scrollElement || !(target instanceof Node)) return;

      const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
      if (contentColumn?.contains(target)) {
        releaseTopLock();
      }
    };
    const clearPointerScrollIntent = () => {
      pointerScrollIntentActive = false;
    };
    const handleManualScroll = () => {
      if (performance.now() <= ignoreScrollEventsUntil) return;
      if (!pointerScrollIntentActive) return;
      releaseTopLock();
    };
    const ensureScrollElementsReady = () => {
      const scrollElement = scrollContainerRef.current;
      if (!scrollElement) {
        readinessFrame = requestAnimationFrame(ensureScrollElementsReady);
        return;
      }
      attachedScrollElement = scrollElement;

      resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            if (!releasedByUser) {
              updateAutoScrollTarget(scrollElement);
            }
          })
        : null;

      scrollElement.addEventListener('scroll', handleManualScroll, { passive: true });
      scrollElement.addEventListener('wheel', releaseTopLock, { passive: true });
      scrollElement.addEventListener('touchmove', releaseTopLock, { passive: true });
      scrollElement.addEventListener('pointerdown', handlePointerScrollIntentStart, { passive: true });
      scrollElement.addEventListener('pointerup', clearPointerScrollIntent, { passive: true });
      scrollElement.addEventListener('pointercancel', clearPointerScrollIntent, { passive: true });
      scrollElement.addEventListener('pointerleave', clearPointerScrollIntent, { passive: true });
      scrollElement.addEventListener('keydown', handleKeyboardInterrupt);
      resizeObserver?.observe(scrollElement);
      const contentColumn = scrollElement.querySelector<HTMLElement>('[data-testid="chat-content-column"]');
      if (contentColumn) {
        resizeObserver?.observe(contentColumn);
      }
      const activeTurnAnchor = activeTurnViewportAnchorRef.current;
      if (activeTurnAnchor) {
        resizeObserver?.observe(activeTurnAnchor);
      }
      updateAutoScrollTarget(scrollElement);
    };

    readinessFrame = requestAnimationFrame(ensureScrollElementsReady);

    return () => {
      resizeObserver?.disconnect();
      attachedScrollElement?.removeEventListener('scroll', handleManualScroll);
      attachedScrollElement?.removeEventListener('wheel', releaseTopLock);
      attachedScrollElement?.removeEventListener('touchmove', releaseTopLock);
      attachedScrollElement?.removeEventListener('pointerdown', handlePointerScrollIntentStart);
      attachedScrollElement?.removeEventListener('pointerup', clearPointerScrollIntent);
      attachedScrollElement?.removeEventListener('pointercancel', clearPointerScrollIntent);
      attachedScrollElement?.removeEventListener('pointerleave', clearPointerScrollIntent);
      attachedScrollElement?.removeEventListener('keydown', handleKeyboardInterrupt);
      activeTurnAutoScrollAnimationRef.current = null;
      cancelAnimationFrame(readinessFrame);
      cancelAutoScrollFrame();
      cancelAnimationFrame(frame1);
    };
  }, [
    activeTurnScrollKey,
    activeTurnTailSpacerHeight,
    activeTurnUserInterruptVersion,
    currentSessionKey,
    getActiveTurnTargetScrollTop,
    handleActiveTurnUserInterrupt,
    sending,
  ]);

  const prepareForLocalSend = useCallback(() => {
    cancelPendingSessionEntryBottom();
    pendingLocalSendFollowBottomRef.current = true;
    resumeFollowingLatest('local-send');
  }, [cancelPendingSessionEntryBottom, resumeFollowingLatest]);

  const handleJumpToLatest = useCallback(() => {
    if (chatListItemCount === 0) return;

    cancelPendingSessionEntryBottom();
    suppressedAutoFollowTurnKeyRef.current = null;
    pendingLocalSendFollowBottomRef.current = true;
    resumeFollowingLatest('jump-to-latest');

    if (sending && activeTurnScrollKey) {
      activeTurnTrackedTurnKeyRef.current = activeTurnScrollKey;
      activeTurnAutoScrollModeRef.current = 'follow-active-turn';
      setActiveTurnUserInterruptVersion((value) => value + 1);
    }

    isAtBottomRef.current = true;
    setIsAtBottom(true);
    markProgrammaticScroll(ACTIVE_TURN_AUTO_SCROLL_DURATION_MS + 240);

    chatListRef.current?.scrollToIndex?.({
      index: Math.max(chatListItemCount - 1, 0),
      align: 'end',
      behavior: 'smooth',
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        positionScrollNearBottom(ACTIVE_TURN_BOTTOM_OFFSET_PX);
        syncBottomState(0);
      });
    });
  }, [
    activeTurnScrollKey,
    cancelPendingSessionEntryBottom,
    chatListItemCount,
    markProgrammaticScroll,
    positionScrollNearBottom,
    resumeFollowingLatest,
    sending,
    syncBottomState,
  ]);

  return {
    activeTurnViewportAnchorRef,
    activeTurnTailSpacerHeight,
    chatListRef,
    composerShellPadding,
    contentColumnHorizontalOffsetPx,
    handleActiveTurnUserInterrupt,
    handleJumpToLatest,
    hasDetachedNewContent,
    isAtBottom,
    prepareForLocalSend,
    setScrollContainerNode,
  };
}
