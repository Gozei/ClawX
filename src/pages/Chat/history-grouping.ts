import type { ContentBlock, RawMessage } from '@/stores/chat';
import { isInternalMaintenanceTurnUserMessage } from './message-utils';

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

function isProcessBlock(block: ContentBlock): boolean {
  return block.type === 'thinking'
    || block.type === 'tool_use'
    || block.type === 'toolCall'
    || block.type === 'tool_result'
    || block.type === 'toolResult';
}

function normalizeRole(role: RawMessage['role'] | string | undefined): string {
  return typeof role === 'string' ? role.toLowerCase() : '';
}

function isUserMessage(message: RawMessage | undefined): boolean {
  return normalizeRole(message?.role) === 'user';
}

function isAssistantMessage(message: RawMessage | undefined): boolean {
  return normalizeRole(message?.role) === 'assistant';
}

function shouldRenderAssistantAsProcessTurn(message: RawMessage | undefined): boolean {
  if (!message || !isAssistantMessage(message)) return false;
  return splitFinalMessageForTurnDisplay(message).collapsedProcessMessage != null;
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

    if (isInternalMaintenanceTurnUserMessage(currentMessage)) {
      index = nextUserIndex - 1;
      continue;
    }

    const turnMessages = messages.slice(index + 1, nextUserIndex);
    const assistantMessages = turnMessages.filter((message) => isAssistantMessage(message));

    const shouldGroupAsTurn = assistantMessages.length > 1
      || (assistantMessages.length === 1 && shouldRenderAssistantAsProcessTurn(assistantMessages[0]));

    if (shouldGroupAsTurn) {
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
  collapsedProcessMessage: RawMessage | null;
  collapsedThinkingMessage: RawMessage | null;
  finalDisplayMessage: RawMessage;
} {
  if (!Array.isArray(finalMessage.content)) {
    return {
      collapsedProcessMessage: null,
      collapsedThinkingMessage: null,
      finalDisplayMessage: finalMessage,
    };
  }

  const processBlocks = (finalMessage.content as ContentBlock[]).filter((block) => isProcessBlock(block));
  const thinkingBlocks = (finalMessage.content as ContentBlock[]).filter((block) => block.type === 'thinking');
  if (processBlocks.length === 0) {
    return {
      collapsedProcessMessage: null,
      collapsedThinkingMessage: null,
      finalDisplayMessage: finalMessage,
    };
  }

  const nonProcessBlocks = (finalMessage.content as ContentBlock[]).filter((block) => !isProcessBlock(block));

  return {
    collapsedProcessMessage: {
      ...finalMessage,
      id: finalMessage.id ? `${finalMessage.id}-process` : finalMessage.id,
      content: processBlocks,
      _attachedFiles: [],
    },
    collapsedThinkingMessage: thinkingBlocks.length > 0
      ? {
          ...finalMessage,
          id: finalMessage.id ? `${finalMessage.id}-thinking` : finalMessage.id,
          content: thinkingBlocks,
          _attachedFiles: [],
        }
      : null,
    finalDisplayMessage: {
      ...finalMessage,
      content: nonProcessBlocks,
    },
  };
}
