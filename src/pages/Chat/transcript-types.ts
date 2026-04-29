import type { ActiveTurnBuffer, RawMessage, ToolStatus } from '@/stores/chat';
import type { AssistantMessageStyle, ChatProcessDisplayMode } from '@/stores/settings';
import type { HistoryDisplayItem } from './history-grouping';

export type ActiveTurnViewModel = {
  userMessage: RawMessage;
  startedAtMs: number;
  processMessages: RawMessage[];
  processStreamingMessage: RawMessage | null;
  finalMessage: RawMessage | null;
  finalStreamingMessage: RawMessage | null;
  showActivity: boolean;
  showTyping: boolean;
  useProcessLayout: boolean;
  streamingTools: ToolStatus[];
  sending: boolean;
  scrollKey: string;
};

export type ChatListItem =
  | {
      type: 'history';
      key: string;
      item: HistoryDisplayItem;
    }
  | {
      type: 'active-turn';
      key: string;
    }
  | {
      type: 'streaming-final';
      key: string;
      message: RawMessage;
    }
  | {
      type: 'activity';
      key: string;
    }
  | {
      type: 'typing';
      key: string;
    };

export type ChatVirtuosoContext = {
  disableOverflowAnchor: boolean;
  horizontalOffsetPx: number;
  scrollbarGutter?: 'auto' | 'stable both-edges';
  setScrollElement: (node: HTMLDivElement | null) => void;
};

export type ChatTranscriptModel = {
  activeTurn: ActiveTurnViewModel | null;
  chatListItems: ChatListItem[];
  displayHistoryItems: HistoryDisplayItem[];
  latestTranscriptActivitySignature: string;
  scroll: {
    activeTurnScrollKey: string | null;
    shouldHideStandaloneStreamingAvatar: boolean;
  };
};

export type FallbackActiveTurnInput = {
  messages: RawMessage[];
  streamingMessage: unknown | null;
  lastUserMessageAt: number | null;
  sending: boolean;
};

export type NormalizedActiveTurnSource = {
  historyMessages: RawMessage[];
  userMessage: RawMessage | null;
  assistantMessages: RawMessage[];
  processMessages: RawMessage[];
  persistedFinalMessage: RawMessage | null;
  streamingDisplayMessage: RawMessage | null;
  processStreamingMessage: RawMessage | null;
  finalStreamingMessage: RawMessage | null;
  startedAtMs: number | null;
  hasAnyStreamContent: boolean;
  isStreamingDuplicateOfPersistedAssistant: boolean;
};

export type BuildChatTranscriptModelInput = {
  currentSessionKey: string;
  messages: RawMessage[];
  deferredHistoryMessages?: RawMessage[];
  activeTurnBuffer?: ActiveTurnBuffer | null;
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  sending: boolean;
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  showThinking: boolean;
  chatProcessDisplayMode: ChatProcessDisplayMode;
  assistantMessageStyle: AssistantMessageStyle;
  hideInternalRoutineProcesses: boolean;
};
