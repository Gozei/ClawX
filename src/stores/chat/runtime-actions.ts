import type { ChatGet, ChatSet, RuntimeActions } from './store-api';
import { createRuntimeEventActions } from './runtime-event-actions';
import { createRuntimeSendActions } from './runtime-send-actions';
import { createRuntimeUiActions } from './runtime-ui-actions';

export function createRuntimeActions(set: ChatSet, get: ChatGet): RuntimeActions {
  return {
    ...createRuntimeSendActions(set, get),
    ...createRuntimeEventActions(set, get),
    ...createRuntimeUiActions(set, get),
    queueOfflineMessage: (text, attachments, targetAgentId) => {
      const trimmed = text.trim();
      if (!trimmed && (!attachments || attachments.length === 0)) return;

      const targetSessionKey = get().currentSessionKey;
      const nowMs = Date.now();
      set((state) => ({
        queuedMessages: {
          ...state.queuedMessages,
          [targetSessionKey]: [
            ...(state.queuedMessages[targetSessionKey] ?? []),
            {
              id: crypto.randomUUID(),
              text: trimmed,
              attachments,
              targetAgentId,
              queuedAt: nowMs,
            },
          ],
        },
        sessionLastActivity: { ...state.sessionLastActivity, [targetSessionKey]: nowMs },
      }));
    },
    clearQueuedMessage: (sessionKey, queuedId) => {
      const targetSessionKey = sessionKey ?? get().currentSessionKey;
      set((state) => {
        const currentQueue = state.queuedMessages[targetSessionKey] ?? [];
        if (!queuedId) {
          const nextQueuedMessages = { ...state.queuedMessages };
          delete nextQueuedMessages[targetSessionKey];
          return { queuedMessages: nextQueuedMessages };
        }

        const nextQueue = currentQueue.filter((item) => item.id !== queuedId);
        if (nextQueue.length === 0) {
          const nextQueuedMessages = { ...state.queuedMessages };
          delete nextQueuedMessages[targetSessionKey];
          return { queuedMessages: nextQueuedMessages };
        }

        return {
          queuedMessages: {
            ...state.queuedMessages,
            [targetSessionKey]: nextQueue,
          },
        };
      });
    },
    flushQueuedMessage: async (sessionKey, queuedId) => {
      const targetSessionKey = sessionKey ?? get().currentSessionKey;
      const queue = get().queuedMessages[targetSessionKey] ?? [];
      const queued = queuedId ? queue.find((item) => item.id === queuedId) : queue[0];
      if (!queued || get().sending) return;

      set((state) => {
        const currentQueue = state.queuedMessages[targetSessionKey] ?? [];
        const nextQueue = currentQueue.filter((item) => item.id !== queued.id);
        if (nextQueue.length === 0) {
          const nextQueuedMessages = { ...state.queuedMessages };
          delete nextQueuedMessages[targetSessionKey];
          return { queuedMessages: nextQueuedMessages };
        }
        return {
          queuedMessages: {
            ...state.queuedMessages,
            [targetSessionKey]: nextQueue,
          },
        };
      });

      try {
        await get().sendMessage(queued.text, queued.attachments, queued.targetAgentId);
      } catch (error) {
        set((state) => ({
          queuedMessages: {
            ...state.queuedMessages,
            [targetSessionKey]: [queued, ...(state.queuedMessages[targetSessionKey] ?? [])],
          },
          error: String(error),
        }));
      }
    },
  };
}
