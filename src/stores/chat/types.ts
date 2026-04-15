/** Metadata for locally-attached files (not from Gateway) */
export interface AttachedFileMeta {
  fileName: string;
  mimeType: string;
  fileSize: number;
  preview: string | null;
  filePath?: string;
}

/** Raw message from OpenClaw chat.history */
export interface RawMessage {
  role: 'user' | 'assistant' | 'system' | 'toolresult';
  content: unknown; // string | ContentBlock[]
  timestamp?: number;
  id?: string;
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  isError?: boolean;
  /** Local-only: file metadata for user-uploaded attachments (not sent to/from Gateway) */
  _attachedFiles?: AttachedFileMeta[];
}

/** Content block inside a message */
export interface ContentBlock {
  type: 'text' | 'image' | 'thinking' | 'tool_use' | 'tool_result' | 'toolCall' | 'toolResult';
  text?: string;
  thinking?: string;
  status?: 'running' | 'completed' | 'error';
  durationMs?: number;
  source?: { type: string; media_type?: string; data?: string; url?: string };
  /** Flat image format from Gateway tool results (no source wrapper) */
  data?: string;
  mimeType?: string;
  id?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
  content?: unknown;
}

/** Session from sessions.list */
export interface ChatSession {
  key: string;
  label?: string;
  displayName?: string;
  thinkingLevel?: string;
  modelProvider?: string;
  model?: string;
  updatedAt?: number;
  pinned?: boolean;
  pinOrder?: number;
}

export interface ToolStatus {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  summary?: string;
  updatedAt: number;
}

export interface QueuedChatMessage {
  id: string;
  text: string;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    fileSize: number;
    stagedPath: string;
    preview: string | null;
  }>;
  targetAgentId?: string | null;
  queuedAt: number;
}

export type ChatSendStage =
  | 'sending_to_gateway'
  | 'awaiting_runtime'
  | 'running'
  | 'finalizing';

export interface ActiveTurnBuffer {
  historyMessages: RawMessage[];
  userMessage: RawMessage | null;
  assistantMessages: RawMessage[];
  processMessages: RawMessage[];
  latestPersistedAssistant: RawMessage | null;
  persistedFinalMessage: RawMessage | null;
  streamingDisplayMessage: RawMessage | null;
  processStreamingMessage: RawMessage | null;
  finalStreamingMessage: RawMessage | null;
  startedAtMs: number | null;
  hasAnyStreamContent: boolean;
  isStreamingDuplicateOfPersistedAssistant: boolean;
}

export interface ChatState {
  // Messages
  messages: RawMessage[];
  loading: boolean;
  error: string | null;

  // Streaming
  sending: boolean;
  activeRunId: string | null;
  streamingText: string;
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  sendStage: ChatSendStage | null;
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  /** Images collected from tool results, attached to the next assistant message */
  pendingToolImages: AttachedFileMeta[];
  activeTurnBuffer?: ActiveTurnBuffer;

  // Sessions
  sessions: ChatSession[];
  currentSessionKey: string;
  currentAgentId: string;
  sessionModels: Record<string, string>;
  /** First user message text per session key, used as display label */
  sessionLabels: Record<string, string>;
  /** Last message timestamp (ms) per session key, used for sorting */
  sessionLastActivity: Record<string, number>;
  /** Sidebar-only running state for sessions that still have work in flight */
  sessionRunningState?: Record<string, boolean>;
  queuedMessages: Record<string, QueuedChatMessage[]>;

  // Thinking
  showThinking: boolean;
  thinkingLevel: string | null;

  // Actions
  loadSessions: () => Promise<void>;
  switchSession: (key: string) => void;
  newSession: () => void;
  renameSession: (key: string, label: string) => Promise<void>;
  toggleSessionPin: (key: string) => Promise<void>;
  deleteSession: (key: string) => Promise<void>;
  cleanupEmptySession: () => void;
  loadHistory: (quiet?: boolean) => Promise<void>;
  sendMessage: (
    text: string,
    attachments?: Array<{
      fileName: string;
      mimeType: string;
      fileSize: number;
      stagedPath: string;
      preview: string | null;
    }>,
    targetAgentId?: string | null,
  ) => Promise<void>;
  abortRun: () => Promise<void>;
  handleChatEvent: (event: Record<string, unknown>) => void;
  toggleThinking: () => void;
  refresh: () => Promise<void>;
  clearError: () => void;
  queueOfflineMessage: (
    text: string,
    attachments?: Array<{
      fileName: string;
      mimeType: string;
      fileSize: number;
      stagedPath: string;
      preview: string | null;
    }>,
    targetAgentId?: string | null,
  ) => void;
  flushQueuedMessage: (sessionKey?: string, queuedId?: string) => Promise<void>;
  clearQueuedMessage: (sessionKey?: string, queuedId?: string) => void;
}

export const DEFAULT_CANONICAL_PREFIX = 'agent:main';
export const DEFAULT_SESSION_KEY = `${DEFAULT_CANONICAL_PREFIX}:main`;
