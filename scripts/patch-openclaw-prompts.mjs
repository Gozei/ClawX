import fs from 'node:fs';
import path from 'node:path';

const SESSION_RESET_PROMPT_EN = 'A new session was started via /new or /reset. Run your Session Startup sequence - read the required files before responding to the user. Then greet the user in your configured persona, if one is provided. Be yourself - use your defined voice, mannerisms, and mood. Keep it to 1-3 sentences and ask what they want to do. If the runtime model differs from default_model in the system prompt, mention the default model. Do not mention internal steps, files, tools, or reasoning.';
const SESSION_RESET_PROMPT_ZH = '已开启新会话。完成启动准备后，简短问候用户，并询问接下来要做什么。回复控制在 1 到 3 句，不要提及内部过程。';

const HEARTBEAT_PROMPT_EN = 'Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.';
const HEARTBEAT_PROMPT_ZH = '如果存在 HEARTBEAT.md（工作区上下文），请读取并严格遵循。不要根据过往对话臆测或重复旧任务。如果当前没有需要处理的事项，请回复 HEARTBEAT_OK。';

function patchFileText(filePath, replacer) {
  if (!fs.existsSync(filePath)) return false;
  const original = fs.readFileSync(filePath, 'utf8');
  const next = replacer(original);
  if (next === original) return false;
  fs.writeFileSync(filePath, next, 'utf8');
  return true;
}

function patchHashedDistFile(distDir, prefix, replacer) {
  if (!fs.existsSync(distDir)) return 0;
  let count = 0;
  for (const fileName of fs.readdirSync(distDir)) {
    if (!fileName.startsWith(prefix) || !fileName.endsWith('.js')) continue;
    if (patchFileText(path.join(distDir, fileName), replacer)) count += 1;
  }
  return count;
}

