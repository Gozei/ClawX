import { describe, expect, it } from 'vitest';
import {
  enrichToolResultAttachments,
  enrichCachedAttachments,
  filterMessages,
  dedupeAssistantMessages,
  normalizeAssistantStreamText,
  isInternalMessage,
  isPreCompactionMemoryFlushPrompt,
} from '@/utils/messagePipeline';
import type { RawMessage } from '@/stores/chat/types';

describe('normalizeAssistantStreamText', () => {
  it('removes markdown bold formatting', () => {
    expect(normalizeAssistantStreamText('**bold text**')).toBe('boldtext');
  });

  it('removes markdown italic formatting', () => {
    expect(normalizeAssistantStreamText('__italic text__')).toBe('italictext');
  });

  it('removes strikethrough', () => {
    expect(normalizeAssistantStreamText('~~strikethrough~~')).toBe('strikethrough');
  });

  it('removes inline code', () => {
    expect(normalizeAssistantStreamText('`inline code`')).toBe('inlinecode');
  });

  it('normalizes whitespace', () => {
    // The original function removes all whitespace
    expect(normalizeAssistantStreamText('hello    world')).toBe('helloworld');
    expect(normalizeAssistantStreamText('hello\n\n\n\nworld')).toBe('helloworld');
  });

  it('handles real streaming output', () => {
    const streaming = 'The deployment finished successfully: build →\n **release**, checksum A B C 123.';
    const final = 'The deployment finished successfully: build → release, checksum ABC123.';
    expect(normalizeAssistantStreamText(streaming)).toBe(normalizeAssistantStreamText(final));
  });
});

describe('isPreCompactionMemoryFlushPrompt', () => {
  it('returns true for memory flush prompts', () => {
    const text = 'Pre-compaction memory flush. Store durable memories only in memory/. reply with NO_REPLY.';
    expect(isPreCompactionMemoryFlushPrompt(text)).toBe(true);
  });

  it('returns false for regular messages', () => {
    expect(isPreCompactionMemoryFlushPrompt('Hello world')).toBe(false);
    expect(isPreCompactionMemoryFlushPrompt('')).toBe(false);
  });
});

describe('isInternalMessage', () => {
  it('marks system messages as internal', () => {
    expect(isInternalMessage({ role: 'system', content: 'any' })).toBe(true);
  });

  it('marks memory flush prompts as internal', () => {
    const text = 'Pre-compaction memory flush. Store durable memories only in memory/. reply with NO_REPLY.';
    expect(isInternalMessage({ role: 'user', content: text })).toBe(true);
  });

  it('marks HEARTBEAT_OK as internal', () => {
    expect(isInternalMessage({ role: 'assistant', content: 'HEARTBEAT_OK' })).toBe(true);
  });

  it('marks NO_REPLY as internal', () => {
    expect(isInternalMessage({ role: 'assistant', content: 'NO_REPLY' })).toBe(true);
  });

  it('does not mark regular messages as internal', () => {
    expect(isInternalMessage({ role: 'user', content: 'Hello world' })).toBe(false);
    expect(isInternalMessage({ role: 'assistant', content: 'I am an assistant' })).toBe(false);
  });
});

describe('filterMessages', () => {
  it('filters out system messages', () => {
    const messages: RawMessage[] = [
      { id: '1', role: 'system', content: 'System message' },
      { id: '2', role: 'user', content: 'User message' },
    ];
    const filtered = filterMessages(messages);
    expect(filtered.map((m) => m.id)).toEqual(['2']);
  });

  it('filters out toolresult messages', () => {
    const messages: RawMessage[] = [
      { id: '1', role: 'user', content: 'User message' },
      { id: '2', role: 'toolresult', content: 'Tool result' },
      { id: '3', role: 'assistant', content: 'Assistant message' },
    ];
    const filtered = filterMessages(messages);
    expect(filtered.map((m) => m.id)).toEqual(['1', '3']);
  });

  it('filters out memory flush prompts', () => {
    const text = 'Pre-compaction memory flush. Store durable memories only in memory/. reply with NO_REPLY.';
    const messages: RawMessage[] = [
      { id: '1', role: 'user', content: text },
      { id: '2', role: 'user', content: 'Real user message' },
    ];
    const filtered = filterMessages(messages);
    expect(filtered.map((m) => m.id)).toEqual(['2']);
  });
});

