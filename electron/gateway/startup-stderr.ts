import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getOpenClawDir } from '../utils/paths';

export type GatewayStderrClassification = {
  level: 'drop' | 'debug' | 'warn';
  normalized: string;
};

const MAX_STDERR_LINES = 120;
const FUTURE_CONFIG_WARNING_RE =
  /Config was last written by a newer OpenClaw \(([^)]+)\); current version is ([^ ]+)\./;

let cachedLocalOpenClawVersion: string | null | undefined;

function getLocalOpenClawVersion(): string | null {
  if (cachedLocalOpenClawVersion !== undefined) {
    return cachedLocalOpenClawVersion;
  }

  try {
    const pkgPath = join(getOpenClawDir(), 'package.json');
    if (!existsSync(pkgPath)) {
      cachedLocalOpenClawVersion = null;
      return cachedLocalOpenClawVersion;
    }

    const parsed = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: unknown };
    cachedLocalOpenClawVersion = typeof parsed.version === 'string' && parsed.version.trim()
      ? parsed.version.trim()
      : null;
  } catch {
    cachedLocalOpenClawVersion = null;
  }

  return cachedLocalOpenClawVersion;
}

export function classifyGatewayStderrMessage(message: string): GatewayStderrClassification {
  const msg = message.trim();
  if (!msg) {
    return { level: 'drop', normalized: msg };
  }

  // Known noisy lines that are not actionable for Gateway lifecycle debugging.
  if (msg.includes('openclaw-control-ui') && msg.includes('token_mismatch')) {
    return { level: 'drop', normalized: msg };
  }
  if (msg.includes('closed before connect') && msg.includes('token mismatch')) {
    return { level: 'drop', normalized: msg };
  }
  if (msg.includes('[ws] closed before connect') && msg.includes('code=1005')) {
    return { level: 'debug', normalized: msg };
  }
  if (msg.includes('security warning: dangerous config flags enabled')) {
    return { level: 'debug', normalized: msg };
  }

  // Downgrade frequent non-fatal noise.
  if (msg.includes('ExperimentalWarning')) return { level: 'debug', normalized: msg };
  if (msg.includes('DeprecationWarning')) return { level: 'debug', normalized: msg };
  if (msg.includes('Debugger attached')) return { level: 'debug', normalized: msg };

  // Gateway config warnings (e.g. stale plugin entries) are informational, not actionable.
  if (msg.includes('Config warnings:')) return { level: 'debug', normalized: msg };

  // In dev on Electron UtilityProcess, OpenClaw can occasionally report an
  // older embedded version while the config was just written by the same local
  // package version on disk. Keep that false-positive out of the main warning
  // stream, but preserve real cross-version mismatches.
  const futureConfigMatch = msg.match(FUTURE_CONFIG_WARNING_RE);
  if (futureConfigMatch) {
    const [, touchedVersion, reportedCurrentVersion] = futureConfigMatch;
    const localVersion = getLocalOpenClawVersion();
    if (localVersion && touchedVersion === localVersion && reportedCurrentVersion !== localVersion) {
      return { level: 'debug', normalized: msg };
    }
  }

  // Electron restricts NODE_OPTIONS in packaged apps; this is expected and harmless.
  if (msg.includes('node: --require is not allowed in NODE_OPTIONS')) {
    return { level: 'debug', normalized: msg };
  }

  return { level: 'warn', normalized: msg };
}

export function recordGatewayStartupStderrLine(lines: string[], line: string): void {
  const normalized = line.trim();
  if (!normalized) return;
  lines.push(normalized);
  if (lines.length > MAX_STDERR_LINES) {
    lines.splice(0, lines.length - MAX_STDERR_LINES);
  }
}
