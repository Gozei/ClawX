import { describe, expect, it } from 'vitest';
import { formatLocalDatePart, formatLocalTimestamp, normalizeTimestamp } from '@electron/utils/log-time';

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

describe('log time utilities', () => {
  it('formats local date parts using the current timezone', () => {
    const input = new Date('2026-04-15T16:23:45.678Z');
    const expected = `${input.getFullYear()}-${pad(input.getMonth() + 1)}-${pad(input.getDate())}`;
    expect(formatLocalDatePart(input)).toBe(expected);
  });

  it('formats local timestamps with timezone offsets', () => {
    const input = new Date('2026-04-15T16:23:45.678Z');
    const timestamp = formatLocalTimestamp(input);

    const localPrefix = `${input.getFullYear()}-${pad(input.getMonth() + 1)}-${pad(input.getDate())}T${pad(input.getHours())}:${pad(input.getMinutes())}:${pad(input.getSeconds())}.${pad(input.getMilliseconds(), 3)}`;
    expect(timestamp.startsWith(localPrefix)).toBe(true);
    expect(timestamp).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it('normalizes existing timestamps into epoch-aware local values', () => {
    const input = '2026-04-15T09:30:45.123+08:00';
    const normalized = normalizeTimestamp(input);

    expect(normalized.tsEpochMs).toBe(Date.parse(input));
    expect(normalized.ts).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  });
});
