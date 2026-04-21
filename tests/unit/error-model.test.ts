import { describe, expect, it } from 'vitest';
import { AppError, mapBackendErrorCode, normalizeAppError } from '@/lib/error-model';

describe('error-model', () => {
  it('maps backend UNSUPPORTED to CHANNEL_UNAVAILABLE', () => {
    expect(mapBackendErrorCode('UNSUPPORTED')).toBe('CHANNEL_UNAVAILABLE');
  });

  it('normalizes auth errors into AUTH_INVALID', () => {
    const error = normalizeAppError(new Error('HTTP 401: Invalid Authentication'));
    expect(error.code).toBe('AUTH_INVALID');
  });

  it('normalizes ipc channel errors into CHANNEL_UNAVAILABLE', () => {
    const error = normalizeAppError(new Error('Invalid IPC channel: hostapi:fetch'));
    expect(error.code).toBe('CHANNEL_UNAVAILABLE');
  });

  it('normalizes pairing-required gateway failures into GATEWAY', () => {
    expect(normalizeAppError(new Error('pairing required')).code).toBe('GATEWAY');
    expect(normalizeAppError(new Error('gateway closed (1008): pairing required')).code).toBe('GATEWAY');
  });

  it('preserves AppError and merges details', () => {
    const base = new AppError('TIMEOUT', 'request timeout', undefined, { a: 1 });
    const normalized = normalizeAppError(base, { b: 2 });
    expect(normalized.code).toBe('TIMEOUT');
    expect(normalized.details).toEqual({ a: 1, b: 2 });
  });
});

