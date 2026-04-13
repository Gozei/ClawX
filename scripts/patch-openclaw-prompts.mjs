#!/usr/bin/env zx

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

  if (patchedFiles > 0) {
    log(`Patched ${patchedFiles} OpenClaw prompt/runtime file(s) in ${openclawDir}`);
  }

  return patchedFiles;
}
