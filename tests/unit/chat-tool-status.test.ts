import { describe, expect, it } from 'vitest';
import { upsertToolStatuses } from '@/stores/chat/helpers';

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
});
