import type { ContentBlock, RawMessage } from '@/stores/chat';

export type HistoryDisplayItem =
  | {
      type: 'message';
      key: string;
      message: RawMessage;
    }
  | {
      type: 'turn';
      key: string;
      userMessage: RawMessage;
      intermediateMessages: RawMessage[];
      finalMessage: RawMessage;
    };

function normalizeRole(role: RawMessage['role'] | string | undefined): string {
  return typeof role === 'string' ? role.toLowerCase() : '';
}

function isUserMessage(message: RawMessage | undefined): boolean {
  return normalizeRole(message?.role) === 'user';
}

function isAssistantMessage(message: RawMessage | undefined): boolean {
  return normalizeRole(message?.role) === 'assistant';
}

export function groupMessagesForDisplay(messages: RawMessage[]): HistoryDisplayItem[] {
  const items: HistoryDisplayItem[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const currentMessage = messages[index];

    if (!isUserMessage(currentMessage)) {
      items.push({
        type: 'message',
        key: currentMessage.id || `message-${index}`,
        message: currentMessage,
      });
      continue;
    }

    let nextUserIndex = messages.length;
    for (let scanIndex = index + 1; scanIndex < messages.length; scanIndex += 1) {
      if (isUserMessage(messages[scanIndex])) {
        nextUserIndex = scanIndex;
        break;
      }
    }

    const turnMessages = messages.slice(index + 1, nextUserIndex);
    const assistantMessages = turnMessages.filter((message) => isAssistantMessage(message));

    if (assistantMessages.length > 1) {
      const finalMessage = assistantMessages[assistantMessages.length - 1];
      items.push({
        type: 'turn',
        key: currentMessage.id || finalMessage.id || `turn-${index}`,
        userMessage: currentMessage,
        intermediateMessages: assistantMessages.slice(0, -1),
        finalMessage,
      });
    } else {
      items.push({
        type: 'message',
        key: currentMessage.id || `message-${index}`,
        message: currentMessage,
      });

      if (assistantMessages.length === 1) {
        const assistantMessage = assistantMessages[0];
        items.push({
          type: 'message',
          key: assistantMessage.id || `message-${index + 1}`,
          message: assistantMessage,
        });
      }
    }

    index = nextUserIndex - 1;
  }

  return items;
}

export function splitFinalMessageForTurnDisplay(finalMessage: RawMessage): {
  collapsedThinkingMessage: RawMessage | null;
  finalDisplayMessage: RawMessage;
} {
  if (!Array.isArray(finalMessage.content)) {
    return {
      collapsedThinkingMessage: null,
      finalDisplayMessage: finalMessage,
    };
  }

  const thinkingBlocks = (finalMessage.content as ContentBlock[]).filter((block) => block.type === 'thinking');
  if (thinkingBlocks.length === 0) {
    return {
      collapsedThinkingMessage: null,
      finalDisplayMessage: finalMessage,
    };
  }

  const nonThinkingBlocks = (finalMessage.content as ContentBlock[]).filter((block) => block.type !== 'thinking');

  return {
    collapsedThinkingMessage: {
      ...finalMessage,
      id: finalMessage.id ? `${finalMessage.id}-thinking` : finalMessage.id,
      content: thinkingBlocks,
      _attachedFiles: [],
    },
    finalDisplayMessage: {
      ...finalMessage,
      content: nonThinkingBlocks,
    },
  };
}
