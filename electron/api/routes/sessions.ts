import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'node:path';
import { getOpenClawConfigDir } from '../../utils/paths';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

const SESSION_NAME_MAX_CHARS = 30;
const TRANSCRIPT_TAIL_CHUNK_BYTES = 64 * 1024;
const SESSION_HISTORY_MAX_LIMIT = 1_000;
const CONVERSATION_INFO_PREFIX_RE = /^Conversation info\s*\([^)]*\):/i;
const SENDER_METADATA_PREFIX_RE = /^Sender(?: \(untrusted metadata\))?:\s*```[a-z]*\s*[\s\S]*?```\s*/i;
const SENDER_METADATA_JSON_PREFIX_RE = /^Sender(?: \(untrusted metadata\))?:\s*\{[\s\S]*?\}\s*/i;
const GATEWAY_TIMESTAMP_PREFIX_RE = /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i;

function isPreCompactionMemoryFlushPrompt(text: string): boolean {
  const normalized = text.trim();
  return /^Pre-compaction memory flush\./i.test(normalized)
    && /Store durable memories only in memory\//i.test(normalized)
    && /reply with NO_REPLY\./i.test(normalized);
}

function countUnicodeChars(value: string): number {
  return Array.from(value).length;
}

function truncateUnicode(value: string, maxChars: number): string {
  return Array.from(value).slice(0, maxChars).join('');
}

function isValidSessionKey(sessionKey: string): boolean {
  return !!sessionKey && sessionKey.startsWith('agent:');
}

function getSessionPaths(sessionKey: string): { agentId: string; sessionsDir: string; sessionsJsonPath: string } | null {
  if (!isValidSessionKey(sessionKey)) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 3) return null;
  const agentId = parts[1];
  const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
  const sessionsJsonPath = join(sessionsDir, 'sessions.json');
  return { agentId, sessionsDir, sessionsJsonPath };
}

type SessionStoreIndex = {
  document: Record<string, unknown>;
  entries: Record<string, Record<string, unknown>>;
  raw: string;
  recoveredFromMalformed: boolean;
};

function skipJsonWhitespace(raw: string, index: number): number {
  let cursor = index;
  while (cursor < raw.length && /\s/.test(raw[cursor] ?? '')) {
    cursor += 1;
  }
  return cursor;
}

function readJsonStringEnd(raw: string, start: number): number | null {
  if ((raw[start] ?? '') !== '"') return null;
  let escaped = false;
  for (let index = start + 1; index < raw.length; index += 1) {
    const char = raw[index] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      return index + 1;
    }
  }
  return null;
}

function findJsonValueEnd(raw: string, start: number): number | null {
  const first = raw[start] ?? '';
  if (!first) return null;

  if (first === '"') {
    return readJsonStringEnd(raw, start);
  }

  if (first === '{' || first === '[') {
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index] ?? '';
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') {
        braceDepth += 1;
        continue;
      }
      if (char === '}') {
        braceDepth -= 1;
      } else if (char === '[') {
        bracketDepth += 1;
        continue;
      } else if (char === ']') {
        bracketDepth -= 1;
      }

      if (braceDepth === 0 && bracketDepth === 0) {
        return index + 1;
      }
    }
    return null;
  }

  let cursor = start;
  while (cursor < raw.length) {
    const char = raw[cursor] ?? '';
    if (char === ',' || char === '}' || char === ']') {
      break;
    }
    cursor += 1;
  }
  return cursor;
}

function indexSessionEntriesFromParsedJson(sessionsJson: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const entries: Record<string, Record<string, unknown>> = {};

  if (Array.isArray(sessionsJson.sessions)) {
    for (const session of sessionsJson.sessions as Array<Record<string, unknown>>) {
      const sessionKey = typeof session.key === 'string'
        ? session.key
        : (typeof session.sessionKey === 'string' ? session.sessionKey : '');
      if (!isValidSessionKey(sessionKey)) continue;
      entries[sessionKey] = {
        ...session,
        key: sessionKey,
      };
    }
    return entries;
  }

  for (const [sessionKey, entry] of Object.entries(sessionsJson)) {
    if (!isValidSessionKey(sessionKey)) continue;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    entries[sessionKey] = {
      ...(entry as Record<string, unknown>),
      key: sessionKey,
    };
  }

  return entries;
}

