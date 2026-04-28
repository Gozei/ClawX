import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildChatTranscriptModel,
  buildFallbackActiveTurn,
} from '@/pages/Chat/useChatTranscriptModel';
import type { BuildChatTranscriptModelInput } from '@/pages/Chat/transcript-types';
import type { ActiveTurnBuffer, RawMessage, ToolStatus } from '@/stores/chat';

const fixedNow = 1_800_000_000_000;

function userMessage(id: string, content: string, timestamp = fixedNow / 1000): RawMessage {
  return {
    id,
    role: 'user',
    content,
    timestamp,
  };
}

function assistantMessage(id: string, content: RawMessage['content'], timestamp = fixedNow / 1000 + 1): RawMessage {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
  };
}

function modelInput(overrides: Partial<BuildChatTranscriptModelInput>): BuildChatTranscriptModelInput {
  return {
    currentSessionKey: 'agent:main:main',
    messages: [],
    activeTurnBuffer: null,
    streamingMessage: null,
    streamingTools: [],
    sending: false,
    pendingFinal: false,
    lastUserMessageAt: null,
    showThinking: true,
    chatProcessDisplayMode: 'all',
    assistantMessageStyle: 'stream',
    hideInternalRoutineProcesses: false,
    ...overrides,
  };
}

describe('buildChatTranscriptModel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prefers activeTurnBuffer over fallback reconstruction', () => {
    const history = [userMessage('history-user', 'Already done.', fixedNow / 1000 - 60)];
    const bufferUser = userMessage('buffer-user', 'Use the store buffer.');
    const bufferFinal = assistantMessage('buffer-final', 'Buffered reply.');
    const activeTurnBuffer: ActiveTurnBuffer = {
      historyMessages: history,
      userMessage: bufferUser,
      assistantMessages: [bufferFinal],
      processMessages: [],
      latestPersistedAssistant: bufferFinal,
      persistedFinalMessage: bufferFinal,
      streamingDisplayMessage: null,
      processStreamingMessage: null,
      finalStreamingMessage: null,
      startedAtMs: fixedNow,
      hasAnyStreamContent: false,
      isStreamingDuplicateOfPersistedAssistant: false,
    };

    const model = buildChatTranscriptModel(modelInput({
      messages: [userMessage('fallback-user', 'Ignore me.')],
      activeTurnBuffer,
      sending: true,
    }));

    expect(model.activeTurn?.userMessage.id).toBe('buffer-user');
    expect(model.chatListItems.map((item) => item.key)).toEqual([
      'history-user',
      'agent:main:main:buffer-user|user|1800000000|Use the store buffer.',
    ]);
  });

  it('rebuilds an active turn from the last user message while sending without activeTurnBuffer', () => {
    const previous = assistantMessage('previous-assistant', 'Previous answer.', fixedNow / 1000 - 60);
    const activeUser = userMessage('active-user', 'Explain why the page freezes.');
    const process = assistantMessage('process-1', [
      { type: 'thinking', thinking: 'Inspecting the trace.' },
    ]);

    const model = buildChatTranscriptModel(modelInput({
      messages: [
        userMessage('previous-user', 'Earlier question.', fixedNow / 1000 - 61),
        previous,
        activeUser,
        process,
      ],
      sending: true,
      lastUserMessageAt: fixedNow,
    }));

    expect(model.activeTurn?.userMessage).toBe(activeUser);
    expect(model.activeTurn?.processMessages).toEqual([process]);
    expect(model.displayHistoryItems.map((item) => item.key)).toEqual([
      'previous-user',
      'previous-assistant',
    ]);
  });

  it('does not duplicate streaming content that already landed as the persisted assistant reply', () => {
    const activeUser = userMessage('active-user', 'Summarize this.');
    const final = assistantMessage('assistant-final', 'The summary is ready.');

    const model = buildChatTranscriptModel(modelInput({
      messages: [activeUser, final],
      streamingMessage: {
        role: 'assistant',
        content: 'The summary is ready.',
        timestamp: final.timestamp,
      },
      sending: true,
      lastUserMessageAt: fixedNow,
    }));

    expect(model.activeTurn?.finalStreamingMessage).toBeNull();
    expect(model.activeTurn?.processStreamingMessage).toBeNull();
    expect(model.chatListItems.filter((item) => item.type === 'streaming-final')).toHaveLength(0);
  });

  it('keeps a just-completed turn in the active process layout during the grace window', () => {
    const activeUser = userMessage('active-user', 'Finish the task.', fixedNow / 1000 - 5);
    const final = assistantMessage('assistant-final', 'Done.', fixedNow / 1000 - 4);

    const model = buildChatTranscriptModel(modelInput({
      messages: [activeUser, final],
      sending: false,
      lastUserMessageAt: fixedNow - 5_000,
    }));

    expect(model.activeTurn?.useProcessLayout).toBe(true);
    expect(model.activeTurn?.finalMessage).toBe(final);
    expect(model.chatListItems.at(-1)?.type).toBe('active-turn');
  });

  it('hides internal maintenance user messages from active-turn display', () => {
    const maintenance = userMessage(
      'flush-user',
      [
        'Pre-compaction memory flush. Store durable memories only in memory/2026-04-16.md (create memory/ if needed).',
        'If nothing to store, reply with NO_REPLY.',
      ].join('\n'),
    );

    const model = buildChatTranscriptModel(modelInput({
      messages: [maintenance],
      sending: true,
      lastUserMessageAt: fixedNow,
    }));

    expect(model.activeTurn).toBeNull();
    expect(model.chatListItems).toEqual([]);
  });

  it('creates an activity item for pending final work with streaming tools and no visible active turn', () => {
    const streamingTools: ToolStatus[] = [
      {
        id: 'tool-1',
        name: 'browser',
        status: 'running',
        updatedAt: fixedNow,
      },
    ];

    const model = buildChatTranscriptModel(modelInput({
      sending: true,
      pendingFinal: true,
      streamingTools,
    }));

    expect(model.chatListItems).toEqual([
      {
        type: 'activity',
        key: 'activity:agent:main:main',
      },
    ]);
  });

  it('creates a typing item when sending has no active user and no stream content', () => {
    const model = buildChatTranscriptModel(modelInput({
      sending: true,
    }));

    expect(model.chatListItems).toEqual([
      {
        type: 'typing',
        key: 'typing:agent:main:main',
      },
    ]);
  });

  it('moves a just-completed fallback turn back to history after the grace window', () => {
    vi.setSystemTime(fixedNow + 15_001);
    const activeUser = userMessage('active-user', 'Finish the task.', fixedNow / 1000);
    const final = assistantMessage('assistant-final', 'Done.', fixedNow / 1000 + 1);

    const model = buildChatTranscriptModel(modelInput({
      messages: [activeUser, final],
      sending: false,
      lastUserMessageAt: fixedNow,
    }));

    expect(model.activeTurn).toBeNull();
    expect(model.chatListItems.map((item) => item.type)).toEqual(['history', 'history']);
  });

  it('keeps the latest user as the active turn while sending even when an assistant message follows it', () => {
    const activeUser = userMessage('active-user', 'Keep streaming.', fixedNow / 1000);
    const partialAssistant = assistantMessage('partial-assistant', 'Partial answer.', fixedNow / 1000 + 1);

    const model = buildChatTranscriptModel(modelInput({
      messages: [
        userMessage('previous-user', 'Earlier.', fixedNow / 1000 - 10),
        assistantMessage('previous-assistant', 'Earlier reply.', fixedNow / 1000 - 9),
        activeUser,
        partialAssistant,
      ],
      sending: true,
      lastUserMessageAt: fixedNow,
    }));

    expect(model.activeTurn?.userMessage).toBe(activeUser);
    expect(model.activeTurn?.processMessages).toEqual([partialAssistant]);
    expect(model.displayHistoryItems.map((item) => item.key)).toEqual([
      'previous-user',
      'previous-assistant',
    ]);
  });

  it('dedupes a deferred optimistic user only inside the timestamp match window', () => {
    const activeUser = userMessage('active-user', 'Same prompt.', fixedNow / 1000);
    const oldMatchingText = userMessage('old-user', 'Same prompt.', fixedNow / 1000 - 90);
    const recentMatchingText = userMessage('recent-user', 'Same prompt.', fixedNow / 1000 - 30);

    const outsideWindow = buildChatTranscriptModel(modelInput({
      messages: [activeUser],
      deferredHistoryMessages: [oldMatchingText],
      sending: true,
      lastUserMessageAt: fixedNow,
    }));
    const insideWindow = buildChatTranscriptModel(modelInput({
      messages: [activeUser],
      deferredHistoryMessages: [recentMatchingText],
      sending: true,
      lastUserMessageAt: fixedNow,
    }));

    expect(outsideWindow.displayHistoryItems.map((item) => item.key)).toEqual(['old-user']);
    expect(insideWindow.displayHistoryItems).toEqual([]);
  });

  it('keeps final replies that only contain attachments visible in the active turn', () => {
    const activeUser = userMessage('active-user', 'Create a file.');
    const final = assistantMessage('assistant-final', [
      { type: 'thinking', thinking: 'Preparing the file.' },
    ]);
    final._attachedFiles = [
      {
        fileName: 'result.txt',
        mimeType: 'text/plain',
        fileSize: 12,
        preview: null,
      },
    ];

    const model = buildChatTranscriptModel(modelInput({
      messages: [activeUser, final],
      sending: false,
      lastUserMessageAt: fixedNow,
    }));

    expect(model.activeTurn?.finalMessage?._attachedFiles?.[0]?.fileName).toBe('result.txt');
    expect(model.activeTurn?.processMessages).toEqual([]);
  });

  it('does not let streaming tool status create visible process layout outside all mode', () => {
    const activeUser = userMessage('active-user', 'Run a tool.');
    const streamingTools: ToolStatus[] = [
      {
        id: 'tool-1',
        name: 'browser',
        status: 'running',
        updatedAt: fixedNow,
      },
    ];

    const model = buildChatTranscriptModel(modelInput({
      messages: [activeUser],
      sending: true,
      pendingFinal: true,
      streamingTools,
      chatProcessDisplayMode: 'files',
      lastUserMessageAt: fixedNow,
    }));

    expect(model.activeTurn?.useProcessLayout).toBe(true);
    expect(model.activeTurn?.processStreamingMessage).toBeNull();
    expect(model.activeTurn?.showActivity).toBe(true);
    expect(model.chatListItems.map((item) => item.type)).toEqual(['active-turn']);
  });

  it('updates the activity signature when process streaming content changes without final text', () => {
    const activeUser = userMessage('active-user', 'Think aloud.');
    const first = buildChatTranscriptModel(modelInput({
      messages: [activeUser],
      streamingMessage: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Step one.' },
        ],
        timestamp: fixedNow / 1000,
      },
      sending: true,
      lastUserMessageAt: fixedNow,
    }));
    const second = buildChatTranscriptModel(modelInput({
      messages: [activeUser],
      streamingMessage: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Step one.\n\nStep two.' },
        ],
        timestamp: fixedNow / 1000,
      },
      sending: true,
      lastUserMessageAt: fixedNow,
    }));

    expect(first.latestTranscriptActivitySignature).not.toBe(second.latestTranscriptActivitySignature);
  });

  it('updates the activity signature when the latest history item content changes under stable keys', () => {
    const activeUser = userMessage('active-user', 'Stable id?');
    const first = buildChatTranscriptModel(modelInput({
      messages: [
        activeUser,
        assistantMessage('assistant-final', 'First version.'),
      ],
    }));
    const second = buildChatTranscriptModel(modelInput({
      messages: [
        activeUser,
        assistantMessage('assistant-final', 'Second version with more text.'),
      ],
    }));

    expect(first.chatListItems.map((item) => item.key)).toEqual(second.chatListItems.map((item) => item.key));
    expect(first.latestTranscriptActivitySignature).not.toBe(second.latestTranscriptActivitySignature);
  });

  it('updates the activity signature when streaming tool details change without an updatedAt change', () => {
    const activeUser = userMessage('active-user', 'Use a tool.');
    const toolBase: ToolStatus = {
      id: 'tool-1',
      name: 'browser',
      status: 'running',
      updatedAt: fixedNow,
      summary: 'Opening page',
    };

    const first = buildChatTranscriptModel(modelInput({
      messages: [activeUser],
      sending: true,
      pendingFinal: true,
      streamingTools: [toolBase],
      lastUserMessageAt: fixedNow,
    }));
    const second = buildChatTranscriptModel(modelInput({
      messages: [activeUser],
      sending: true,
      pendingFinal: true,
      streamingTools: [{ ...toolBase, summary: 'Opening page and waiting for load' }],
      lastUserMessageAt: fixedNow,
    }));

    expect(first.latestTranscriptActivitySignature).not.toBe(second.latestTranscriptActivitySignature);
  });
});

