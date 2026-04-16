import type { ChatSendStage, ToolStatus } from './types';

export interface SessionRunSnapshot {
  currentSessionKey?: string | null;
  sending?: boolean;
  pendingFinal?: boolean;
  sendStage?: ChatSendStage | null;
  streamingMessage?: unknown | null;
  streamingTools?: ToolStatus[];
}

const ACTIVE_SEND_STAGES: ChatSendStage[] = [
  'sending_to_gateway',
  'awaiting_runtime',
  'running',
];

export function isSessionRunning(
  sessionKey: string,
  sessionRunningState: Record<string, boolean> | undefined,
  liveSnapshot?: SessionRunSnapshot,
): boolean {
  if (!sessionKey) return false;
  if (sessionRunningState?.[sessionKey]) return true;
  if (!liveSnapshot) return false;
  if (liveSnapshot.currentSessionKey !== sessionKey) return false;
  if (!liveSnapshot.sending) return false;
  if (liveSnapshot.pendingFinal) return true;
  if (liveSnapshot.streamingMessage != null) return true;
  if ((liveSnapshot.streamingTools?.length ?? 0) > 0) return true;
  return liveSnapshot.sendStage != null && ACTIVE_SEND_STAGES.includes(liveSnapshot.sendStage);
}