function extractSessionEntriesFromMalformedStore(raw: string): Record<string, Record<string, unknown>> {
  const entries: Record<string, Record<string, unknown>> = {};
  let cursor = skipJsonWhitespace(raw, 0);
  if ((raw[cursor] ?? '') !== '{') return entries;
  cursor += 1;

  while (cursor < raw.length) {
    cursor = skipJsonWhitespace(raw, cursor);
    if ((raw[cursor] ?? '') === ',') {
      cursor += 1;
      continue;
    }
    if ((raw[cursor] ?? '') === '}') {
      break;
    }

    const keyStart = cursor;
    const keyEnd = readJsonStringEnd(raw, keyStart);
    if (keyEnd == null) {
      break;
    }

    let sessionKey = '';
    try {
      sessionKey = JSON.parse(raw.slice(keyStart, keyEnd)) as string;
    } catch {
      cursor = keyEnd;
      continue;
    }

    cursor = skipJsonWhitespace(raw, keyEnd);
    if ((raw[cursor] ?? '') !== ':') {
      cursor = keyEnd;
      continue;
    }

    cursor = skipJsonWhitespace(raw, cursor + 1);
    const valueStart = cursor;
    const valueEnd = findJsonValueEnd(raw, valueStart);
    if (valueEnd == null || valueEnd <= valueStart) {
      break;
    }

    if (isValidSessionKey(sessionKey)) {
      try {
        const parsedEntry = JSON.parse(raw.slice(valueStart, valueEnd)) as Record<string, unknown>;
        if (parsedEntry && typeof parsedEntry === 'object' && !Array.isArray(parsedEntry)) {
          entries[sessionKey] = {
            ...parsedEntry,
            key: sessionKey,
          };
        }
      } catch {
        // Skip malformed entries and keep recovering subsequent sessions.
      }
    }

    cursor = valueEnd;
  }

  return entries;
}

function sanitizeSessionStoreEntryForObjectMap(
  sessionKey: string,
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const normalizedEntry = { ...entry };
  if (normalizedEntry.key === sessionKey) {
    delete normalizedEntry.key;
  }
  return normalizedEntry;
}

function buildSessionStoreDocumentFromEntries(
  entries: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entries).map(([sessionKey, entry]) => [
      sessionKey,
      sanitizeSessionStoreEntryForObjectMap(sessionKey, entry),
    ]),
  );
}

async function writeSessionStoreDocument(
  sessionsJsonPath: string,
  sessionsJson: Record<string, unknown>,
): Promise<void> {
  const fsP = await import('node:fs/promises');
  const nextRaw = `${JSON.stringify(sessionsJson, null, 2)}\n`;
  const tempPath = `${sessionsJsonPath}.tmp-${process.pid}-${Date.now()}`;
  await fsP.writeFile(tempPath, nextRaw, 'utf8');
  try {
    await fsP.rename(tempPath, sessionsJsonPath);
  } catch {
    await fsP.writeFile(sessionsJsonPath, nextRaw, 'utf8');
    try {
      await fsP.unlink(tempPath);
    } catch {
      // ignore temp cleanup failures after fallback write
    }
  }
}

async function repairRecoveredSessionStore(
  sessionsJsonPath: string,
  index: SessionStoreIndex,
): Promise<void> {
  if (!index.recoveredFromMalformed || Object.keys(index.entries).length === 0) {
    return;
  }

  const fsP = await import('node:fs/promises');
  const backupPath = `${sessionsJsonPath}.malformed.bak`;

  try {
    await fsP.writeFile(backupPath, index.raw, 'utf8');
  } catch {
    // ignore backup failures and still try to rewrite a healthy sessions index
  }

  await writeSessionStoreDocument(sessionsJsonPath, index.document);
}