function patchStripInboundMeta(text) {
  const preludeConstBlock = [
    'const GATEWAY_TIMESTAMP_PREFIX_RE = /^\\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\s+\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}\\s+[^\\]]+\\]\\s*/i;',
    'const KNOWN_INBOUND_PRELUDE_RE = /Conversation info\\s*\\([^)]*\\):|Execution playbook:|Sender(?: \\(untrusted metadata\\))?:|#\\s*AGENTS\\.md instructions\\b|<INSTRUCTIONS>|<environment_context>|\\[media attached(?:\\s+\\d+\\/\\d+)?:|To send an image back, prefer the message tool \\(media\\/path\\/filePath\\)\\.|Only the files listed in the current attachment note for this turn are newly uploaded inputs for this request\\.|When the current turn includes uploaded attachments, resolve references like "this"|This turn has (?:exactly )?(?:one|\\d+) uploaded attachment/i;',
    'const LEADING_INBOUND_BLOCK_RES = [',
    '\t/^Sender(?: \\(untrusted metadata\\))?:\\s*```[a-z]*\\s*[\\s\\S]*?```\\s*/i,',
    '\t/^Sender(?: \\(untrusted metadata\\))?:\\s*\\{[\\s\\S]*?\\}\\s*/i,',
    '\t/^(?:#\\s*AGENTS\\.md instructions[^\\n]*\\r?\\n+)?<INSTRUCTIONS>\\s*[\\s\\S]*?<\\/INSTRUCTIONS>\\s*/i,',
    '\t/^<environment_context>\\s*[\\s\\S]*?<\\/environment_context>\\s*/i,',
    '\t/^(?:\\[media attached(?:\\s+\\d+\\/\\d+)?:[^\\]]*\\]\\s*)+/i,',
    '\t/^To send an image back, prefer the message tool \\(media\\/path\\/filePath\\)\\.[\\s\\S]*?Keep caption in the text body\\.\\s*/i,',
    '\t/^Only the files listed in the current attachment note for this turn are newly uploaded inputs for this request\\.[\\s\\S]*?current file directly points to them\\.\\s*/i,',
    '\t/^When the current turn includes uploaded attachments, resolve references like "this", "this file", "this output", "这个", "这个文件", and "这个输出" against the current turn attachment set first\\.[\\s\\S]*?historical workspace artifacts\\.(?:\\s*This turn has (?:exactly )?(?:one|\\d+) uploaded attachment(?:s)?[\\s\\S]*?earlier output\\.)?\\s*/i,',
    '\t/^This turn has (?:exactly )?(?:one|\\d+) uploaded attachment(?:s)?[\\s\\S]*?earlier output\\.\\s*/i,',
    '\t/^Conversation info\\s*\\([^)]*\\):\\s*```[a-z]*\\r?\\n[\\s\\S]*?```\\s*/i,',
    '\t/^Conversation info\\s*\\([^)]*\\):\\s*\\{[\\s\\S]*?\\}\\s*/i,',
    '\t/^Execution playbook:\\s*(?:\\r?\\n- .*)+\\s*/i,',
    '];',
  ].join('\n');
  const stripPreludeHelper = [
    'function stripInjectedPreludeBlocks(text) {',
    '\tif (!text || !KNOWN_INBOUND_PRELUDE_RE.test(text)) return text;',
    '\tlet current = text;',
    '\twhile (true) {',
    '\t\tlet next = current.trimStart();',
    '\t\tnext = next.replace(GATEWAY_TIMESTAMP_PREFIX_RE, "").trimStart();',
    '\t\tfor (const pattern of LEADING_INBOUND_BLOCK_RES) {',
    '\t\t\tconst stripped = next.replace(pattern, "").trimStart();',
    '\t\t\tif (stripped !== next) next = stripped;',
    '\t\t}',
    '\t\tif (next === current) return current;',
    '\t\tcurrent = next;',
    '\t}',
    '}',
  ].join('\n');
  let next = text;
  next = next.replace(/const GATEWAY_TIMESTAMP_PREFIX_RE = [\s\S]*?const LEADING_INBOUND_BLOCK_RES = \[[\s\S]*?\];\n/g, '');
  next = next.replace(
    /const LEADING_TIMESTAMP_PREFIX_RE = [^\n]+;\n/,
    (match) => `${match}${preludeConstBlock}\n`,
  );
  next = next.replace(/function stripInjectedPreludeBlocks\(text\) {[\s\S]*?\n}\n/g, '');
  const sentinelAndPreludeBlock =
    'const SENTINEL_FAST_RE = new RegExp([...INBOUND_META_SENTINELS, UNTRUSTED_CONTEXT_HEADER].map((s) => s.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")).join("|"));\n'
    + `${stripPreludeHelper}\n`
    + 'function isInboundMetaSentinelLine';
  next = next.replace(
    /const SENTINEL_FAST_RE = [\s\S]*?function isInboundMetaSentinelLine/,
    () => sentinelAndPreludeBlock,
  );
  next = next.replace(
    'const withoutTimestamp = text.replace(LEADING_TIMESTAMP_PREFIX_RE, "");\n\tif (!SENTINEL_FAST_RE.test(withoutTimestamp)) return withoutTimestamp;\n\tconst strippedLeadingPrefixLines = stripActiveMemoryPromptPrefixBlocks(withoutTimestamp.split("\\n"));',
    'const withoutTimestamp = text.replace(LEADING_TIMESTAMP_PREFIX_RE, "");\n\tconst withoutPrelude = stripInjectedPreludeBlocks(withoutTimestamp);\n\tif (!SENTINEL_FAST_RE.test(withoutPrelude)) return withoutPrelude;\n\tconst strippedLeadingPrefixLines = stripActiveMemoryPromptPrefixBlocks(withoutPrelude.split("\\n"));',
  );
  next = next.replace(
    'function stripLeadingInboundMetadata(text) {\n\tif (!text || !SENTINEL_FAST_RE.test(text)) return text;\n\tconst lines = stripActiveMemoryPromptPrefixBlocks(text.split("\\n"));',
    'function stripLeadingInboundMetadata(text) {\n\tif (!text) return text;\n\tconst withoutPrelude = stripInjectedPreludeBlocks(text);\n\tif (!SENTINEL_FAST_RE.test(withoutPrelude)) return withoutPrelude;\n\tconst lines = stripActiveMemoryPromptPrefixBlocks(withoutPrelude.split("\\n"));',
  );
  return next;
}

