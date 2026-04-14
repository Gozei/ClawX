import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@/stores/chat';
import { extractThinking, extractToolUse, extractText, mergeThinkingMessages } from '@/pages/Chat/message-utils';

describe('chat message utils', () => {
  it('merges consecutive tool-only thinking messages into the final assistant answer', () => {
    const messages: RawMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Help me with this task',
      },
      {
        id: 'assistant-tool-1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'First thinking step' },
          { type: 'tool_use', id: 'tool-1', name: 'write', input: { path: 'a.ts' } },
        ],
      },
      {
        id: 'assistant-tool-2',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Second thinking step' },
          { type: 'tool_use', id: 'tool-2', name: 'exec', input: { command: 'pnpm test' } },
        ],
      },
      {
        id: 'assistant-final',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Final answer' },
        ],
      },
    ];

    const merged = mergeThinkingMessages(messages);

    expect(merged).toHaveLength(2);
    expect(merged[0]?.id).toBe('user-1');
    expect(merged[1]?.id).toBe('assistant-final');
    expect(extractThinking(merged[1])).toBe('First thinking step\n\nSecond thinking step');
    expect(extractText(merged[1])).toBe('Final answer');
    expect(extractToolUse(merged[1])).toHaveLength(0);
  });

  it('preserves a final assistant thinking block and appends prior tool-only thinking before it', () => {
    const messages: RawMessage[] = [
      {
        id: 'assistant-tool-1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Tool thinking' },
          { type: 'tool_use', id: 'tool-1', name: 'message', input: { text: 'hello' } },
        ],
      },
      {
        id: 'assistant-final',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Final thinking' },
          { type: 'text', text: 'Answer text' },
        ],
      },
    ];

    const merged = mergeThinkingMessages(messages);

    expect(merged).toHaveLength(1);
    expect(extractThinking(merged[0])).toBe('Tool thinking\n\nFinal thinking');
    expect(extractText(merged[0])).toBe('Answer text');
  });

  it('keeps only the last assistant result while merging all assistant thinking in the same turn', () => {
    const messages: RawMessage[] = [
      {
        id: 'assistant-tool-1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'First thinking' },
          { type: 'tool_use', id: 'tool-1', name: 'nodes', input: { command: 'dir' } },
        ],
      },
      {
        id: 'assistant-step-2',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Second thinking' },
          { type: 'text', text: 'Interim response' },
        ],
      },
      {
        id: 'assistant-final',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Final thinking' },
          { type: 'text', text: 'Done' },
        ],
      },
    ];

    const merged = mergeThinkingMessages(messages);

    expect(merged).toHaveLength(1);
    expect(extractText(merged[0])).toBe('Done');
    expect(extractThinking(merged[0])).toBe('First thinking\n\nSecond thinking\n\nFinal thinking');
    expect(extractToolUse(merged[0])).toHaveLength(0);
  });

  it('splits merged assistant turns at user messages', () => {
    const messages: RawMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'First prompt',
      },
      {
        id: 'assistant-1a',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Turn one thinking' },
          { type: 'text', text: 'Turn one result' },
        ],
      },
      {
        id: 'user-2',
        role: 'user',
        content: 'Second prompt',
      },
      {
        id: 'assistant-2a',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Turn two thinking A' },
        ],
      },
      {
        id: 'assistant-2b',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Turn two thinking B' },
          { type: 'text', text: 'Turn two result' },
        ],
      },
    ];

    const merged = mergeThinkingMessages(messages);

    expect(merged).toHaveLength(4);
    expect(merged[1]?.id).toBe('assistant-1a');
    expect(extractThinking(merged[1])).toBe('Turn one thinking');
    expect(merged[3]?.id).toBe('assistant-2b');
    expect(extractThinking(merged[3])).toBe('Turn two thinking A\n\nTurn two thinking B');
    expect(extractText(merged[3])).toBe('Turn two result');
  });

  it('prefers the last assistant message with actual result content over a trailing thinking-only message', () => {
    const messages: RawMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Prompt',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Thinking A' },
          { type: 'text', text: 'Final result' },
        ],
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Thinking B' },
        ],
      },
    ];

    const merged = mergeThinkingMessages(messages);

    expect(merged).toHaveLength(2);
    expect(merged[1]?.id).toBe('assistant-1');
    expect(extractThinking(merged[1])).toBe('Thinking A\n\nThinking B');
    expect(extractText(merged[1])).toBe('Final result');
  });

  it('compacts system exec and heartbeat noise in user messages', () => {
    const message: RawMessage = {
      id: 'system-noise-1',
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'System (untrusted): [2026-04-13 12:02:30 GMT+8] Exec completed (tidy-lob, code 0) :: long output here',
            'System (untrusted): [2026-04-13 12:03:01 GMT+8] Exec completed (nimble-d, code 1) :: stack trace here',
            '',
            '如果存在 HEARTBEAT.md（工作区上下文），请读取并严格遵循。不要根据过往对话臆测或重复旧任务。如果当前没有需要处理的事项，请回复 HEARTBEAT_OK。',
            '读取 HEARTBEAT.md 时，请使用工作区文件 /Users/example/.openclaw/workspace/HEARTBEAT.md（注意大小写完全一致）。不要读取 docs/heartbeat.md。',
            '当前时间：Monday, April 13th, 2026 - 12:04（Asia/Shanghai）',
          ].join('\n'),
        },
      ],
      timestamp: 1713000000,
    };

    expect(extractText(message)).toBe(
      '系统事件：已记录 2 个后台执行结果，其中 1 个异常退出。\n心跳检查：已附带工作区 HEARTBEAT 提示。',
    );
  });

  it('preserves normal user text that only happens to mention system wording', () => {
    const message: RawMessage = {
      id: 'normal-user-1',
      role: 'user',
      content: '请帮我解释一下 System (untrusted) 这个词是什么意思。',
      timestamp: 1713000001,
    };

    expect(extractText(message)).toBe('请帮我解释一下 System (untrusted) 这个词是什么意思。');
  });
});