async function loadSessionStoreIndex(
  sessionsJsonPath: string,
  options?: {
    repairRecovered?: boolean;
  },
): Promise<SessionStoreIndex> {
  const fsP = await import('node:fs/promises');
  let raw = '';
  try {
    raw = await fsP.readFile(sessionsJsonPath, 'utf8');
  } catch {
    return {
      document: {},
      entries: {},
      raw: '',
      recoveredFromMalformed: false,
    };
  }

  try {
    const sessionsJson = JSON.parse(raw) as Record<string, unknown>;
    if (!sessionsJson || typeof sessionsJson !== 'object' || Array.isArray(sessionsJson)) {
      return {
        document: {},
        entries: {},
        raw,
        recoveredFromMalformed: false,
      };
    }
    return {
      document: sessionsJson,
      entries: indexSessionEntriesFromParsedJson(sessionsJson),
      raw,
      recoveredFromMalformed: false,
    };
  } catch {
    const recoveredEntries = extractSessionEntriesFromMalformedStore(raw);
    const recoveredIndex = {
      document: buildSessionStoreDocumentFromEntries(recoveredEntries),
      entries: recoveredEntries,
      raw,
      recoveredFromMalformed: true,
    } satisfies SessionStoreIndex;

    if (options?.repairRecovered) {
      await repairRecoveredSessionStore(sessionsJsonPath, recoveredIndex);
    }

    return recoveredIndex;
  }
}

async function loadMutableSessionStoreDocument(
  sessionsJsonPath: string,
): Promise<SessionStoreIndex> {
  const index = await loadSessionStoreIndex(sessionsJsonPath, { repairRecovered: true });
  if (index.recoveredFromMalformed) {
    return {
      ...index,
      document: buildSessionStoreDocumentFromEntries(index.entries),
    };
  }
  return index;
}

function parsePinnedMetadata(session: Record<string, unknown>): { pinned?: boolean; pinOrder?: number } {
  const pinned = session.pinned === true ? true : undefined;
  const pinOrder = typeof session.pinOrder === 'number' && Number.isFinite(session.pinOrder)
    ? Math.max(1, Math.trunc(session.pinOrder))
    : undefined;
  return { pinned, pinOrder };
}

function resolveSessionTranscriptPathFromEntry(
  sessionsDir: string,
  entry: Record<string, unknown> | null,
): string | null {
  if (!entry) return null;
  let transcriptFileName: string | undefined;
  let resolvedPath: string | undefined;

  const absolutePath = (entry.sessionFile ?? entry.file ?? entry.fileName ?? entry.path) as string | undefined;
  if (absolutePath) {
    if (absolutePath.startsWith('/') || /^[A-Za-z]:\\/.test(absolutePath)) {
      resolvedPath = absolutePath;
    } else {
      transcriptFileName = absolutePath;
    }
  }

  if (!transcriptFileName && !resolvedPath) {
    const sessionId = (entry.id ?? entry.sessionId) as string | undefined;
    if (sessionId) {
      transcriptFileName = sessionId.endsWith('.jsonl') ? sessionId : `${sessionId}.jsonl`;
    }
  }

  if (!resolvedPath) {
    if (!transcriptFileName) return null;
    resolvedPath = join(sessionsDir, transcriptFileName.endsWith('.jsonl') ? transcriptFileName : `${transcriptFileName}.jsonl`);
  }

  return resolvedPath;
}

function normalizeSessionUpdatedAt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function buildLocalSessionRow(sessionKey: string, entry: Record<string, unknown>): Record<string, unknown> {
  const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : undefined;
  const displayName = typeof entry.displayName === 'string' && entry.displayName.trim()
    ? entry.displayName.trim()
    : (typeof entry.subject === 'string' && entry.subject.trim() ? entry.subject.trim() : undefined);
  const updatedAt = normalizeSessionUpdatedAt(entry.updatedAt ?? entry.lastUpdatedAt ?? entry.createdAt);
  const modelProvider = typeof entry.modelProvider === 'string' && entry.modelProvider.trim()
    ? entry.modelProvider.trim()
    : (typeof entry.providerOverride === 'string' && entry.providerOverride.trim() ? entry.providerOverride.trim() : undefined);
  const model = typeof entry.model === 'string' && entry.model.trim()
    ? entry.model.trim()
    : (typeof entry.modelOverride === 'string' && entry.modelOverride.trim() ? entry.modelOverride.trim() : undefined);
  const thinkingLevel = typeof entry.thinkingLevel === 'string' && entry.thinkingLevel.trim()
    ? entry.thinkingLevel.trim()
    : undefined;

  return {
    key: sessionKey,
    ...(label ? { label } : {}),
    ...(displayName ? { displayName } : {}),
    ...(typeof updatedAt === 'number' ? { updatedAt } : {}),
    ...(modelProvider ? { modelProvider } : {}),
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...parsePinnedMetadata(entry),
  };
}

