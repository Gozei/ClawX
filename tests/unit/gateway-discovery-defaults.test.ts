import { describe, expect, it } from 'vitest';
import {
  getConfiguredGatewayMdnsMode,
  shouldDisableManagedGatewayBonjour,
  summarizeManagedGatewayDiscovery,
} from '@electron/gateway/discovery-defaults';

describe('gateway discovery defaults', () => {
  it('reads explicit mdns mode from config', () => {
    expect(getConfiguredGatewayMdnsMode({
      discovery: {
        mdns: {
          mode: ' minimal ',
        },
      },
    })).toBe('minimal');
  });

  it('disables bonjour by default on Windows when mdns mode is unset', () => {
    expect(shouldDisableManagedGatewayBonjour({}, 'win32')).toBe(true);
    expect(summarizeManagedGatewayDiscovery({}, 'win32')).toBe('mdns=off(auto-windows)');
  });

  it('keeps bonjour disabled when Windows config explicitly sets mdns off', () => {
    const config = {
      discovery: {
        mdns: {
          mode: 'off',
        },
      },
    };

    expect(shouldDisableManagedGatewayBonjour(config, 'win32')).toBe(true);
    expect(summarizeManagedGatewayDiscovery(config, 'win32')).toBe('mdns=off(auto-windows)');
  });

  it('preserves explicit mdns modes on Windows', () => {
    const config = {
      discovery: {
        mdns: {
          mode: 'full',
        },
      },
    };

    expect(shouldDisableManagedGatewayBonjour(config, 'win32')).toBe(false);
    expect(summarizeManagedGatewayDiscovery(config, 'win32')).toBe('mdns=full');
  });

  it('does not force-disable bonjour on non-Windows platforms', () => {
    expect(shouldDisableManagedGatewayBonjour({}, 'darwin')).toBe(false);
    expect(summarizeManagedGatewayDiscovery({}, 'darwin')).toBe('mdns=minimal');
  });
});
