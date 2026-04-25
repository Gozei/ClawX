const SYSTEM_LINE_RE = /^System(?: \(untrusted\))?:\s*(?:\[[^\]]+\]\s*)?(.*)$/i;
const GATEWAY_TIMESTAMP_PREFIX_RE = /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i;
const MEDIA_ATTACHED_NOTE_RE = /\s*\[media attached(?:\s+\d+\/\d+)?:[^\]]*\]/gi;
const MESSAGE_ID_NOTE_RE = /\s*\[message_id:\s*[^\]]+\]/gi;
const INTERNAL_ASYNC_EXEC_COMPLETION_RE =
  /^An async command you ran earlier has completed\.\s*The result is shown in the system messages above\.\s*Handle the result internally\.\s*Do not relay it to the user unless explicitly requested\.\s*$/i;
const INTERNAL_CRON_NO_CONTENT_RE =
  /^A scheduled cron event was triggered, but no event content was found\.\s*Handle this internally and reply HEARTBEAT_OK when nothing needs user-facing follow-up\.\s*$/i;
const INTERNAL_HEARTBEAT_DIRECTIVE_RES = [
  INTERNAL_ASYNC_EXEC_COMPLETION_RE,
  INTERNAL_CRON_NO_CONTENT_RE,
  /^Read HEARTBEAT\.md if it exists \(workspace context\)\./i,
  /^When reading HEARTBEAT\.md,/i,
  /^\u5982\u679c\u5b58\u5728 HEARTBEAT\.md/i,
  /^\u8bfb\u53d6 HEARTBEAT\.md \u65f6/i,
] as const;
const INTERNAL_HEARTBEAT_TRAILING_RES = [
  /^Current time:/i,
  /^\u5f53\u524d\u65f6\u95f4\uff1a/i,
] as const;
const COMPACTED_INTERNAL_BOUNDARY_RE =
  /\s+(?=(?:System(?: \(untrusted\))?:\s*(?:\[[^\]]+\]\s*)?Exec (?:completed|finished)\b|An async command you ran earlier has completed\.|A scheduled cron event was triggered, but no event content was found\.|Current time:|\u5f53\u524d\u65f6\u95f4\uff1a))/gi;

const KNOWN_INBOUND_PRELUDE_RE =
  /Conversation info\s*\([^)]*\):|Execution playbook:|Sender(?: \(untrusted metadata\))?:|#\s*AGENTS\.md instructions\b|<INSTRUCTIONS>|<environment_context>|\[media attached(?:\s+\d+\/\d+)?:|To send an image back, prefer the message tool \(media\/path\/filePath\)\.|Only the files listed in the current attachment note for this turn are newly uploaded inputs for this request\.|When the current turn includes uploaded attachments, resolve references like "this"|This turn has (?:exactly )?(?:one|\d+) uploaded attachment/i;

const LEADING_INBOUND_BLOCK_RES = [
  /^Sender(?: \(untrusted metadata\))?:\s*```[a-z]*\s*[\s\S]*?```\s*/i,
  /^Sender(?: \(untrusted metadata\))?:\s*\{[\s\S]*?\}\s*/i,
  /^(?:#\s*AGENTS\.md instructions[^\n]*\r?\n+)?<INSTRUCTIONS>\s*[\s\S]*?<\/INSTRUCTIONS>\s*/i,
  /^<environment_context>\s*[\s\S]*?<\/environment_context>\s*/i,
  /^(?:\[media attached(?:\s+\d+\/\d+)?:[^\]]*\]\s*)+/i,
  /^To send an image back, prefer the message tool \(media\/path\/filePath\)\.[\s\S]*?Keep caption in the text body\.\s*/i,
  /^Only the files listed in the current attachment note for this turn are newly uploaded inputs for this request\.[\s\S]*?current file directly points to them\.\s*/i,
  /^When the current turn includes uploaded attachments, resolve references like "this", "this file", "this output", "\u8fd9\u4e2a", "\u8fd9\u4e2a\u6587\u4ef6", and "\u8fd9\u4e2a\u8f93\u51fa" against the current turn attachment set first\.[\s\S]*?historical workspace artifacts\.(?:\s*This turn has (?:exactly )?(?:one|\d+) uploaded attachment(?:s)?[\s\S]*?earlier output\.)?\s*/i,
  /^This turn has (?:exactly )?(?:one|\d+) uploaded attachment(?:s)?[\s\S]*?earlier output\.\s*/i,
  /^Conversation info\s*\([^)]*\):\s*```[a-z]*\r?\n[\s\S]*?```\s*/i,
  /^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i,
  /^Execution playbook:\s*(?:\r?\n- .*)+\s*/i,
] as const;

function stripLeadingInjectedSystemLines(text: string): string {
  const lines = text.split(/\r?\n/);
  let index = 0;
  let sawSystemLine = false;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (SYSTEM_LINE_RE.test(line)) {
      sawSystemLine = true;
      index += 1;
      continue;
    }
    break;
  }

  if (!sawSystemLine) return text;

  const remainder = lines.slice(index).join('\n').trimStart();
  return remainder || text;
}

function isInternalHeartbeatDirectiveLine(line: string): boolean {
  return INTERNAL_HEARTBEAT_DIRECTIVE_RES.some((pattern) => pattern.test(line));
}

function isInternalHeartbeatTrailingLine(line: string): boolean {
  return INTERNAL_HEARTBEAT_TRAILING_RES.some((pattern) => pattern.test(line));
}

export function splitCompactedInternalMaintenanceLines(text: string): string {
  if (!text) return text;
  return text.replace(COMPACTED_INTERNAL_BOUNDARY_RE, '\n');
}

export function stripInboundTransportNotes(text: string): string {
  if (!text) return text;
  return text
    .replace(MEDIA_ATTACHED_NOTE_RE, '')
    .replace(MESSAGE_ID_NOTE_RE, '');
}

export function stripLeadingInternalHeartbeatMaintenance(text: string): string {
  if (!text) return text;

  const lines = splitCompactedInternalMaintenanceLines(text).split(/\r?\n/);
  let index = 0;
  let sawMaintenanceDirective = false;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    if (!sawMaintenanceDirective && SYSTEM_LINE_RE.test(line)) {
      index += 1;
      continue;
    }

    if (isInternalHeartbeatDirectiveLine(line)) {
      sawMaintenanceDirective = true;
      index += 1;
      continue;
    }

    if (sawMaintenanceDirective && isInternalHeartbeatTrailingLine(line)) {
      index += 1;
      continue;
    }

    break;
  }

  if (!sawMaintenanceDirective) {
    return text;
  }

  return lines.slice(index).join('\n').trimStart();
}

export function hasInjectedInboundPrelude(text: string): boolean {
  return KNOWN_INBOUND_PRELUDE_RE.test(text);
}

export function stripInjectedInboundPrelude(text: string): string {
  if (!text) return text;

  let current = text;

  while (true) {
    let next = current.trimStart();

    if (hasInjectedInboundPrelude(next)) {
      next = stripLeadingInjectedSystemLines(next);
    }

    next = next.replace(GATEWAY_TIMESTAMP_PREFIX_RE, '').trimStart();

    for (const pattern of LEADING_INBOUND_BLOCK_RES) {
      const stripped = next.replace(pattern, '').trimStart();
      if (stripped !== next) {
        next = stripped;
      }
    }

    if (next === current) {
      return current;
    }

    current = next;
  }
}

export function sanitizeInboundUserText(text: string): string {
  if (!text) return text;
  return stripLeadingInternalHeartbeatMaintenance(
    stripInjectedInboundPrelude(stripInboundTransportNotes(text)),
  ).trim();
}
