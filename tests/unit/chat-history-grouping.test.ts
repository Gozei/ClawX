import { describe, expect, it } from 'vitest';
import { groupMessagesForDisplay, splitFinalMessageForTurnDisplay } from '@/pages/Chat/history-grouping';
import type { RawMessage } from '@/stores/chat';

describe('groupMessagesForDisplay', () => {
  it('groups intermediate assistant messages under a single turn and keeps the final reply separate', () => {
    const messages: RawMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: '请拍一张照片',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先确认拍照工具可用。' },
          { type: 'text', text: '我先帮你准备拍照。' },
        ],
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '拍照已经完成，整理结果。' },
          { type: 'text', text: '照片已经保存，正在准备发送。' },
        ],
      },
      {
        id: 'assistant-3',
        role: 'assistant',
        content: '完成，照片已发送。',
      },
    ];

    const grouped = groupMessagesForDisplay(messages);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      type: 'turn',
      userMessage: { id: 'user-1' },
      finalMessage: { id: 'assistant-3' },
    });

    if (grouped[0].type !== 'turn') {
      throw new Error('expected a grouped turn item');
    }

    expect(grouped[0].intermediateMessages.map((message) => message.id)).toEqual(['assistant-1', 'assistant-2']);
  });

  it('leaves single assistant replies as normal messages', () => {
    const messages: RawMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: '你好',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '你好，我在。',
      },
    ];

    const grouped = groupMessagesForDisplay(messages);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ type: 'message', message: { id: 'user-1' } });
    expect(grouped[1]).toMatchObject({ type: 'message', message: { id: 'assistant-1' } });
  });

  it('treats a single assistant reply with process blocks as a turn so the process section can collapse', () => {
    const messages: RawMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Tell me what Memo is.',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Confirm the concept before answering.' },
          { type: 'text', text: 'Memo is an AI memory layer project.' },
        ],
      },
    ];

    const grouped = groupMessagesForDisplay(messages);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      type: 'turn',
      userMessage: { id: 'user-1' },
      finalMessage: { id: 'assistant-1' },
    });

    if (grouped[0].type !== 'turn') {
      throw new Error('expected a grouped turn item');
    }

    expect(grouped[0].intermediateMessages).toEqual([]);
  });

  it('moves thinking blocks off the final display message so the turn only shows one collapsed thinking entry', () => {
    const finalMessage: RawMessage = {
      id: 'assistant-final',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '先整理回答结构。' },
        { type: 'text', text: '这是最终回复。' },
      ],
      _attachedFiles: [
        {
          fileName: 'result.txt',
          mimeType: 'text/plain',
          fileSize: 12,
          preview: null,
        },
      ],
    };

    const { collapsedThinkingMessage, finalDisplayMessage } = splitFinalMessageForTurnDisplay(finalMessage);

    expect(collapsedThinkingMessage).toMatchObject({
      id: 'assistant-final-thinking',
      content: [{ type: 'thinking', thinking: '先整理回答结构。' }],
      _attachedFiles: [],
    });
    expect(finalDisplayMessage).toMatchObject({
      id: 'assistant-final',
      content: [{ type: 'text', text: '这是最终回复。' }],
      _attachedFiles: [
        {
          fileName: 'result.txt',
        },
      ],
    });
  });
});
