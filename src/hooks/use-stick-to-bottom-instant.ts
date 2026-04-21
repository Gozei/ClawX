import { useMemo, useRef } from 'react';

type CallbackRef<T extends HTMLElement> = ((node: T | null) => void) & { current: T | null };

function createCallbackRef<T extends HTMLElement>(): CallbackRef<T> {
  const callbackRef = ((node: T | null) => {
    callbackRef.current = node;
  }) as CallbackRef<T>;
  callbackRef.current = null;
  return callbackRef;
}

/**
 * Deprecated compatibility shim. Chat now uses Virtuoso as its single
 * message-list engine, so callers should migrate away from this hook.
 */
export function useStickToBottomInstant() {
  const scrollRef = useRef(createCallbackRef<HTMLElement>()).current;
  const contentRef = useRef(createCallbackRef<HTMLElement>()).current;

  return useMemo(() => ({
    scrollRef,
    contentRef,
    stopScroll: () => {},
  }), [contentRef, scrollRef]);
}
