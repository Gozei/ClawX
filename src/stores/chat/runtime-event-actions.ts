import { clearHistoryPoll, setHistoryPollTimer, setLastChatEventAt } from './helpers';
import type { ChatGet, ChatSet, RuntimeActions } from './store-api';
import { handleRuntimeEventState } from './runtime-event-handlers';

// 工具执行间隙的历史轮询间隔（ms）
const TOOL_GAP_POLL_INTERVAL = 4_000;

/**
 * 当 sending=true 但 streamingMessage 已被清除时（通常是 tool_result final 之后、
 * 下一个 delta 到达之前），启动一个周期性历史轮询以持续更新中间工具调用结果。
 */
function ensureToolGapPoll(_set: ChatSet, get: ChatGet): void {
  const state = get();
  if (!state.sending || state.streamingMessage) return;
  clearHistoryPoll();
  const poll = () => {
    const s = get();
    if (!s.sending) { clearHistoryPoll(); return; }
    // 有流式消息时跳过本次轮询但继续调度
    if (!s.streamingMessage) {
      s.loadHistory(true);
    }
    setHistoryPollTimer(setTimeout(poll, TOOL_GAP_POLL_INTERVAL));
  };
  setHistoryPollTimer(setTimeout(poll, TOOL_GAP_POLL_INTERVAL));
}

export function createRuntimeEventActions(set: ChatSet, get: ChatGet): Pick<RuntimeActions, 'handleChatEvent'> {
  return {
    handleChatEvent: (event: Record<string, unknown>) => {
      const runId = String(event.runId || '');
      const eventState = String(event.state || '');
      const eventSessionKey = event.sessionKey != null ? String(event.sessionKey) : null;
      const { activeRunId, currentSessionKey } = get();

      // Only process events for the current session (when sessionKey is present)
      if (eventSessionKey != null && eventSessionKey !== currentSessionKey) return;

      // Only process events for the active run (or if no active run set)
      if (activeRunId && runId && runId !== activeRunId) return;

      setLastChatEventAt(Date.now());

      // Defensive: if state is missing but we have a message, try to infer state.
      let resolvedState = eventState;
      if (!resolvedState && event.message && typeof event.message === 'object') {
        const msg = event.message as Record<string, unknown>;
        const stopReason = msg.stopReason ?? msg.stop_reason;
        if (stopReason) {
          resolvedState = 'final';
        } else if (msg.role || msg.content) {
          resolvedState = 'delta';
        }
      }

      // Only pause the history poll when we receive actual streaming data.
      // The gateway sends "agent" events with { phase, startedAt } that carry
      // no message — these must NOT kill the poll, since the poll is our only
      // way to track progress when the gateway doesn't stream intermediate turns.
      const hasUsefulData = resolvedState === 'delta' || resolvedState === 'final'
        || resolvedState === 'error' || resolvedState === 'aborted';
      if (hasUsefulData) {
        clearHistoryPoll();
        // Adopt run started from another client (e.g. console at 127.0.0.1:18789):
        // show loading/streaming in the app when this session has an active run.
        const { sending } = get();
        if (!sending && runId) {
          set({ sending: true, activeRunId: runId, error: null });
        }
      }

      handleRuntimeEventState(set, get, event, resolvedState, runId);

      // tool_result final 之后 streamingMessage 被清空、但 sending 仍为 true，
      // 此时 Gateway 可能长时间不发新 delta（工具执行中），需要恢复历史轮询
      // 以持续拉取中间结果，避免 UI 停更。
      if (hasUsefulData && resolvedState === 'final') {
        ensureToolGapPoll(set, get);
      }
    },
  };
}
