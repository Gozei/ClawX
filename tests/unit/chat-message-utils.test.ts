import { describe, expect, it } from 'vitest';
import { extractText, isInternalMaintenanceTurnUserMessage } from '@/pages/Chat/message-utils';
import type { RawMessage } from '@/stores/chat';

const FULLY_INJECTED_VISIBLE_TEXT = 'Only this sentence should be shown in chat.';

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

  it.skip('hides system exec and heartbeat maintenance noise in user messages', () => {
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

  it('hides system exec and heartbeat maintenance noise in user messages', () => {
    const message: RawMessage = {
      id: 'system-noise-1b',
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'System (untrusted): [2026-04-13 12:02:30 GMT+8] Exec completed (tidy-lob, code 0) :: long output here',
            'System (untrusted): [2026-04-13 12:03:01 GMT+8] Exec completed (nimble-d, code 1) :: stack trace here',
            '',
            'Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.',
            'When reading HEARTBEAT.md, use workspace file /Users/example/.openclaw/workspace/HEARTBEAT.md (exact case). Do not read docs/heartbeat.md.',
            'Current time: Monday, April 13th, 2026 - 12:04 (Asia/Shanghai)',
          ].join('\n'),
        },
      ],
      timestamp: 1713000000,
    };

    expect(extractText(message)).toBe('');
    expect(isInternalMaintenanceTurnUserMessage(message)).toBe(true);
  });

  it('hides async command completion heartbeat turns from user-visible chat text', () => {
    const message: RawMessage = {
      id: 'async-exec-heartbeat-1',
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'System (untrusted): [2026-04-24 11:42:02 GMT+8] Exec failed (amber-lo, signal SIGTERM) :: Resolved 24 packages in 4.22s Downloading onnxruntime (16.9MiB) Downloading magika (12.7MiB) Downloading numpy (5.0MiB)',
            '',
            'An async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.',
            '',
            '\u5f53\u524d\u65f6\u95f4\uff1aFriday, April 24th, 2026 - 11:42\uff08Asia/Shanghai\uff09',
          ].join('\n'),
        },
      ],
      timestamp: 1713920522,
    };

    expect(extractText(message)).toBe('');
    expect(isInternalMaintenanceTurnUserMessage(message)).toBe(true);
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

  it('strips AGENTS, environment, and attachment routing preludes from user-visible text', () => {
    const message: RawMessage = {
      id: 'conversation-metadata-full-prelude-1',
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            '# AGENTS.md instructions for D:/AI/Deep AI Worker/ClawX',
            '',
            '<INSTRUCTIONS>',
            'Use the repository playbook before responding.',
            '</INSTRUCTIONS>',
            '<environment_context>',
            '  <cwd>D:/AI/Deep AI Worker/ClawX</cwd>',
            '  <shell>powershell</shell>',
            '</environment_context>',
            'To send an image back, prefer the message tool (media/path/filePath). If you must inline, use MEDIA:https://example.com/image.jpg (spaces ok, quote if needed) or a safe relative path like MEDIA:./image.jpg. Absolute and ~ paths only work when they stay inside your allowed file-read boundary; host file:// URLs are blocked. Keep caption in the text body.',
            'Only the files listed in the current attachment note for this turn are newly uploaded inputs for this request. Do not automatically inspect older uploaded files, prior-turn attachments, or unrelated workspace files unless the user explicitly asks for them or the current file directly points to them.',
            'When the current turn includes uploaded attachments, resolve references like "this", "this file", "this output", "这个", "这个文件", and "这个输出" against the current turn attachment set first. Do not default those references to prior assistant outputs, earlier uploaded files, or historical workspace artifacts.',
            'This turn has exactly one uploaded attachment, so answer about that file unless the user explicitly names another file. Do not summarize prior assistant outputs when the current turn attachment set is present unless the user explicitly asks for that earlier output.',
            '',
            '[Wed 2026-04-22 19:54 GMT+8] Conversation info (untrusted metadata): ```json',
            '{"agent":{"id":"main","name":"Main Role","preferredModel":"custom-custombc/qwen3.5-plus"}}',
            '```',
            'Execution playbook:',
            '- You are currently acting as "Main Role" (ID: main).',
            '- Preferred model: custom-custombc/qwen3.5-plus',
            '- If tools are unavailable, explain the block instead of fabricating.',
            '',
            FULLY_INJECTED_VISIBLE_TEXT,
          ].join('\n'),
        },
      ],
      timestamp: 1713000008,
    };

    expect(extractText(message)).toBe(FULLY_INJECTED_VISIBLE_TEXT);
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

  it('treats localized heartbeat maintenance turns as internal', () => {
    const message: RawMessage = {
      id: 'heartbeat-zh-1',
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'System: [2026-04-16 14:41:36 GMT+8] 网关检查：已完成（config.patch）',
            '如果存在 HEARTBEAT.md（工作区上下文），请读取并严格遵循。不要根据过往对话臆测或重复旧任务。如果当前没有需要处理的事项，请回复 HEARTBEAT_OK。',
            '读取 HEARTBEAT.md 时，请使用工作区文件 C:/Users/Administrator/.openclaw/workspace/HEARTBEAT.md（注意大小写完全一致）。不要读取 docs/heartbeat.md。',
            '当前时间：Thursday, April 16th, 2026 - 16:14（Etc/GMT-8）',
          ].join('\n'),
        },
      ],
      timestamp: 1713000007,
    };

    expect(extractText(message)).toBe('');
    expect(isInternalMaintenanceTurnUserMessage(message)).toBe(true);
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