describe('buildFallbackActiveTurn', () => {
  it('keeps final attachments on the duplicate persisted final message', () => {
    const activeUser = userMessage('active-user', 'Create a report.');
    const final = assistantMessage('assistant-final', 'Report attached.');
    final._attachedFiles = [
      {
        fileName: 'report.txt',
        mimeType: 'text/plain',
        fileSize: 14,
        preview: null,
      },
    ];

    const fallback = buildFallbackActiveTurn({
      messages: [activeUser, final],
      streamingMessage: 'Report attached.',
      lastUserMessageAt: fixedNow,
      sending: true,
    });

    expect(fallback.persistedFinalMessage?._attachedFiles?.[0]?.fileName).toBe('report.txt');
    expect(fallback.isStreamingDuplicateOfPersistedAssistant).toBe(true);
  });

  it('uses the user timestamp when a string streaming message has no timestamp of its own', () => {
    const activeUser = userMessage('active-user', 'Stream with fallback timestamp.', fixedNow / 1000 - 3);

    const fallback = buildFallbackActiveTurn({
      messages: [activeUser],
      streamingMessage: 'Streaming text.',
      lastUserMessageAt: fixedNow - 3_000,
      sending: true,
    });

    expect(fallback.streamingDisplayMessage?.timestamp).toBe(activeUser.timestamp);
  });
});
