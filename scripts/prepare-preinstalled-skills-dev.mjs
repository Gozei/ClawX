#!/usr/bin/env zx

/**
 * 使用 execFile 调用 zx CLI，避免 Windows 下项目路径含空格时
 * `$`zx ${path}`` 触发 zx 8 的 “No quote function is defined”。
 */
import 'zx/globals';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchOpenClawPrompts } from './patch-openclaw-prompts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const lockPath = join(ROOT, 'build', 'preinstalled-skills', '.preinstalled-lock.json');
const bundleScript = join(ROOT, 'scripts', 'bundle-preinstalled-skills.mjs');
const openClawDir = join(ROOT, 'node_modules', 'openclaw');

if (process.env.CLAWX_SKIP_PREINSTALLED_SKILLS_PREPARE === '1') {
  echo`Skipping preinstalled skills prepare (CLAWX_SKIP_PREINSTALLED_SKILLS_PREPARE=1).`;
  process.exit(0);
}

if (existsSync(openClawDir)) {
  const patchedFiles = patchOpenClawPrompts(openClawDir, (message) => echo`${message}`);
  if (patchedFiles === 0) {
    echo`OpenClaw dev prompt/runtime files already patched or not applicable.`;
  }
}

if (existsSync(lockPath)) {
  echo`Preinstalled skills bundle already exists, skipping prepare.`;
  process.exit(0);
}

echo`Preinstalled skills bundle missing, preparing for dev startup...`;

try {
  await new Promise((resolve, reject) => {
    execFile(process.execPath, [zxCli, bundleScript], { cwd: ROOT, stdio: 'inherit' }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
} catch (error) {
  // Dev startup should remain available even if network-based skill fetching fails.
  echo`Warning: failed to prepare preinstalled skills for dev startup: ${error?.message || error}`;
  process.exit(0);
}
