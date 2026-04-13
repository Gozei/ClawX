#!/usr/bin/env zx

import 'zx/globals';
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
  await $`zx ${bundleScript}`;
} catch (error) {
  // Dev startup should remain available even if network-based skill fetching fails.
  echo`Warning: failed to prepare preinstalled skills for dev startup: ${error?.message || error}`;
  process.exit(0);
}
