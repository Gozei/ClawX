import { describe, expect, it } from 'vitest';
import { extractText } from '@/pages/Chat/message-utils';
import type { RawMessage } from '@/stores/chat';

describe('chat message utils', () => {
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