describe('dedupeAssistantMessages', () => {
  it('dedupes exact duplicates by text', () => {
    const messages: RawMessage[] = [
      { id: 'user-1', role: 'user', content: 'Hello' },
      { id: 'a1', role: 'assistant', content: 'Hello!' },
      { id: 'a2', role: 'assistant', content: 'Hello!' },
    ];
    const deduped = dedupeAssistantMessages(messages);
    expect(deduped).toHaveLength(2);
    // First message is kept (when text matches via normalizeAssistantStreamText)
    expect(deduped[1].id).toBe('a1');
  });

  it('dedupes whitespace-only differences', () => {
    const messages: RawMessage[] = [
      { id: 'user-1', role: 'user', content: 'Summarize deployment status.' },
      {
        id: 'assistant-history',
        role: 'assistant',
        content: [
          { type: 'text', text: 'The deployment finished successfully: build →' },
          { type: 'text', text: ' **release**, checksum A B C 123.' },
        ],
      },
      {
        id: 'assistant-live-final',
        role: 'assistant',
        content: 'The deployment finished successfully: build → release, checksum ABC123.',
      },
    ];
    const deduped = dedupeAssistantMessages(messages);
    expect(deduped).toHaveLength(2);
    // First message is kept (merges attachments from both)
    expect(deduped.map((m) => m.id)).toEqual(['user-1', 'assistant-history']);
  });

  it('dedupes prefix-only duplicates', () => {
    const messages: RawMessage[] = [
      { id: 'user-1', role: 'user', content: 'Tell me a story' },
      { id: 'a1', role: 'assistant', content: 'Once upon a time' },
      { id: 'a2', role: 'assistant', content: 'Once upon a time in a far away land...' },
    ];
    const deduped = dedupeAssistantMessages(messages);
    expect(deduped).toHaveLength(2);
    expect(deduped[1].id).toBe('a2'); // Should prefer the longer one
  });

  it('does not dedupe across user turns', () => {
    const messages: RawMessage[] = [
      { id: 'u1', role: 'user', content: 'First question' },
      { id: 'a1', role: 'assistant', content: 'Answer one' },
      { id: 'u2', role: 'user', content: 'Second question' },
      { id: 'a2', role: 'assistant', content: 'Answer one' }, // Same as a1 but after new user message
    ];
    const deduped = dedupeAssistantMessages(messages);
    expect(deduped).toHaveLength(4); // No deduplication across turns
  });

  it('merges attached files from duplicates', () => {
    const messages: RawMessage[] = [
      { id: 'user-1', role: 'user', content: 'Show me files' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Here is file 1',
        _attachedFiles: [{ fileName: 'file1.png', mimeType: 'image/png', fileSize: 100, preview: null }],
      },
      {
        id: 'a2',
        role: 'assistant',
        content: 'Here is file 1',
        _attachedFiles: [{ fileName: 'file2.pdf', mimeType: 'application/pdf', fileSize: 200, preview: null }],
      },
    ];
    const deduped = dedupeAssistantMessages(messages);
    expect(deduped).toHaveLength(2);
    expect(deduped[1]._attachedFiles).toHaveLength(2);
  });
});

describe('enrichToolResultAttachments', () => {
  it('extracts images from tool_result content', () => {
    const messages: RawMessage[] = [
      {
        id: 'tool-1',
        role: 'toolresult',
        content: [
          {
            type: 'tool_result',
            name: 'read_image',
            content: 'base64data==',
            mimeType: 'image/png',
          },
        ],
      },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Here is the image',
      },
    ];
    const { messages: enriched } = enrichToolResultAttachments(messages);
    expect(enriched[1]._attachedFiles).toBeDefined();
    expect(enriched[1]._attachedFiles).toHaveLength(1);
  });
});

describe('enrichCachedAttachments', () => {
  it('extracts media refs from message text', () => {
    const messages: RawMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'Here is your file: [media attached: /path/to/file.pdf (application/pdf)]',
      },
    ];
    const enriched = enrichCachedAttachments(messages);
    expect(enriched[0]._attachedFiles).toBeDefined();
    expect(enriched[0]._attachedFiles).toHaveLength(1);
    expect(enriched[0]._attachedFiles![0].fileName).toBe('file.pdf');
  });

  it('skips messages that already have attachments', () => {
    const messages: RawMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'Already attached',
        _attachedFiles: [{ fileName: 'existing.pdf', mimeType: 'application/pdf', fileSize: 100, preview: null }],
      },
    ];
    const enriched = enrichCachedAttachments(messages);
    expect(enriched[0]._attachedFiles).toHaveLength(1);
  });
});
