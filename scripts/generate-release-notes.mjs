#!/usr/bin/env node

/**
 * Extract the latest version section from CHANGELOG.md
 * and write it to release-notes.md for electron-builder.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const changelogPath = join(root, 'CHANGELOG.md');
const outputPath = join(root, 'release-notes.md');

const content = readFileSync(changelogPath, 'utf-8');
const lines = content.split('\n');

// Find the first version heading (## v...)
const firstVersionIdx = lines.findIndex((l) => /^## v/.test(l));
if (firstVersionIdx === -1) {
  console.error('No version heading found in CHANGELOG.md');
  process.exit(1);
}

// Find the next version heading after the first one
let endIdx = lines.length;
for (let i = firstVersionIdx + 1; i < lines.length; i++) {
  if (/^## v/.test(lines[i])) {
    endIdx = i;
    break;
  }
}

// Extract and trim trailing blank lines
const section = lines.slice(firstVersionIdx, endIdx).join('\n').trimEnd() + '\n';
writeFileSync(outputPath, section, 'utf-8');
console.log(`Generated release-notes.md from CHANGELOG.md (version section: lines ${firstVersionIdx + 1}-${endIdx})`);