function patchChatSendRuntime(text) {
  let next = text;
  next = next.replace(
    'import { n as stripInboundMetadata } from "./strip-inbound-meta-3rmrbAL9.js";',
    'import { n as stripInboundMetadata, r as stripLeadingInboundMetadata } from "./strip-inbound-meta-3rmrbAL9.js";',
  );
  next = next.replace(
    'function buildChatSendTranscriptMessage(params) {\n\tconst mediaFields = resolveChatSendTranscriptMediaFields(params.savedAttachments);\n\treturn {\n\t\trole: "user",\n\t\tcontent: params.message,\n\t\ttimestamp: params.timestamp,\n\t\t...mediaFields\n\t};\n}',
    'function buildChatSendTranscriptMessage(params) {\n\tconst mediaFields = resolveChatSendTranscriptMediaFields(params.savedAttachments);\n\treturn {\n\t\trole: "user",\n\t\tcontent: params.displayMessage,\n\t\ttimestamp: params.timestamp,\n\t\t...mediaFields\n\t};\n}',
  );
  next = next.replace(
    /function extractTranscriptUserText\(content\) {[\s\S]*?\n}\n(?:function resolveVisibleChatSendMessage\(message\) {[\s\S]*?\n}\n)*/,
    [
      'function extractTranscriptUserText(content) {',
      '\tif (typeof content === "string") return content;',
      '\tif (!Array.isArray(content)) return;',
      '\tconst textBlocks = content.map((block) => block && typeof block === "object" && "text" in block ? block.text : void 0).filter((text) => typeof text === "string");',
      '\treturn textBlocks.length > 0 ? textBlocks.join("") : void 0;',
      '}',
      'function resolveVisibleChatSendMessage(message) {',
      '\tconst stripped = stripInboundMetadata(stripLeadingInboundMetadata(message)).trim();',
      '\treturn stripped;',
      '}',
    ].join('\n') + '\n',
  );
  next = next
    .replace(
      'return extractTranscriptUserText(entry.message.content) === params.message;',
      'const messageText = extractTranscriptUserText(entry.message.content);\n\t\treturn messageText === params.message || messageText === params.fallbackMessage;',
    )
    .replace(
      'const trimmedMessage = parsedMessage.trim();\n\t\t\tconst commandBody = Boolean(p.thinking && trimmedMessage && !trimmedMessage.startsWith("/")) ? `/think ${p.thinking} ${parsedMessage}` : parsedMessage;\n\t\t\tconst messageForAgent = systemProvenanceReceipt ? [systemProvenanceReceipt, parsedMessage].filter(Boolean).join("\\n\\n") : parsedMessage;',
      'const trimmedMessage = parsedMessage.trim();\n\t\t\tconst visibleMessage = resolveVisibleChatSendMessage(parsedMessage);\n\t\t\tconst commandBody = Boolean(p.thinking && trimmedMessage && !trimmedMessage.startsWith("/")) ? `/think ${p.thinking} ${parsedMessage}` : parsedMessage;\n\t\t\tconst messageForAgent = systemProvenanceReceipt ? [systemProvenanceReceipt, parsedMessage].filter(Boolean).join("\\n\\n") : parsedMessage;',
    )
    .replace(
      '\t\t\t\tBodyForAgent: injectTimestamp(messageForAgent, timestampOptsFromConfig(cfg)),\n\t\t\t\tBodyForCommands: commandBody,',
      '\t\t\t\tBodyForAgent: injectTimestamp(messageForAgent, timestampOptsFromConfig(cfg)),\n\t\t\t\tVisibleBody: visibleMessage,\n\t\t\t\tBodyForCommands: commandBody,',
    )
    .replace(
      '\t\t\t\t\tmessage: buildChatSendTranscriptMessage({\n\t\t\t\t\t\tmessage: parsedMessage,\n\t\t\t\t\t\tsavedAttachments: persistedImages,\n\t\t\t\t\t\ttimestamp: now\n\t\t\t\t\t})',
      '\t\t\t\t\tmessage: buildChatSendTranscriptMessage({\n\t\t\t\t\t\tdisplayMessage: visibleMessage,\n\t\t\t\t\t\tsavedAttachments: persistedImages,\n\t\t\t\t\t\ttimestamp: now\n\t\t\t\t\t})',
    )
    .replace(
      '\t\t\t\tawait rewriteChatSendUserTurnMediaPaths({\n\t\t\t\t\ttranscriptPath,\n\t\t\t\t\tsessionKey,\n\t\t\t\t\tmessage: parsedMessage,\n\t\t\t\t\tsavedAttachments: await persistedImagesPromise\n\t\t\t\t});',
      '\t\t\t\tawait rewriteChatSendUserTurnMediaPaths({\n\t\t\t\t\ttranscriptPath,\n\t\t\t\t\tsessionKey,\n\t\t\t\t\tmessage: visibleMessage,\n\t\t\t\t\tfallbackMessage: parsedMessage,\n\t\t\t\t\tsavedAttachments: await persistedImagesPromise\n\t\t\t\t});',
    );
  return next;
}

