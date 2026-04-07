import { useEffect, useRef } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

/**
 * A wrapper around useStickToBottom that ensures the initial scroll
 * to bottom happens instantly without any visible animation.
 *
 * @param resetKey - When this key changes, the scroll position will be reset to bottom instantly.
 *                   Typically this should be the conversation ID.
 */
export function useStickToBottomInstant(resetKey?: string) {
  const lastKeyRef = useRef(resetKey);
  const hasInitializedRef = useRef(false);

  const result = useStickToBottom({
    initial: "instant",
    // Streaming chat updates can resize the container dozens of times per
    // second. Smooth scrolling on every resize keeps scheduling animations
    // and makes long conversations feel janky, so keep resize scrolling
    // instant while preserving the instant initial jump.
    resize: "instant",
  });

  const { scrollRef } = result;

  // Reset initialization when key changes
  useEffect(() => {
    if (resetKey !== lastKeyRef.current) {
      hasInitializedRef.current = false;
      lastKeyRef.current = resetKey;
    }
  }, [resetKey]);

  // Scroll to bottom instantly on mount or when key changes
  useEffect(() => {
    if (hasInitializedRef.current) return;

    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    // Hide, scroll, reveal pattern to avoid visible animation
    scrollElement.style.visibility = "hidden";

    // Use double RAF to ensure content is rendered
    const frame1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Direct scroll to bottom
        scrollElement.scrollTop = scrollElement.scrollHeight;

        // Small delay to ensure scroll is applied
        setTimeout(() => {
          scrollElement.style.visibility = "";
          hasInitializedRef.current = true;
        }, 0);
      });
    });

    return () => cancelAnimationFrame(frame1);
  }, [scrollRef, resetKey]);

  return result;
}