function stripInjectedConversationInfo(text: string): string {
  if (!CONVERSATION_INFO_PREFIX_RE.test(text)) {
    return text;
  }

  const withoutConversationInfo = text
    .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '');

  return withoutConversationInfo.replace(/^Execution playbook:\s*(?:\r?\n- .*)+\s*/i, '');
}

function cleanUserMessageText(text: string): string {
  const cleaned = stripInjectedConversationInfo(text
    .replace(SENDER_METADATA_PREFIX_RE, '')
    .replace(SENDER_METADATA_JSON_PREFIX_RE, '')
    .replace(/\s*\[media attached:[^\]]*\]/g, '')
    .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
    .replace(GATEWAY_TIMESTAMP_PREFIX_RE, ''))
    .trim();

  return isPreCompactionMemoryFlushPrompt(cleaned) ? '' : cleaned;
}

function extractTextFromMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const record = block as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text;
      if (typeof record.content === 'string') return record.content;
      if (typeof record.input_text === 'string') return record.input_text;
      return '';
    })
    .filter((value) => value.trim().length > 0)
    .join('\n')
    .trim();
}

async function readFirstUserMessagePreview(filePath: string): Promise<string | null> {
  const { createReadStream } = await import('node:fs');
  const { createInterface } = await import('node:readline');

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of reader) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const message = parsed?.message && typeof parsed.message === 'object'
          ? parsed.message as Record<string, unknown>
          : parsed;

        if (message?.role !== 'user') continue;
        const text = cleanUserMessageText(extractTextFromMessageContent(message.content));
        if (text) {
          return text;
        }
      } catch {
        // Ignore malformed transcript lines and keep scanning.
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return null;
}

function normalizeTranscriptTimestamp(value: unknown, fallback: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return fallback;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (typeof fallback === 'string') {
    const parsed = Date.parse(fallback);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeTranscriptMessage(parsed: Record<string, unknown>): Record<string, unknown> | null {
  const message = parsed.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null;
  }

  const record = { ...(message as Record<string, unknown>) };
  if (typeof record.id !== 'string' && typeof parsed.id === 'string') {
    record.id = parsed.id;
  }

  const timestamp = normalizeTranscriptTimestamp(record.timestamp, parsed.timestamp);
  if (typeof timestamp === 'number') {
    record.timestamp = timestamp;
  }

  return record;
}

function createCompactionMessage(parsed: Record<string, unknown>): Record<string, unknown> {
  const timestamp = normalizeTranscriptTimestamp(undefined, parsed.timestamp) ?? Date.now();
  return {
    role: 'system',
    content: [
      {
        type: 'text',
        text: 'Compaction',
      },
    ],
    timestamp,
    ...(typeof parsed.id === 'string' ? { id: parsed.id } : {}),
  };
}

function trimCarriageReturn(buffer: Buffer): Buffer {
  return buffer.length > 0 && buffer[buffer.length - 1] === 0x0D
    ? buffer.subarray(0, buffer.length - 1)
    : buffer;
}

async function readSessionHistoryTail(
  filePath: string,
  limit: number,
  initialThinkingLevel: string | null,
): Promise<{ messages: Array<Record<string, unknown>>; thinkingLevel: string | null }> {
  const fsP = await import('node:fs/promises');
  const handle = await fsP.open(filePath, 'r');

  try {
    const stat = await handle.stat();
    if (stat.size <= 0) {
      return { messages: [], thinkingLevel: initialThinkingLevel };
    }

    let remainingPosition = stat.size;
    let carry = Buffer.alloc(0);
    const messages: Array<Record<string, unknown>> = [];
    let thinkingLevel = initialThinkingLevel;

    while (remainingPosition > 0 && (messages.length < limit || !thinkingLevel)) {
      const readStart = Math.max(0, remainingPosition - TRANSCRIPT_TAIL_CHUNK_BYTES);
      const readLength = remainingPosition - readStart;
      const chunk = Buffer.alloc(readLength);
      const { bytesRead } = await handle.read(chunk, 0, readLength, readStart);
      if (bytesRead <= 0) {
        break;
      }

      const combined = Buffer.concat([chunk.subarray(0, bytesRead), carry]);
      const completeLines: Buffer[] = [];
      let lineEnd = combined.length;

      for (let index = combined.length - 1; index >= 0; index -= 1) {
        if (combined[index] !== 0x0A) continue;
        completeLines.push(trimCarriageReturn(combined.subarray(index + 1, lineEnd)));
        lineEnd = index;
      }

      if (readStart === 0) {
        completeLines.push(trimCarriageReturn(combined.subarray(0, lineEnd)));
        carry = Buffer.alloc(0);
      } else {
        carry = combined.subarray(0, lineEnd);
      }

      for (const lineBuffer of completeLines) {
        const line = lineBuffer.toString('utf8').trim();
        if (!line) continue;

        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (!thinkingLevel && parsed.type === 'thinking_level_change' && typeof parsed.thinkingLevel === 'string') {
            thinkingLevel = parsed.thinkingLevel;
          }

          if (messages.length >= limit) {
            continue;
          }

          const normalizedMessage = normalizeTranscriptMessage(parsed);
          if (normalizedMessage) {
            messages.push(normalizedMessage);
            continue;
          }

          if (parsed.type === 'compaction') {
            messages.push(createCompactionMessage(parsed));
          }
        } catch {
          // Ignore malformed transcript lines while scanning from tail.
        }
      }

      remainingPosition = readStart;
    }

    return {
      messages: messages.reverse(),
      thinkingLevel,
    };
  } finally {
    await handle.close();
  }
}