function patchReplyRuntime(text) {
  return text.replace(
    'const followupRun = {\n\t\tprompt: queuedBody,\n\t\tmessageId: sessionCtx.MessageSidFull ?? sessionCtx.MessageSid,\n\t\tsummaryLine: baseBodyTrimmedRaw,',
    'const followupRun = {\n\t\tprompt: queuedBody,\n\t\tvisiblePromptText: ctx.VisibleBody ?? baseBodyTrimmedRaw,\n\t\tmessageId: sessionCtx.MessageSidFull ?? sessionCtx.MessageSid,\n\t\tsummaryLine: ctx.VisibleBody ?? baseBodyTrimmedRaw,',
  );
}

function patchAgentRunnerRuntime(text) {
  return text
    .replace(
      '\t\t\t\t\t\t\t...runBaseParams,\n\t\t\t\t\t\t\tprompt: params.commandBody,\n\t\t\t\t\t\t\textraSystemPrompt: params.followupRun.run.extraSystemPrompt,',
      '\t\t\t\t\t\t\t...runBaseParams,\n\t\t\t\t\t\t\tprompt: params.commandBody,\n\t\t\t\t\t\t\tvisiblePromptText: params.followupRun.visiblePromptText ?? params.commandBody,\n\t\t\t\t\t\t\textraSystemPrompt: params.followupRun.run.extraSystemPrompt,',
    )
    .replace(
      /config: runtimeConfig,\n(\s*)skillsSnapshot: run\.skillsSnapshot,\n\1prompt: queued\.prompt,\n\1extraSystemPrompt: run\.extraSystemPrompt,/,
      'config: runtimeConfig,\n$1skillsSnapshot: run.skillsSnapshot,\n$1prompt: queued.prompt,\n$1visiblePromptText: queued.visiblePromptText ?? queued.prompt,\n$1extraSystemPrompt: run.extraSystemPrompt,',
    );
}

