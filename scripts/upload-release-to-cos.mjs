#!/usr/bin/env zx

import 'zx/globals';
import COS from 'cos-nodejs-sdk-v5';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const releaseDir = join(ROOT, process.env.COS_RELEASE_DIR || 'release');
const prefix = (process.env.COS_PREFIX || 'latest').replace(/^\/+|\/+$/g, '');
const targetPlatform = (process.env.COS_PLATFORM || 'all').trim().toLowerCase();

const secretId = process.env.COS_SECRET_ID;
const secretKey = process.env.COS_SECRET_KEY;
const bucket = process.env.COS_BUCKET;
const region = process.env.COS_REGION;
const dryRun = process.argv.includes('--dry-run');

function fail(message) {
  console.error(`\n[upload-release-to-cos] ${message}`);
  process.exit(1);
}

function parseSimpleUpdaterYml(content) {
  const files = [];
  let pathValue = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const urlMatch = line.match(/^-?\s*url:\s*(.+)$/);
    if (urlMatch) {
      files.push(urlMatch[1].trim());
      continue;
    }

    const pathMatch = line.match(/^path:\s*(.+)$/);
    if (pathMatch) {
      pathValue = pathMatch[1].trim();
    }
  }

  if (pathValue) files.push(pathValue);
  return [...new Set(files)];
}

function isSupportedPlatform(value) {
  return ['all', 'mac', 'win', 'linux'].includes(value);
}

function matchesPlatform(filename) {
  if (targetPlatform === 'all') return true;
  if (targetPlatform === 'mac') return filename.includes('-mac-') || filename.endsWith('-mac.yml');
  if (targetPlatform === 'win') return filename.includes('-win-');
  if (targetPlatform === 'linux') return filename.includes('-linux-');
  return true;
}

async function collectUploadFiles() {
  if (!existsSync(releaseDir)) {
    fail(`release directory not found: ${releaseDir}`);
  }

  const names = readdirSync(releaseDir).filter((name) => statSync(join(releaseDir, name)).isFile());
  const ymlFiles = names.filter((name) => {
    if (!name.endsWith('.yml') || name === 'builder-debug.yml') return false;
    if (targetPlatform === 'all') return true;
    if (targetPlatform === 'mac') return name.endsWith('-mac.yml');
    return true;
  });

  if (ymlFiles.length === 0) {
    fail(`no updater yml files found in ${releaseDir}`);
  }

  const selected = new Set();
  let matchedArtifactCount = 0;

  for (const ymlName of ymlFiles) {
    const ymlPath = join(releaseDir, ymlName);
    const content = await fs.readFile(ymlPath, 'utf8');
    const referenced = parseSimpleUpdaterYml(content);
    const matchingArtifacts = referenced
      .map((refName) => basename(refName))
      .filter((artifactName) => matchesPlatform(artifactName));

    if (targetPlatform !== 'all' && matchingArtifacts.length === 0) {
      continue;
    }

    selected.add(ymlName);

    for (const artifactName of matchingArtifacts) {
      const artifactPath = join(releaseDir, artifactName);
      if (!existsSync(artifactPath)) {
        fail(`referenced artifact missing: ${artifactName} (from ${ymlName})`);
      }

      selected.add(artifactName);
      matchedArtifactCount += 1;

      const blockmapName = `${artifactName}.blockmap`;
      const blockmapPath = join(releaseDir, blockmapName);
      if (existsSync(blockmapPath)) {
        selected.add(blockmapName);
      }
    }
  }

  if (targetPlatform !== 'all' && matchedArtifactCount === 0) {
    fail(`no release artifacts matched platform "${targetPlatform}" in ${releaseDir}`);
  }

  return [...selected].sort();
}

async function uploadFile(cos, filename) {
  const filePath = join(releaseDir, filename);
  const key = prefix ? `${prefix}/${filename}` : filename;

  if (dryRun) {
    console.log(`[dry-run] ${filePath} -> cos://${bucket}/${key}`);
    return;
  }

  await new Promise((resolve, reject) => {
    cos.sliceUploadFile(
      {
        Bucket: bucket,
        Region: region,
        Key: key,
        FilePath: filePath,
      },
      (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      },
    );
  });

  console.log(`[uploaded] ${filename} -> cos://${bucket}/${key}`);
}

if (!bucket) fail('missing COS_BUCKET');
if (!region) fail('missing COS_REGION');
if (!secretId) fail('missing COS_SECRET_ID');
if (!secretKey) fail('missing COS_SECRET_KEY');
if (!isSupportedPlatform(targetPlatform)) fail(`unsupported COS_PLATFORM: ${targetPlatform}`);

const cos = new COS({
  SecretId: secretId,
  SecretKey: secretKey,
});

const files = await collectUploadFiles();

console.log(`[upload-release-to-cos] releaseDir=${releaseDir}`);
console.log(`[upload-release-to-cos] prefix=${prefix || '(root)'}`);
console.log(`[upload-release-to-cos] platform=${targetPlatform}`);
console.log('[upload-release-to-cos] files:');
for (const file of files) {
  console.log(`  - ${file}`);
}

for (const file of files) {
  await uploadFile(cos, file);
}

console.log('[upload-release-to-cos] done');
