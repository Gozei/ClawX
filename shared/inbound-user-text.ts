const SYSTEM_LINE_RE = /^System(?: \(untrusted\))?:\s*(?:\[[^\]]+\]\s*)?(.*)$/i;
const GATEWAY_TIMESTAMP_PREFIX_RE = /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i;

const KNOWN_INBOUND_PRELUDE_RE =
  /Conversation info\s*\([^)]*\):|Execution playbook:|Sender(?: \(untrusted metadata\))?:|#\s*AGENTS\.md instructions\b|<INSTRUCTIONS>|<environment_context>|To send an image back, prefer the message tool \(media\/path\/filePath\)\.|Only the files listed in the current attachment note for this turn are newly uploaded inputs for this request\.|When the current turn includes uploaded attachments, resolve references like "this"|This turn has exactly (?:one|\d+) uploaded attachment/i;

const LEADING_INBOUND_BLOCK_RES = [
  /^Sender(?: \(untrusted metadata\))?:\s*```[a-z]*\s*[\s\S]*?```\s*/i,
  /^Sender(?: \(untrusted metadata\))?:\s*\{[\s\S]*?\}\s*/i,
  /^(?:#\s*AGENTS\.md instructions[^\n]*\r?\n+)?<INSTRUCTIONS>\s*[\s\S]*?<\/INSTRUCTIONS>\s*/i,
  /^<environment_context>\s*[\s\S]*?<\/environment_context>\s*/i,
  /^To send an image back, prefer the message tool \(media\/path\/filePath\)\.[\s\S]*?Keep caption in the text body\.\s*/i,
  /^Only the files listed in the current attachment note for this turn are newly uploaded inputs for this request\.[\s\S]*?current file directly points to them\.\s*/i,
  /^When the current turn includes uploaded attachments, resolve references like "this", "this file", "this output", "这个", "这个文件", and "这个输出" against the current turn attachment set first\.[\s\S]*?historical workspace artifacts\.\s*/i,
  /^This turn has exactly (?:one|\d+) uploaded attachment(?:s)?[\s\S]*?earlier output\.\s*/i,
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