function patchPiEmbeddedRunner(text) {
  return text
    .replace(
      'function backfillSessionKey(params) {\n\tconst trimmed = normalizeOptionalString(params.sessionKey);\n\tif (trimmed) return trimmed;\n\tif (!params.config || !params.sessionId) return;\n\ttry {\n\t\treturn normalizeOptionalString((normalizeOptionalString(params.agentId) ? resolveStoredSessionKeyForSessionId({\n\t\t\tcfg: params.config,\n\t\t\tsessionId: params.sessionId,\n\t\t\tagentId: params.agentId\n\t\t}) : resolveSessionKeyForRequest({\n\t\t\tcfg: params.config,\n\t\t\tsessionId: params.sessionId\n\t\t})).sessionKey);\n\t} catch (err) {\n\t\tlog$3.warn(`[backfillSessionKey] Failed to resolve sessionKey for sessionId=${redactRunIdentifier(sanitizeForLog(params.sessionId))}: ${formatErrorMessage(err)}`);\n\t\treturn;\n\t}\n}\nasync function runEmbeddedPiAgent(params) {',
      [
        'function backfillSessionKey(params) {',
        '\tconst trimmed = normalizeOptionalString(params.sessionKey);',
        '\tif (trimmed) return trimmed;',
        '\tif (!params.config || !params.sessionId) return;',
        '\ttry {',
        '\t\treturn normalizeOptionalString((normalizeOptionalString(params.agentId) ? resolveStoredSessionKeyForSessionId({',
        '\t\t\tcfg: params.config,',
        '\t\t\tsessionId: params.sessionId,',
        '\t\t\tagentId: params.agentId',
        '\t\t}) : resolveSessionKeyForRequest({',
        '\t\t\tcfg: params.config,',
        '\t\t\tsessionId: params.sessionId',
        '\t\t})).sessionKey);',
        '\t} catch (err) {',
        '\t\tlog$3.warn(`[backfillSessionKey] Failed to resolve sessionKey for sessionId=${redactRunIdentifier(sanitizeForLog(params.sessionId))}: ${formatErrorMessage(err)}`);',
        '\t\treturn;',
        '\t}',
        '}',
        'function extractUserMessageTextContent(content) {',
        '\tif (typeof content === "string") return content;',
        '\tif (!Array.isArray(content)) return "";',
        '\treturn content.map((block) => block && typeof block === "object" && "text" in block && typeof block.text === "string" ? block.text : "").filter(Boolean).join("");',
        '}',
        'function replaceUserMessageTextContent(content, nextText) {',
        '\tif (typeof content === "string") return nextText;',
        '\tif (!Array.isArray(content)) return nextText;',
        '\tconst replacement = [];',
        '\tlet replaced = false;',
        '\tfor (const block of content) {',
        '\t\tif (block && typeof block === "object" && block.type === "text") {',
        '\t\t\tif (!replaced && nextText) replacement.push({',
        '\t\t\t\t...block,',
        '\t\t\t\ttext: nextText',
        '\t\t\t});',
        '\t\t\treplaced = true;',
        '\t\t\tcontinue;',
        '\t\t}',
        '\t\treplacement.push(block);',
        '\t}',
        '\tif (!replaced && nextText) replacement.unshift({',
        '\t\ttype: "text",',
        '\t\ttext: nextText',
        '\t});',
        '\treturn replacement;',
        '}',
        'function rewriteLatestUserPromptForDisplay(params) {',
        '\tconst compiledPrompt = typeof params.compiledPrompt === "string" ? params.compiledPrompt : "";',
        '\tconst visiblePromptText = typeof params.visiblePromptText === "string" ? params.visiblePromptText : "";',
        '\tif (!compiledPrompt || compiledPrompt === visiblePromptText) return false;',
        '\tconst branch = params.sessionManager.getBranch();',
        '\tconst target = [...branch].toReversed().find((entry) => {',
        '\t\tif (entry.type !== "message" || entry.message.role !== "user") return false;',
        '\t\treturn extractUserMessageTextContent(entry.message.content) === compiledPrompt;',
        '\t});',
        '\tif (!target) return false;',
        '\treturn rewriteTranscriptEntriesInSessionManager({',
        '\t\tsessionManager: params.sessionManager,',
        '\t\treplacements: [{',
        '\t\t\tentryId: target.id,',
        '\t\t\tmessage: {',
        '\t\t\t\t...target.message,',
        '\t\t\t\tcontent: replaceUserMessageTextContent(target.message.content, visiblePromptText)',
        '\t\t\t}',
        '\t\t}]',
        '\t}).changed;',
        '}',
        'async function runEmbeddedPiAgent(params) {',
      ].join('\n'),
    )
    .replace(
      '\t\t\t\t} finally {\n\t\t\t\t\tlog$3.debug(`embedded run prompt end: runId=${params.runId} sessionId=${params.sessionId} durationMs=${Date.now() - promptStartedAt}`);\n\t\t\t\t}\n\t\t\t\tconst wasCompactingBefore = activeSession.isCompacting;',
      '\t\t\t\t} finally {\n\t\t\t\t\tlog$3.debug(`embedded run prompt end: runId=${params.runId} sessionId=${params.sessionId} durationMs=${Date.now() - promptStartedAt}`);\n\t\t\t\t}\n\t\t\t\tif (finalPromptText && params.visiblePromptText !== void 0) try {\n\t\t\t\t\trewriteLatestUserPromptForDisplay({\n\t\t\t\t\t\tsessionManager,\n\t\t\t\t\t\tcompiledPrompt: finalPromptText,\n\t\t\t\t\t\tvisiblePromptText: params.visiblePromptText\n\t\t\t\t\t});\n\t\t\t\t} catch (err) {\n\t\t\t\t\tlog$3.warn(`[visible-prompt-rewrite] Failed to rewrite user turn for ${params.sessionKey ?? params.sessionId}: ${formatErrorMessage(err)}`);\n\t\t\t\t}\n\t\t\t\tconst wasCompactingBefore = activeSession.isCompacting;',
    );
}