function resolveSessionMetadataEntry(
  sessionsJson: Record<string, unknown>,
  sessionKey: string,
): Record<string, unknown> | null {
  if (Array.isArray(sessionsJson.sessions)) {
    const matched = (sessionsJson.sessions as Array<Record<string, unknown>>)
      .find((session) => session.key === sessionKey || session.sessionKey === sessionKey);
    return matched ?? null;
  }

  const entry = sessionsJson[sessionKey];
  return entry && typeof entry === 'object' && !Array.isArray(entry)
    ? entry as Record<string, unknown>
    : null;
}

function updateSessionEntry(
  sessionsJson: Record<string, unknown>,
  sessionKey: string,
  updater: (session: Record<string, unknown>) => Record<string, unknown>,
): boolean {
  let found = false;

  if (Array.isArray(sessionsJson.sessions)) {
    sessionsJson.sessions = (sessionsJson.sessions as Array<Record<string, unknown>>).map((session) => {
      if (session.key !== sessionKey && session.sessionKey !== sessionKey) {
        return session;
      }
      found = true;
      return updater({
        ...session,
        key: typeof session.key === 'string' ? session.key : sessionKey,
      });
    });
    return found;
  }

  if (sessionsJson[sessionKey] != null) {
    found = true;
    const existing = sessionsJson[sessionKey];
    sessionsJson[sessionKey] = updater(
      typeof existing === 'object' && existing !== null
        ? existing as Record<string, unknown>
        : { file: existing },
    );
  }

  return found;
}

