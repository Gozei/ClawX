import { describe, expect, it } from 'vitest';
import {
  collectToolUpdates,
  createAssistantDeltaSnapshot,
  shouldContinueAssistantDelta,
  upsertToolStatuses,
} from '@/stores/chat/helpers';

describe('chat tool status merging', () => {
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