function patchAttemptExecutionRuntime(text) {
  let next = text
    .replace(
      'const promptText = params.body;',
      'const promptText = params.visibleBody ?? params.body;',
    )
    .replace(
      'return await persistTextTurnTranscript({\n\t\t...params,\n\t\tassistant: {',
      'return await persistTextTurnTranscript({\n\t\t...params,\n\t\tvisibleBody: params.visibleBody,\n\t\tassistant: {',
    )
    .replace(
      'return await persistTextTurnTranscript({\n\t\tbody: params.body,\n\t\tfinalText: replyText,',
      'return await persistTextTurnTranscript({\n\t\tbody: params.body,\n\t\tvisibleBody: params.visibleBody,\n\t\tfinalText: replyText,',
    );
  const eol = next.includes('\r\n') ? '\r\n' : '\n';
  const lines = next.split(eol);
  const rewritten = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    rewritten.push(line);
    const match = /^([ \t]*)prompt: effectivePrompt,$/.exec(line);
    if (!match) continue;
    const indent = match[1];
    const visiblePromptLine = `${indent}visiblePromptText: params.visibleBody ?? params.body,`;
    if ((lines[i + 1] ?? '') === visiblePromptLine) continue;
    rewritten.push(visiblePromptLine);
  }
  next = rewritten.join(eol);
  return next;
}

function patchAgentCommandRuntime(text) {
  return text
    .replace(
      '\t\t\t\tsessionEntry = await attemptExecutionRuntime.persistAcpTurnTranscript({\n\t\t\t\t\tbody,\n\t\t\t\t\tfinalText: finalTextRaw,',
      '\t\t\t\tsessionEntry = await attemptExecutionRuntime.persistAcpTurnTranscript({\n\t\t\t\t\tbody,\n\t\t\t\t\tvisibleBody: message,\n\t\t\t\t\tfinalText: finalTextRaw,',
    )
    .replace(
      '\t\t\tsessionEntry = await attemptExecutionRuntime.persistCliTurnTranscript({\n\t\t\t\tbody,\n\t\t\t\tresult,',
      '\t\t\tsessionEntry = await attemptExecutionRuntime.persistCliTurnTranscript({\n\t\t\t\tbody,\n\t\t\t\tvisibleBody: message,\n\t\t\t\tresult,',
    )
    .replace(
      '\t\t\t\t\tworkspaceDir,\n\t\t\t\t\tbody,\n\t\t\t\t\tisFallbackRetry,',
      '\t\t\t\t\tworkspaceDir,\n\t\t\t\t\tbody,\n\t\t\t\t\tvisibleBody: message,\n\t\t\t\t\tisFallbackRetry,',
    );
}

