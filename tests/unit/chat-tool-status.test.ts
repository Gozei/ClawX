import { describe, expect, it } from 'vitest';
import {
  collectToolUpdates,
  createAssistantDeltaSnapshot,
  enrichWithCachedImages,
  enrichWithToolResultFiles,
  extractMediaRefs,
  isFailedToolResultMessage,
  shouldContinueAssistantDelta,
  upsertToolStatuses,
} from '@/stores/chat/helpers';
import type { RawMessage } from '@/stores/chat';

describe('chat tool status merging', () => {
  it('extracts all numbered media attachments with paths that contain spaces', () => {
    const refs = extractMediaRefs([
      '[media attached 1/3: D:\\AI\\Deep AI Worker\\ClawX\\uploads\\first image.png (image/png)]',
      '[media attached 2/3: D:\\AI\\Deep AI Worker\\ClawX\\uploads\\report final.docx (application/vnd.openxmlformats-officedocument.wordprocessingml.document) | D:\\AI\\Deep AI Worker\\ClawX\\uploads\\report final.docx]',
      '[media attached 3/3: C:\\Users\\Administrator\\Desktop\\slides (draft).pptx (application/vnd.openxmlformats-officedocument.presentationml.presentation)]',
    ].join('\n'));

    expect(refs).toEqual([
      {
        filePath: 'D:\\AI\\Deep AI Worker\\ClawX\\uploads\\first image.png',
        mimeType: 'image/png',
      },
      {
        filePath: 'D:\\AI\\Deep AI Worker\\ClawX\\uploads\\report final.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      {
        filePath: 'C:\\Users\\Administrator\\Desktop\\slides (draft).pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      },
    ]);
  });

  it('restores every attachment from a multi-file user history message', () => {
    const [message] = enrichWithCachedImages([
      {
        role: 'user',
        content: [
          '[media attached 1/2: D:\\AI\\Deep AI Worker\\ClawX\\uploads\\first image.png (image/png)]',
          '[media attached 2/2: D:\\AI\\Deep AI Worker\\ClawX\\uploads\\report final.pdf (application/pdf)]',
        ].join('\n'),
        timestamp: 1_700_000_000,
      },
    ]);

    expect(message?._attachedFiles).toHaveLength(2);
    expect(message?._attachedFiles?.map((file) => file.fileName)).toEqual([
      'first image.png',
      'report final.pdf',
    ]);
  });

  it('turns an error followed by a rerun into retrying and preserves the failure reason', () => {
    const merged = upsertToolStatuses(
      [
        {
          id: 'browser-1',
          toolCallId: 'browser-1',
          name: 'browser',
          status: 'error',
          summary: 'Browser launch timeout',
          failureMessage: 'Browser launch timeout',
          updatedAt: 1,
        },
      ],
      [
        {
          id: 'browser-1',
          toolCallId: 'browser-1',
          name: 'browser',
          status: 'running',
          updatedAt: 2,
        },
      ],
    );

    expect(merged).toEqual([
      expect.objectContaining({
        toolCallId: 'browser-1',
        status: 'retrying',
        retries: 1,
        failureMessage: 'Browser launch timeout',
      }),
    ]);
  });

  it('treats direct tool_result delta messages as completed terminal updates', () => {
    const updates = collectToolUpdates(
      {
        role: 'tool_result',
        toolCallId: 'browser-1',
        toolName: 'browser',
        content: 'Opened https://flights.ctrip.com/ successfully',
      },
      'delta',
    );

    expect(updates).toEqual([
      expect.objectContaining({
        toolCallId: 'browser-1',
        name: 'browser',
        status: 'completed',
      }),
    ]);
  });

  it('treats direct failed tool_result delta messages as errors', () => {
    const updates = collectToolUpdates(
      {
        role: 'toolresult',
        toolCallId: 'browser-2',
        toolName: 'browser',
        error: 'Browser launch timeout',
      },
      'delta',
    );

    expect(updates).toEqual([
      expect.objectContaining({
        toolCallId: 'browser-2',
        name: 'browser',
        status: 'error',
        failureMessage: 'Browser launch timeout',
      }),
    ]);
  });

  it('does not surface file cards from failed tool results', () => {
    const failedToolResult = {
      id: 'tool-result-1',
      role: 'toolresult',
      toolCallId: 'write-1',
      toolName: 'write_file',
      status: 'error',
      content: [
        {
          type: 'text',
          text: 'Failed to write C:\\\\tmp\\\\report.txt because the directory does not exist.',
        },
      ],
    } as RawMessage;
    const messages = enrichWithToolResultFiles([
      {
        id: 'assistant-tool-1',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'write-1',
            name: 'write_file',
            input: { file_path: 'C:\\\\tmp\\\\report.txt' },
          },
        ],
      },
      failedToolResult,
      {
        id: 'assistant-final-1',
        role: 'assistant',
        content: 'The file could not be created.',
      },
    ]);

    expect(isFailedToolResultMessage(failedToolResult)).toBe(true);
    expect(messages[2]?._attachedFiles).toBeUndefined();
  });

  it('treats tool-use plus matching tool-result deltas as one continuing streaming step', () => {
    expect(shouldContinueAssistantDelta(
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'browser-1',
            name: 'browser',
            input: { action: 'open', url: 'https://flights.ctrip.com/' },
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'browser-1',
            name: 'browser',
            input: { action: 'open', url: 'https://flights.ctrip.com/' },
          },
          {
            type: 'tool_result',
            id: 'browser-1',
            name: 'browser',
            content: 'Blocked by site policy',
          },
        ],
      },
    )).toBe(true);
  });

  it('treats cumulative assistant text containing the previous text as one streaming step', () => {
    expect(shouldContinueAssistantDelta(
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'I found the first market figures.',
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'I will research the chip market now.\n\nI found the first market figures.\n\nI am adding sources to the final answer.',
          },
        ],
      },
    )).toBe(true);
  });

  it('treats a new note replacing an earlier note as a new live stage', () => {
    expect(shouldContinueAssistantDelta(
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'The browser request hit a restriction.',
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Switching to search results now.',
          },
        ],
      },
    )).toBe(false);
  });

  it('treats a tool call replacing a prior note as a new live stage', () => {
    expect(shouldContinueAssistantDelta(
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'The browser request hit a restriction.',
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'browser-1',
            name: 'browser',
            input: { action: 'open', url: 'https://flights.ctrip.com/' },
          },
        ],
      },
    )).toBe(false);
  });

  it('builds a direct-content snapshot without duplicating tool blocks', () => {
    expect(createAssistantDeltaSnapshot(
      {
        id: 'assistant-stream-1',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'The browser request hit a restriction.',
          },
          {
            type: 'tool_use',
            id: 'browser-1',
            name: 'browser',
            input: { action: 'open', url: 'https://flights.ctrip.com/' },
          },
        ],
      },
      'assistant-stream-1-delta-snapshot',
    )).toEqual({
      id: 'assistant-stream-1-delta-snapshot',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'The browser request hit a restriction.',
        },
      ],
    });
  });
});
