import { describe, expect, it } from 'vitest';
import { normalizeExternalHttpUrl } from '@/pages/Chat/markdown-links';

describe('markdown link normalization', () => {
  it('allows explicit http and https URLs', () => {
    expect(normalizeExternalHttpUrl('https://example.com/docs')).toBe('https://example.com/docs');
    expect(normalizeExternalHttpUrl('http://127.0.0.1:13210/status')).toBe('http://127.0.0.1:13210/status');
  });

  it('normalizes common bare local addresses to http URLs', () => {
    expect(normalizeExternalHttpUrl('192.168.1.10:3000/health')).toBe('http://192.168.1.10:3000/health');
    expect(normalizeExternalHttpUrl('localhost:13210/status')).toBe('http://localhost:13210/status');
    expect(normalizeExternalHttpUrl('[::1]:13210/status')).toBe('http://[::1]:13210/status');
  });

  it('rejects relative links, unsafe protocols, and invalid local addresses', () => {
    expect(normalizeExternalHttpUrl('./README.md')).toBeNull();
    expect(normalizeExternalHttpUrl('#usage')).toBeNull();
    expect(normalizeExternalHttpUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeExternalHttpUrl('999.1.1.1')).toBeNull();
  });
});