export function patchOpenClawPrompts(openclawDir, log = console.log) {
  const distDir = path.join(openclawDir, 'dist');
  if (!fs.existsSync(distDir)) return 0;

  let patchedFiles = 0;

  patchedFiles += patchHashedDistFile(distDir, 'reply-', (text) =>
    text.replace(SESSION_RESET_PROMPT_EN, SESSION_RESET_PROMPT_ZH)
  );

  patchedFiles += patchHashedDistFile(distDir, 'current-time-', (text) =>
    text.replace(
      'timeLine: `Current time: ${formattedTime} (${userTimezone}) / ${new Date(nowMs).toISOString().replace("T", " ").slice(0, 16) + " UTC"}`',
      'timeLine: `当前时间：${formattedTime}（${userTimezone}）`'
    ).replace(
      'if (!base || base.includes("Current time:")) return base;',
      'if (!base || base.includes("Current time:") || base.includes("当前时间：")) return base;'
    )
  );

  patchedFiles += patchHashedDistFile(distDir, 'restart-sentinel-', (text) =>
    text
      .replace(
        'return `Run: ${formatCliCommand("openclaw doctor --non-interactive", env)}`;',
        'return `可运行：${formatCliCommand("openclaw doctor --non-interactive", env)}`;'
      )
      .replace(
        'if (reason && reason !== message) lines.push(`Reason: ${reason}`);',
        'if (reason && reason !== message) lines.push(`原因：${reason === "not-git-install" ? "当前不是 Git 安装" : reason}`);'
      )
      .replace(
        'return `Gateway restart ${payload.kind} ${payload.status}${payload.stats?.mode ? ` (${payload.stats.mode})` : ""}`.trim();',
        'return `网关检查：${payload.status === "skipped" ? "已跳过" : payload.status === "ok" ? "已完成" : payload.status}${payload.stats?.mode ? `（${payload.stats.mode}）` : ""}`.trim();'
      )
  );

  patchedFiles += patchHashedDistFile(distDir, 'heartbeat-', (text) =>
    text.replaceAll(HEARTBEAT_PROMPT_EN, HEARTBEAT_PROMPT_ZH)
  );

  patchedFiles += patchHashedDistFile(distDir, 'heartbeat-runner-', (text) =>
    text.replace(
      'const hint = `When reading HEARTBEAT.md, use workspace file ${path.join(workspaceDir, DEFAULT_HEARTBEAT_FILENAME).replace(/\\\\/g, "/")} (exact case). Do not read docs/heartbeat.md.`;',
      'const hint = `读取 HEARTBEAT.md 时，请使用工作区文件 ${path.join(workspaceDir, DEFAULT_HEARTBEAT_FILENAME).replace(/\\\\/g, "/")}（注意大小写完全一致）。不要读取 docs/heartbeat.md。`;'
    )
  );

  patchedFiles += patchHashedDistFile(distDir, 'openclaw-root-', (text) =>
    text.replace(
      'const CORE_PACKAGE_NAMES = new Set(["openclaw"]);',
      'const CORE_PACKAGE_NAMES = new Set(["openclaw","@gozei/deepclaw"]);',
    )
  );

  patchedFiles += patchHashedDistFile(distDir, 'strip-inbound-meta-', patchStripInboundMeta);
  patchedFiles += patchHashedDistFile(distDir, 'chat-', patchChatSendRuntime);
  patchedFiles += patchHashedDistFile(distDir, 'get-reply-', patchReplyRuntime);
  patchedFiles += patchHashedDistFile(distDir, 'agent-runner.runtime-', patchAgentRunnerRuntime);
  patchedFiles += patchHashedDistFile(distDir, 'pi-embedded-runner-', patchPiEmbeddedRunner);
  patchedFiles += patchHashedDistFile(distDir, 'attempt-execution.runtime-', patchAttemptExecutionRuntime);
  patchedFiles += patchHashedDistFile(distDir, 'agent-command-', patchAgentCommandRuntime);

  if (patchedFiles > 0) {
    log(`Patched ${patchedFiles} OpenClaw prompt/runtime file(s) in ${openclawDir}`);
  }

  return patchedFiles;
}
