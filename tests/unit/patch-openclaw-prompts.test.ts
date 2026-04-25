import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

describe('patchOpenClawPrompts', () => {
  let tempRoot = '';

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = '';
    }
  });

  it('patches runtime bundles to preserve visible user text separately from compiled prompts', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'clawx-openclaw-patch-'));
    const distDir = join(tempRoot, 'dist');
    await mkdir(distDir, { recursive: true });

    const files = new Map<string, string>([
      ['strip-inbound-meta-test.js', [
        'const LEADING_TIMESTAMP_PREFIX_RE = /^\\[[A-Za-z]{3} \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}[^\\]]*\\] */;',
        'const SENTINEL_FAST_RE = new RegExp([...INBOUND_META_SENTINELS, UNTRUSTED_CONTEXT_HEADER].map((s) => s.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")).join("|"));',
        'function isInboundMetaSentinelLine(line) {',
        '\treturn Boolean(line);',
        '}',
        'function stripInboundMetadata(text) {',
        '\tif (!text) return text;',
        '\tconst withoutTimestamp = text.replace(LEADING_TIMESTAMP_PREFIX_RE, "");',
        '\tif (!SENTINEL_FAST_RE.test(withoutTimestamp)) return withoutTimestamp;',
        '\tconst strippedLeadingPrefixLines = stripActiveMemoryPromptPrefixBlocks(withoutTimestamp.split("\\n"));',
        '\treturn strippedLeadingPrefixLines.join("\\n");',
        '}',
        'function stripLeadingInboundMetadata(text) {',
        '\tif (!text || !SENTINEL_FAST_RE.test(text)) return text;',
        '\tconst lines = stripActiveMemoryPromptPrefixBlocks(text.split("\\n"));',
        '\treturn lines.join("\\n");',
        '}',
      ].join('\n')],
      ['chat-test.js', [
        'import { n as stripInboundMetadata } from "./strip-inbound-meta-3rmrbAL9.js";',
        'function buildChatSendTranscriptMessage(params) {',
        '\tconst mediaFields = resolveChatSendTranscriptMediaFields(params.savedAttachments);',
        '\treturn {',
        '\t\trole: "user",',
        '\t\tcontent: params.message,',
        '\t\ttimestamp: params.timestamp,',
        '\t\t...mediaFields',
        '\t};',
        '}',
        'function extractTranscriptUserText(content) {',
        '\tif (typeof content === "string") return content;',
        '\tif (!Array.isArray(content)) return;',
        '\tconst textBlocks = content.map((block) => block && typeof block === "object" && "text" in block ? block.text : void 0).filter((text) => typeof text === "string");',
        '\treturn textBlocks.length > 0 ? textBlocks.join("") : void 0;',
        '}',
        'return extractTranscriptUserText(entry.message.content) === params.message;',
        'const trimmedMessage = parsedMessage.trim();',
        '\t\t\tconst commandBody = Boolean(p.thinking && trimmedMessage && !trimmedMessage.startsWith("/")) ? `/think ${p.thinking} ${parsedMessage}` : parsedMessage;',
        '\t\t\tconst messageForAgent = systemProvenanceReceipt ? [systemProvenanceReceipt, parsedMessage].filter(Boolean).join("\\n\\n") : parsedMessage;',
        '\t\t\t\tBodyForAgent: injectTimestamp(messageForAgent, timestampOptsFromConfig(cfg)),',
        '\t\t\t\tBodyForCommands: commandBody,',
        '\t\t\t\t\tmessage: buildChatSendTranscriptMessage({',
        '\t\t\t\t\t\tmessage: parsedMessage,',
        '\t\t\t\t\t\tsavedAttachments: persistedImages,',
        '\t\t\t\t\t\ttimestamp: now',
        '\t\t\t\t\t})',
        '\t\t\t\tawait rewriteChatSendUserTurnMediaPaths({',
        '\t\t\t\t\ttranscriptPath,',
        '\t\t\t\t\tsessionKey,',
        '\t\t\t\t\tmessage: parsedMessage,',
        '\t\t\t\t\tsavedAttachments: await persistedImagesPromise',
        '\t\t\t\t});',
      ].join('\n')],
      ['get-reply-test.js', [
        'const followupRun = {',
        '\t\tprompt: queuedBody,',
        '\t\tmessageId: sessionCtx.MessageSidFull ?? sessionCtx.MessageSid,',
        '\t\tsummaryLine: baseBodyTrimmedRaw,',
      ].join('\n')],
      ['agent-runner.runtime-test.js', [
        '\t\t\t\t\t\t\t...runBaseParams,',
        '\t\t\t\t\t\t\tprompt: params.commandBody,',
        '\t\t\t\t\t\t\textraSystemPrompt: params.followupRun.run.extraSystemPrompt,',
        '\t\t\t\t\t\tconfig: runtimeConfig,',
        '\t\t\t\t\t\tskillsSnapshot: run.skillsSnapshot,',
        '\t\t\t\t\t\tprompt: queued.prompt,',
        '\t\t\t\t\t\textraSystemPrompt: run.extraSystemPrompt,',
      ].join('\n')],
      ['pi-embedded-runner-test.js', [
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
        'async function runEmbeddedPiAgent(params) {',
        '\t\t\t\t} finally {',
        '\t\t\t\t\tlog$3.debug(`embedded run prompt end: runId=${params.runId} sessionId=${params.sessionId} durationMs=${Date.now() - promptStartedAt}`);',
        '\t\t\t\t}',
        '\t\t\t\tconst wasCompactingBefore = activeSession.isCompacting;',
      ].join('\n')],
      ['attempt-execution.runtime-test.js', [
        'const promptText = params.body;',
        'return await persistTextTurnTranscript({',
        '\t\t...params,',
        '\t\tassistant: {',
        'return await persistTextTurnTranscript({',
        '\t\tbody: params.body,',
        '\t\tfinalText: replyText,',
        'const runCliWithSession = (nextCliSessionId) => runCliAgent({',
        '\t\t\tsessionId: params.sessionId,',
        '\t\t\tsessionKey: params.sessionKey,',
        '\t\t\tagentId: params.sessionAgentId,',
        '\t\t\tsessionFile: params.sessionFile,',
        '\t\t\tworkspaceDir: params.workspaceDir,',
        '\t\t\tconfig: params.cfg,',
        '\t\t\tprompt: effectivePrompt,',
        '\t\treturn runEmbeddedPiAgent({',
        '\t\t\tsessionId: params.sessionId,',
        '\t\t\tsessionKey: params.sessionKey,',
        '\t\t\tagentId: params.sessionAgentId,',
        '\t\t\tconfig: params.cfg,',
        '\t\t\tskillsSnapshot: params.skillsSnapshot,',
        '\t\t\tprompt: effectivePrompt,',
      ].join('\n')],
      ['agent-command-test.js', [
        '\t\t\t\tsessionEntry = await attemptExecutionRuntime.persistAcpTurnTranscript({',
        '\t\t\t\t\tbody,',
        '\t\t\t\t\tfinalText: finalTextRaw,',
        '\t\t\tsessionEntry = await attemptExecutionRuntime.persistCliTurnTranscript({',
        '\t\t\t\tbody,',
        '\t\t\t\tresult,',
        '\t\t\t\t\tworkspaceDir,',
        '\t\t\t\t\tbody,',
        '\t\t\t\t\tisFallbackRetry,',
      ].join('\n')],
    ]);

    await Promise.all([...files.entries()].map(async ([fileName, contents]) => {
      await writeFile(join(distDir, fileName), contents, 'utf8');
    }));

    const patchModuleUrl = pathToFileURL(join(process.cwd(), 'scripts', 'patch-openclaw-prompts.mjs')).href;
    const { patchOpenClawPrompts } = await import(/* @vite-ignore */ patchModuleUrl);
    const patchedFiles = patchOpenClawPrompts(tempRoot, () => {});
    const secondPatchedFiles = patchOpenClawPrompts(tempRoot, () => {});

    expect(patchedFiles).toBe(7);
    expect(secondPatchedFiles).toBe(0);

    const patchedChat = await readFile(join(distDir, 'chat-test.js'), 'utf8');
    expect(patchedChat).toContain('import { n as stripInboundMetadata, r as stripLeadingInboundMetadata }');
    expect(patchedChat).toContain('function resolveVisibleChatSendMessage(message)');
    expect(patchedChat).toContain('VisibleBody: visibleMessage');
    expect(patchedChat).toContain('displayMessage: visibleMessage');
    expect(patchedChat).toContain('fallbackMessage: parsedMessage');

    const patchedReply = await readFile(join(distDir, 'get-reply-test.js'), 'utf8');
    expect(patchedReply).toContain('visiblePromptText: ctx.VisibleBody ?? baseBodyTrimmedRaw');

    const patchedRunner = await readFile(join(distDir, 'agent-runner.runtime-test.js'), 'utf8');
    expect(patchedRunner).toContain('visiblePromptText: params.followupRun.visiblePromptText ?? params.commandBody');
    expect(patchedRunner).toContain('visiblePromptText: queued.visiblePromptText ?? queued.prompt');

    const patchedEmbedded = await readFile(join(distDir, 'pi-embedded-runner-test.js'), 'utf8');
    expect(patchedEmbedded).toContain('function rewriteLatestUserPromptForDisplay(params)');
    expect(patchedEmbedded).toContain('visiblePromptText: params.visiblePromptText');
    expect(patchedEmbedded).toContain('[visible-prompt-rewrite] Failed to rewrite user turn');

    const patchedAttempt = await readFile(join(distDir, 'attempt-execution.runtime-test.js'), 'utf8');
    expect(patchedAttempt).toContain('const promptText = params.visibleBody ?? params.body;');
    expect(patchedAttempt).toContain('visibleBody: params.visibleBody');
    expect(patchedAttempt).toContain('visiblePromptText: params.visibleBody ?? params.body');

    const patchedAgentCommand = await readFile(join(distDir, 'agent-command-test.js'), 'utf8');
    expect(patchedAgentCommand).toContain('visibleBody: message');

    const patchedStripMeta = await readFile(join(distDir, 'strip-inbound-meta-test.js'), 'utf8');
    expect(patchedStripMeta).toContain('const KNOWN_INBOUND_PRELUDE_RE = /Conversation info');
    expect(patchedStripMeta).toContain('function stripInjectedPreludeBlocks(text)');
    expect(patchedStripMeta).toContain('const withoutPrelude = stripInjectedPreludeBlocks(withoutTimestamp);');
    expect(patchedStripMeta.match(/function stripInjectedPreludeBlocks\(text\)/g)).toHaveLength(1);
  });
});