export async function handleSessionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/sessions/auto-label' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKey: string; label: string }>(req);
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey : '';
      const resolved = getSessionPaths(sessionKey);
      if (!resolved) {
        sendJson(res, 400, { success: false, error: `Invalid sessionKey: ${sessionKey}` });
        return true;
      }

      const rawLabel = typeof body.label === 'string' ? body.label : '';
      const normalizedLabel = truncateUnicode(rawLabel.trim(), SESSION_NAME_MAX_CHARS);
      if (!normalizedLabel) {
        sendJson(res, 400, { success: false, error: 'Session label cannot be empty' });
        return true;
      }

      const sessionsIndex = await loadMutableSessionStoreDocument(resolved.sessionsJsonPath);
      const sessionsJson = sessionsIndex.document;
      const existingEntry = resolveSessionMetadataEntry(sessionsJson, sessionKey);
      if (!existingEntry) {
        sendJson(res, 404, { success: false, error: `Session not found: ${sessionKey}` });
        return true;
      }

      const existingLabel = typeof existingEntry.label === 'string' ? existingEntry.label.trim() : '';
      if (existingLabel) {
        sendJson(res, 200, {
          success: true,
          label: existingLabel,
          persisted: false,
        });
        return true;
      }

      const found = updateSessionEntry(
        sessionsJson,
        sessionKey,
        (session) => ({
          ...session,
          label: normalizedLabel,
        }),
      );

      if (!found) {
        sendJson(res, 404, { success: false, error: `Session not found: ${sessionKey}` });
        return true;
      }

      await writeSessionStoreDocument(resolved.sessionsJsonPath, sessionsJson);
      sendJson(res, 200, {
        success: true,
        label: normalizedLabel,
        persisted: true,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/sessions/rename' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKey: string; label: string }>(req);
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey : '';
      const resolved = getSessionPaths(sessionKey);
      if (!resolved) {
        sendJson(res, 400, { success: false, error: `Invalid sessionKey: ${sessionKey}` });
        return true;
      }

      const rawLabel = typeof body.label === 'string' ? body.label : '';
      const trimmed = rawLabel.trim();
      if (!trimmed) {
        sendJson(res, 400, { success: false, error: 'Session label cannot be empty' });
        return true;
      }
      if (countUnicodeChars(trimmed) > SESSION_NAME_MAX_CHARS) {
        sendJson(res, 400, { success: false, error: `Session label cannot exceed ${SESSION_NAME_MAX_CHARS} characters` });
        return true;
      }

      const sessionsIndex = await loadMutableSessionStoreDocument(resolved.sessionsJsonPath);
      const sessionsJson = sessionsIndex.document;
      const found = updateSessionEntry(
        sessionsJson,
        sessionKey,
        (session) => ({
          ...session,
          label: truncateUnicode(trimmed, SESSION_NAME_MAX_CHARS),
        }),
      );

      if (!found) {
        sendJson(res, 404, { success: false, error: `Session not found: ${sessionKey}` });
        return true;
      }

      await writeSessionStoreDocument(resolved.sessionsJsonPath, sessionsJson);
      sendJson(res, 200, { success: true, label: truncateUnicode(trimmed, SESSION_NAME_MAX_CHARS) });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/sessions/pin' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKey: string; pinned: boolean; pinOrder?: number }>(req);
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey : '';
      const resolved = getSessionPaths(sessionKey);
      if (!resolved) {
        sendJson(res, 400, { success: false, error: `Invalid sessionKey: ${sessionKey}` });
        return true;
      }

      const pinned = body.pinned === true;
      const pinOrder = typeof body.pinOrder === 'number' && Number.isFinite(body.pinOrder)
        ? Math.max(1, Math.trunc(body.pinOrder))
        : undefined;

      const sessionsIndex = await loadMutableSessionStoreDocument(resolved.sessionsJsonPath);
      const sessionsJson = sessionsIndex.document;

      const found = updateSessionEntry(
        sessionsJson,
        sessionKey,
        (session) => {
          const nextSession = { ...session };
          if (pinned) {
            nextSession.pinned = true;
            nextSession.pinOrder = pinOrder ?? 1;
          } else {
            delete nextSession.pinned;
            delete nextSession.pinOrder;
          }
          return nextSession;
        },
      );

      if (!found) {
        sendJson(res, 404, { success: false, error: `Session not found: ${sessionKey}` });
        return true;
      }

      await writeSessionStoreDocument(resolved.sessionsJsonPath, sessionsJson);
      sendJson(res, 200, { success: true, pinned, pinOrder: pinned ? pinOrder ?? 1 : undefined });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/sessions/list' && req.method === 'GET') {
    try {
      const fsP = await import('node:fs/promises');
      const agentsRoot = join(getOpenClawConfigDir(), 'agents');
      const sessions = new Map<string, Record<string, unknown>>();

      try {
        const agentDirs = await fsP.readdir(agentsRoot, { withFileTypes: true }) as Array<{
          name: string;
          isDirectory: () => boolean;
        }>;
        for (const agentDir of agentDirs) {
          if (!agentDir.isDirectory()) continue;
          const sessionsDir = join(agentsRoot, agentDir.name, 'sessions');
          const sessionsJsonPath = join(sessionsDir, 'sessions.json');
          const index = await loadSessionStoreIndex(sessionsJsonPath, { repairRecovered: true });

          for (const [sessionKey, entry] of Object.entries(index.entries)) {
            const transcriptPath = resolveSessionTranscriptPathFromEntry(sessionsDir, entry);
            if (transcriptPath) {
              try {
                await fsP.access(transcriptPath);
              } catch {
                const deletedTranscriptPath = transcriptPath.endsWith('.jsonl')
                  ? transcriptPath.replace(/\.jsonl$/i, '.deleted.jsonl')
                  : `${transcriptPath}.deleted.jsonl`;
                try {
                  await fsP.access(deletedTranscriptPath);
                  continue;
                } catch {
                  // Keep the session row if the transcript is simply missing.
                }
              }
            }

            sessions.set(sessionKey, buildLocalSessionRow(sessionKey, entry));
          }
        }
      } catch {
        sendJson(res, 200, { success: true, sessions: [] });
        return true;
      }

      sendJson(res, 200, {
        success: true,
        sessions: Array.from(sessions.values()).sort((left, right) => {
          const leftUpdatedAt = normalizeSessionUpdatedAt(left.updatedAt) ?? 0;
          const rightUpdatedAt = normalizeSessionUpdatedAt(right.updatedAt) ?? 0;
          return rightUpdatedAt - leftUpdatedAt;
        }),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/sessions/metadata' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKeys?: string[] }>(req);
      const sessionKeys = Array.isArray(body.sessionKeys)
        ? body.sessionKeys.filter((value): value is string => typeof value === 'string' && value.startsWith('agent:'))
        : [];

      const metadata: Record<string, { pinned?: boolean; pinOrder?: number }> = {};
      const sessionsByPath = new Map<string, string[]>();

      for (const sessionKey of sessionKeys) {
        const resolved = getSessionPaths(sessionKey);
        if (!resolved) continue;
        const current = sessionsByPath.get(resolved.sessionsJsonPath) ?? [];
        current.push(sessionKey);
        sessionsByPath.set(resolved.sessionsJsonPath, current);
      }

      for (const [sessionsJsonPath, keys] of sessionsByPath.entries()) {
        const index = await loadSessionStoreIndex(sessionsJsonPath, { repairRecovered: true });
        for (const sessionKey of keys) {
          const matched = index.entries[sessionKey];
          if (matched) {
            metadata[sessionKey] = parsePinnedMetadata(matched);
          }
        }
      }

      sendJson(res, 200, { success: true, metadata });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/sessions/previews' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKeys?: string[] }>(req);
      const sessionKeys = Array.isArray(body.sessionKeys)
        ? body.sessionKeys.filter((value): value is string => typeof value === 'string' && value.startsWith('agent:'))
        : [];

      const previews: Record<string, { firstUserMessage: string | null }> = {};
      const sessionsByPath = new Map<string, { sessionsDir: string; keys: string[] }>();

      for (const sessionKey of sessionKeys) {
        const resolved = getSessionPaths(sessionKey);
        if (!resolved) continue;
        const current = sessionsByPath.get(resolved.sessionsJsonPath) ?? {
          sessionsDir: resolved.sessionsDir,
          keys: [],
        };
        current.keys.push(sessionKey);
        sessionsByPath.set(resolved.sessionsJsonPath, current);
      }

      for (const [sessionsJsonPath, { sessionsDir, keys }] of sessionsByPath.entries()) {
        const index = await loadSessionStoreIndex(sessionsJsonPath, { repairRecovered: true });

        for (const sessionKey of keys) {
          const transcriptPath = resolveSessionTranscriptPathFromEntry(sessionsDir, index.entries[sessionKey] ?? null);
          if (!transcriptPath) continue;
          try {
            previews[sessionKey] = {
              firstUserMessage: await readFirstUserMessagePreview(transcriptPath),
            };
          } catch {
            previews[sessionKey] = {
              firstUserMessage: null,
            };
          }
        }
      }

      sendJson(res, 200, { success: true, previews });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/sessions/history' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKey?: string; limit?: number }>(req);
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey : '';
      const resolved = getSessionPaths(sessionKey);
      if (!resolved) {
        sendJson(res, 400, { success: false, error: `Invalid sessionKey: ${sessionKey}` });
        return true;
      }

      const requestedLimit = typeof body.limit === 'number' && Number.isFinite(body.limit)
        ? Math.trunc(body.limit)
        : 200;
      const limit = Math.min(Math.max(requestedLimit, 1), SESSION_HISTORY_MAX_LIMIT);

      const fsP = await import('node:fs/promises');
      const index = await loadSessionStoreIndex(resolved.sessionsJsonPath, { repairRecovered: true });

      const transcriptPath = resolveSessionTranscriptPathFromEntry(
        resolved.sessionsDir,
        index.entries[sessionKey] ?? null,
      );
      if (!transcriptPath) {
        sendJson(res, 200, {
          success: true,
          resolved: false,
          messages: [],
          thinkingLevel: null,
        });
        return true;
      }

      try {
        await fsP.access(transcriptPath);
      } catch {
        sendJson(res, 200, {
          success: true,
          resolved: false,
          messages: [],
          thinkingLevel: null,
        });
        return true;
      }

      const sessionEntry = index.entries[sessionKey] ?? null;
      const initialThinkingLevel = typeof sessionEntry?.thinkingLevel === 'string'
        ? sessionEntry.thinkingLevel
        : null;
      const history = await readSessionHistoryTail(transcriptPath, limit, initialThinkingLevel);

      sendJson(res, 200, {
        success: true,
        resolved: true,
        messages: history.messages,
        thinkingLevel: history.thinkingLevel,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/sessions/delete' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKey: string }>(req);
      const sessionKey = body.sessionKey;
      const resolved = getSessionPaths(sessionKey);
      if (!resolved) {
        sendJson(res, 400, { success: false, error: `Invalid sessionKey: ${sessionKey}` });
        return true;
      }
      const fsP = await import('node:fs/promises');
      const sessionsIndex = await loadMutableSessionStoreDocument(resolved.sessionsJsonPath);
      const sessionsJson = sessionsIndex.document;

      let uuidFileName: string | undefined;
      let resolvedSrcPath: string | undefined;
      if (Array.isArray(sessionsJson.sessions)) {
        const entry = (sessionsJson.sessions as Array<Record<string, unknown>>)
          .find((s) => s.key === sessionKey || s.sessionKey === sessionKey);
        if (entry) {
          uuidFileName = (entry.file ?? entry.fileName ?? entry.path) as string | undefined;
          if (!uuidFileName && typeof entry.id === 'string') {
            uuidFileName = `${entry.id}.jsonl`;
          }
        }
      }
      if (!uuidFileName && sessionsJson[sessionKey] != null) {
        const val = sessionsJson[sessionKey];
        if (typeof val === 'string') {
          uuidFileName = val;
        } else if (typeof val === 'object' && val !== null) {
          const entry = val as Record<string, unknown>;
          const absFile = (entry.sessionFile ?? entry.file ?? entry.fileName ?? entry.path) as string | undefined;
          if (absFile) {
            if (absFile.startsWith('/') || absFile.match(/^[A-Za-z]:\\/)) {
              resolvedSrcPath = absFile;
            } else {
              uuidFileName = absFile;
            }
          } else {
            const uuidVal = (entry.id ?? entry.sessionId) as string | undefined;
            if (uuidVal) uuidFileName = uuidVal.endsWith('.jsonl') ? uuidVal : `${uuidVal}.jsonl`;
          }
        }
      }
      if (!uuidFileName && !resolvedSrcPath) {
        sendJson(res, 404, { success: false, error: `Cannot resolve file for session: ${sessionKey}` });
        return true;
      }
      if (!resolvedSrcPath) {
        if (!uuidFileName!.endsWith('.jsonl')) uuidFileName = `${uuidFileName}.jsonl`;
        resolvedSrcPath = join(resolved.sessionsDir, uuidFileName!);
      }
      const dstPath = resolvedSrcPath.replace(/\.jsonl$/, '.deleted.jsonl');
      try {
        await fsP.access(resolvedSrcPath);
        await fsP.rename(resolvedSrcPath, dstPath);
      } catch {
        // Non-fatal; still try to update sessions.json.
      }
      const repairedIndex = await loadMutableSessionStoreDocument(resolved.sessionsJsonPath);
      const json2 = repairedIndex.document;
      if (Array.isArray(json2.sessions)) {
        json2.sessions = (json2.sessions as Array<Record<string, unknown>>)
          .filter((s) => s.key !== sessionKey && s.sessionKey !== sessionKey);
      } else if (json2[sessionKey]) {
        delete json2[sessionKey];
      }
      await writeSessionStoreDocument(resolved.sessionsJsonPath, json2);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
