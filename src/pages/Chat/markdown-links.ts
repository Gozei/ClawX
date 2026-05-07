function isValidIpv4Host(host: string): boolean {
  const octets = host.split('.');
  return octets.length === 4 && octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const value = Number(octet);
    return value >= 0 && value <= 255;
  });
}

function normalizeBareIpv4Url(href: string): string | null {
  const match = href.match(/^((?:\d{1,3}\.){3}\d{1,3})(?::\d{1,5})?(?:[/?#].*)?$/);
  if (!match || !isValidIpv4Host(match[1])) return null;

  try {
    return new URL(`http://${href}`).toString();
  } catch {
    return null;
  }
}

function normalizeBareLocalhostUrl(href: string): string | null {
  if (!/^localhost(?::\d{1,5})?(?:[/?#].*)?$/i.test(href)) return null;

  try {
    return new URL(`http://${href}`).toString();
  } catch {
    return null;
  }
}

function normalizeBareIpv6Url(href: string): string | null {
  if (!/^\[[0-9a-f:.]+\](?::\d{1,5})?(?:[/?#].*)?$/i.test(href)) return null;

  try {
    return new URL(`http://${href}`).toString();
  } catch {
    return null;
  }
}

export function normalizeExternalHttpUrl(href: string | undefined): string | null {
  if (!href) return null;

  const localUrl = normalizeBareIpv4Url(href)
    ?? normalizeBareLocalhostUrl(href)
    ?? normalizeBareIpv6Url(href);
  if (localUrl) return localUrl;

  try {
    const parsed = new URL(href);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}
