import { describe, expect, it } from 'vitest';
import { extractText } from '@/pages/Chat/message-utils';
import type { RawMessage } from '@/stores/chat';

describe('chat message utils', () => {
  it('hides heartbeat-only prompt injection from user-visible chat text', () => {
    const message: RawMessage = {
      id: 'heartbeat-only-1',
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            '如果存在 HEARTBEAT.md（工作区上下文），请读取并严格遵循。如果当前没有需要处理的事项，请回复 HEARTBEAT_OK。',
            '读取 HEARTBEAT.md 时，请使用工作区文件 /Users/example/.openclaw/workspace/HEARTBEAT.md。',
            '当前时间：Monday, April 13th, 2026 - 12:04（Asia/Shanghai）',
          ].join('\n'),
        },
      ],
      timestamp: 1713000000,
    };

    expect(extractText(message)).toBe('');
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
  it('strips injected execution playbook metadata from user-visible text', () => {
    const message: RawMessage = {
      id: 'conversation-metadata-1',
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'Sender (untrusted metadata):',
            '```json',
            '{"label":"Deep AI Worker","id":"gateway-client"}',
            '```',
            '',
            '[Wed 2026-04-15 15:43 GMT+8] Conversation info (untrusted metadata): ```json',
            '{"agent":{"id":"ops","name":"Operations","preferredModel":"custom/gpt-5.4"}}',
            '```',
            'Execution playbook:',
            '- You are currently acting as the Operations agent.',
            '- Preferred model: custom/gpt-5.4',
            '- If tools are unavailable, explain the block instead of fabricating.',
            '',
            'What can you do?',
          ].join('\n'),
        },
      ],
      timestamp: 1713000002,
    };

    expect(extractText(message)).toBe('What can you do?');
  });

  it('strips direct execution playbook metadata from user-visible text', () => {
    const message: RawMessage = {
      id: 'conversation-metadata-direct-1',
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'Execution playbook:',
            '- 你当前扮演的智能体是 "运营专家"（ID: agent）。',
            '- 优先模型：custom-custombc/qwen3.5-plus',
            '- 如果现有技能、模型或渠道不足以完成流程，请明确指出卡点，不要伪造执行结果。',
            '',
            '你现在是什么模型',
          ].join('\n'),
        },
      ],
      timestamp: 1713000004,
    };

    expect(extractText(message)).toBe('你现在是什么模型');
  });

  it('strips injected leading system and conversation metadata from user-visible text', () => {
    const message: RawMessage = {
      id: 'conversation-metadata-system-prefix-1',
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'System: [2026-04-16 13:26:14 GMT+8] Gateway check: completed (config.patch)',
            'System: Run available: openclaw doctor --non-interactive',
            '',
            'Conversation info (untrusted metadata): ```json',
            '{"message_id":"openclaw-weixin:1776317819759-0deed226","timestamp":"Thu 2026-04-16 13:37 GMT+8"}',
            '```',
            '',
            'What model are you using?',
          ].join('\n'),
        },
      ],
      timestamp: 1713000005,
    };

    expect(extractText(message)).toBe('What model are you using?');
  });

  it('strips localized leading system lines before injected conversation metadata', () => {
    const message: RawMessage = {
      id: 'conversation-metadata-system-prefix-zh-1',
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'System: [2026-04-16 14:41:36 GMT+8] 网关检查：已完成（config.patch）',
            'System: 可运行：openclaw doctor --non-interactive',
            '',
            'Conversation info (untrusted metadata):',
            '```json',
            '{"message_id":"openclaw-weixin:1776321697380-53b9b5a0","timestamp":"Thu 2026-04-16 14:25 GMT+8"}',
            '```',
            '',
            '你现在是什么模型',
          ].join('\n'),
        },
      ],
      timestamp: 1713000006,
    };

    expect(extractText(message)).toBe('你现在是什么模型');
  });

  it('hides pre-compaction memory flush prompts from user-visible text', () => {
    const message: RawMessage = {
      id: 'pre-compaction-flush-1',
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'Pre-compaction memory flush. Store durable memories only in memory/2026-04-15.md (create memory/ if needed).',
            'Treat workspace bootstrap/reference files such as MEMORY.md, SOUL.md, TOOLS.md, and AGENTS.md as read-only during this flush; never overwrite, replace, or edit them.',
            'If memory/2026-04-15.md already exists, APPEND new content only and do not overwrite existing entries.',
            'Do NOT create timestamped variant files (e.g., 2026-04-15-HHMM.md); always use the canonical 2026-04-15.md filename.',
            'If nothing to store, reply with NO_REPLY.',
            'Current time: Wednesday, April 15th, 2026 - 17:57 (Etc/GMT-8)',
          ].join('\n'),
        },
      ],
      timestamp: 1713000003,
    };

    expect(extractText(message)).toBe('');
  });
});
