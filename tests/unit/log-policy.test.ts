import { describe, expect, it } from 'vitest';
import {
  buildRotatedLogFileName,
  isLogFileExpired,
  normalizeMaxFileSizeBytes,
  normalizeRetentionDays,
} from '@electron/utils/log-policy';

describe('log policy utilities', () => {
  it('builds rotated file names with stable part suffixes', () => {
    expect(buildRotatedLogFileName('clawx', '2026-04-15', '.log', 1)).toBe('clawx-2026-04-15.log');
    expect(buildRotatedLogFileName('clawx', '2026-04-15', '.log', 3)).toBe('clawx-2026-04-15-part3.log');
  });

  it('normalizes retention and max size to safe bounds', () => {
    expect(normalizeRetentionDays(0, 14)).toBe(1);
    expect(normalizeRetentionDays(400, 14)).toBe(365);
    expect(normalizeMaxFileSizeBytes(1024, 64 * 1024 * 1024)).toBe(4 * 1024 * 1024);
  });

  it('marks old files as expired once they cross the retention window', () => {
    const now = Date.parse('2026-04-15T12:00:00.000Z');
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
    const twelveHoursAgo = now - 12 * 60 * 60 * 1000;

    expect(isLogFileExpired(twoDaysAgo, 1, now)).toBe(true);
    expect(isLogFileExpired(twelveHoursAgo, 1, now)).toBe(false);
  });
});
