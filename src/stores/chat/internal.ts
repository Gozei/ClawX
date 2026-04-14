import { DEFAULT_SESSION_KEY, type ChatState } from './types';
import { createRuntimeActions } from './runtime-actions';
import { createSessionHistoryActions } from './session-history-actions';
import type { ChatGet, ChatSet } from './store-api';

export const initialChatState: Pick<
  ChatState,
  | 'messages'
  | 'loading'
  | 'error'
  | 'sending'
  | 'activeRunId'
  | 'streamingText'
  | 'streamingMessage'
  | 'streamingTools'
  | 'pendingFinal'
  | 'lastUserMessageAt'
  | 'pendingToolImages'
  | 'activeTurnBuffer'
  | 'sessions'
  | 'currentSessionKey'
  | 'currentAgentId'
  | 'sessionModels'
  | 'sessionLabels'
  | 'sessionLastActivity'
  | 'showThinking'
  | 'thinkingLevel'
> = {
  messages: [],
  loading: false,
  error: null,

  sending: false,
  activeRunId: null,
  streamingText: '',
  streamingMessage: null,
  streamingTools: [],
  pendingFinal: false,
  lastUserMessageAt: null,
  pendingToolImages: [],
  activeTurnBuffer: {
    historyMessages: [],
    userMessage: null,
    assistantMessages: [],
    processMessages: [],
    latestPersistedAssistant: null,
    persistedFinalMessage: null,
    streamingDisplayMessage: null,
    processStreamingMessage: null,
    finalStreamingMessage: null,
    startedAtMs: null,
    hasAnyStreamContent: false,
    isStreamingDuplicateOfPersistedAssistant: false,
  },

  sessions: [],
  currentSessionKey: DEFAULT_SESSION_KEY,
  currentAgentId: 'main',
  sessionModels: {},
  sessionLabels: {},
  sessionLastActivity: {},

  showThinking: true,
  thinkingLevel: null,
};

export function createChatActions(
  set: ChatSet,
  get: ChatGet,
): Pick<
  ChatState,
  | 'loadSessions'
  | 'switchSession'
  | 'newSession'
  | 'renameSession'
  | 'toggleSessionPin'
  | 'deleteSession'
  | 'cleanupEmptySession'
  | 'loadHistory'
  | 'sendMessage'
  | 'abortRun'
  | 'handleChatEvent'
  | 'toggleThinking'
  | 'refresh'
  | 'clearError'
> {
  return {
    ...createSessionHistoryActions(set, get),
    ...createRuntimeActions(set, get),
  };
}
