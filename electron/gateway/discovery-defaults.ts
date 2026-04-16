function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function getConfiguredGatewayMdnsMode(
  config: Record<string, unknown> | null | undefined,
): string | undefined {
  const discovery = asRecord(config?.discovery);
  const mdns = asRecord(discovery?.mdns);
  const mode = typeof mdns?.mode === 'string' ? mdns.mode.trim().toLowerCase() : '';
  return mode || undefined;
}

export function shouldDisableManagedGatewayBonjour(
  config: Record<string, unknown> | null | undefined,
  platform = process.platform,
): boolean {
  if (platform !== 'win32') {
    return false;
  }

  const mdnsMode = getConfiguredGatewayMdnsMode(config);
  return mdnsMode == null || mdnsMode === 'off';
}

export function summarizeManagedGatewayDiscovery(
  config: Record<string, unknown> | null | undefined,
  platform = process.platform,
): string {
  const mdnsMode = getConfiguredGatewayMdnsMode(config);
  if (shouldDisableManagedGatewayBonjour(config, platform)) {
    return platform === 'win32'
      ? 'mdns=off(auto-windows)'
      : 'mdns=off';
  }

  return `mdns=${mdnsMode ?? 'minimal'}`;
}
