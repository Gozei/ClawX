import { describe, expect, it } from 'vitest';
import { validateRawMessage, validateMessageArray } from '@/utils/messageValidation';

describe('validateRawMessage', () => {
  it('accepts a valid user message', () => {
    expect(validateRawMessage({ role: 'user', content: 'hello' })).toBe(true);
  });

  it('accepts a valid assistant message with content blocks', () => {
    expect(validateRawMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'hi' }],
    })).toBe(true);
  });

  it('accepts a valid toolresult message', () => {
    expect(validateRawMessage({ role: 'toolresult', content: 'result' })).toBe(true);
  });

  it('accepts a system message', () => {
    expect(validateRawMessage({ role: 'system', content: 'system prompt' })).toBe(true);
  });

  it('accepts null content', () => {
    expect(validateRawMessage({ role: 'user', content: null })).toBe(true);
  });

  it('accepts undefined content', () => {
    expect(validateRawMessage({ role: 'user', content: undefined })).toBe(true);
  });

  it('accepts a valid timestamp', () => {
    expect(validateRawMessage({ role: 'user', content: 'hi', timestamp: 1234567890 })).toBe(true);
  });

  it('rejects non-object input', () => {
    expect(validateRawMessage(null)).toBe(false);
    expect(validateRawMessage(undefined)).toBe(false);
    expect(validateRawMessage('string')).toBe(false);
    expect(validateRawMessage(42)).toBe(false);
  });

  it('rejects missing role', () => {
    expect(validateRawMessage({ content: 'hi' })).toBe(false);
  });

  it('rejects invalid role', () => {
    expect(validateRawMessage({ role: 'admin', content: 'hi' })).toBe(false);
  });

  it('rejects number content', () => {
    expect(validateRawMessage({ role: 'user', content: 42 })).toBe(false);
  });

  it('rejects invalid content block', () => {
    expect(validateRawMessage({
      role: 'user',
      content: [{ notAType: true }],
    })).toBe(false);
  });

  it('rejects non-number timestamp', () => {
    expect(validateRawMessage({ role: 'user', content: 'hi', timestamp: 'now' })).toBe(false);
  });
});

describe('validateMessageArray', () => {
  it('returns empty array for non-array input', () => {
    expect(validateMessageArray(null)).toEqual([]);
    expect(validateMessageArray(undefined)).toEqual([]);
    expect(validateMessageArray('string')).toEqual([]);
  });

  it('filters out invalid messages', () => {
    const data = [
      { role: 'user', content: 'valid' },
      { role: 'admin', content: 'invalid role' },
      { role: 'assistant', content: 'also valid' },
      42,
      null,
    ];
    const result = validateMessageArray(data);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
  });

  it('returns all valid messages', () => {
    const data = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'world' }] },
    ];
    const result = validateMessageArray(data);
    expect(result).toHaveLength(2);
  });
});
