#!/usr/bin/env zx

import './setup-zx-shell.mjs';
import 'zx/globals';
// Windows 无 Git Bash 时 zx 默认的 useBash() 会静默失败，导致未设置 $.quote，
// 项目路径含空格（如 Deep AI Worker）时 `$` 模板会报 No quote function is defined。
import os from 'node:os';
import { usePowerShell, usePwsh } from 'zx';

if (os.platform() === 'win32') {
  try {
    usePowerShell();
  } catch {
    try {
      usePwsh();
    } catch {
      // 若两者均不可用，后续 git 命令会失败；提示用户检查 PATH
    }
  }
}

import { readFileSync, existsSync, mkdirSync, rmSync, cpSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(ROOT, 'resources', 'skills', 'preinstalled-manifest.json');
const CUSTOM_SKILLS_ROOT = join(ROOT, 'resources', 'custom-skills');
const OUTPUT_ROOT = join(ROOT, 'build', 'preinstalled-skills');
const TMP_ROOT = join(ROOT, 'build', '.tmp-preinstalled-skills');
const GENERATED_MANIFEST_NAME = '.preinstalled-manifest.generated.json';

function normalizeVersion(input, fallback = 'manual') {
  const trimmed = String(input || '').trim();
  return trimmed || fallback;
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing manifest: ${MANIFEST_PATH}`);
  }
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.skills)) {
    throw new Error('Invalid preinstalled-skills manifest format');
  }
  for (const item of parsed.skills) {
    if (!item.slug || !item.repo || !item.repoPath) {
      throw new Error(`Invalid manifest entry: ${JSON.stringify(item)}`);
    }
  }
  return parsed.skills;
}

function discoverLocalSkills() {
  if (!existsSync(CUSTOM_SKILLS_ROOT)) {
    return [];
  }

  const entries = readdirSync(CUSTOM_SKILLS_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const slug = entry.name.trim();
      const sourceDir = join(CUSTOM_SKILLS_ROOT, slug);
      const manifestPath = join(sourceDir, 'SKILL.md');
      if (!existsSync(manifestPath)) {
        return null;
      }
      return {
        slug,
        sourceDir,
        version: 'local',
        autoEnable: true,
        localPath: relative(ROOT, sourceDir).replace(/\\/g, '/'),
      };
    })
    .filter(Boolean);
}

function groupByRepoRef(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const ref = entry.ref || 'main';
    const key = `${entry.repo}#${ref}`;
    if (!grouped.has(key)) grouped.set(key, { repo: entry.repo, ref, entries: [] });
    grouped.get(key).entries.push(entry);
  }
  return [...grouped.values()];
}

function createRepoDirName(repo, ref) {
  return `${repo.replace(/[\\/]/g, '__')}__${ref.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function toGitPath(inputPath) {
  if (process.platform !== 'win32') return inputPath;
  // Git on Windows accepts forward slashes and avoids backslash escape quirks.
  return inputPath.replace(/\\/g, '/');
}

function normalizeRepoPath(repoPath) {
  return repoPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function shouldCopySkillFile(srcPath) {
  const base = basename(srcPath);
  if (base === '.git') return false;
  if (base === '.subset.tar') return false;
  return true;
}

async function extractArchive(archiveFileName, cwd) {
  const prevCwd = $.cwd;
  $.cwd = cwd;
  try {
    try {
      await $`tar -xf ${archiveFileName}`;
      return;
    } catch (tarError) {
      if (process.platform === 'win32') {
        // Some Windows images expose bsdtar instead of tar.
        await $`bsdtar -xf ${archiveFileName}`;
        return;
      }
      throw tarError;
    }
  } finally {
    $.cwd = prevCwd;
  }
}

async function fetchSparseRepo(repo, ref, paths, checkoutDir) {
  const remote = `https://github.com/${repo}.git`;
  mkdirSync(checkoutDir, { recursive: true });
  const gitCheckoutDir = toGitPath(checkoutDir);
  const archiveFileName = '.subset.tar';
  const archivePath = join(checkoutDir, archiveFileName);
  const archivePaths = [...new Set(paths.map(normalizeRepoPath))];

  await $`git init ${gitCheckoutDir}`;
  await $`git -C ${gitCheckoutDir} remote add origin ${remote}`;
  await $`git -C ${gitCheckoutDir} fetch --depth 1 origin ${ref}`;
  // Do not checkout working tree on Windows: upstream repos may contain
  // Windows-invalid paths. Export only requested directories via git archive.
  await $`git -C ${gitCheckoutDir} archive --format=tar --output ${archiveFileName} FETCH_HEAD ${archivePaths}`;
  await extractArchive(archiveFileName, checkoutDir);
  rmSync(archivePath, { force: true });

  const commit = (await $`git -C ${gitCheckoutDir} rev-parse FETCH_HEAD`).stdout.trim();
  return commit;
}

function copySkillDir(sourceDir, targetDir, slug) {
  rmSync(targetDir, { recursive: true, force: true });
  cpSync(sourceDir, targetDir, { recursive: true, dereference: true, filter: shouldCopySkillFile });

  const skillManifest = join(targetDir, 'SKILL.md');
  if (!existsSync(skillManifest)) {
    throw new Error(`Skill ${slug} is missing SKILL.md after copy`);
  }
}

echo`Bundling preinstalled skills...`;

if (process.env.SKIP_PREINSTALLED_SKILLS === '1') {
  if (existsSync(OUTPUT_ROOT)) {
    echo`⏭  SKIP_PREINSTALLED_SKILLS=1 set, keeping existing bundled skills at ${OUTPUT_ROOT}.`;
  } else {
    mkdirSync(OUTPUT_ROOT, { recursive: true });
    echo`⏭  SKIP_PREINSTALLED_SKILLS=1 set, skipping skills fetch and leaving ${OUTPUT_ROOT} empty.`;
  }
  process.exit(0);
}

const manifestSkills = loadManifest();
const localSkills = discoverLocalSkills();
const skipRemoteDownloads = process.env.SKIP_PREINSTALLED_SKILLS_DOWNLOAD === '1';

rmSync(OUTPUT_ROOT, { recursive: true, force: true });
mkdirSync(OUTPUT_ROOT, { recursive: true });
rmSync(TMP_ROOT, { recursive: true, force: true });
mkdirSync(TMP_ROOT, { recursive: true });

const lock = {
  generatedAt: new Date().toISOString(),
  skills: [],
};
const generatedManifest = {
  skills: [],
};
const remoteFailures = [];

if (skipRemoteDownloads) {
  echo`⏭  SKIP_PREINSTALLED_SKILLS_DOWNLOAD=1 set, skipping remote skill downloads.`;
} else {
  const groups = groupByRepoRef(manifestSkills);
  for (const group of groups) {
    const repoDir = join(TMP_ROOT, createRepoDirName(group.repo, group.ref));
    const sparsePaths = [...new Set(group.entries.map((entry) => entry.repoPath))];

    let commit = '';
    try {
      echo`Fetching ${group.repo} @ ${group.ref}`;
      commit = await fetchSparseRepo(group.repo, group.ref, sparsePaths, repoDir);
      echo`   commit ${commit}`;
    } catch (error) {
      const message = error?.message || String(error);
      remoteFailures.push({
        repo: group.repo,
        ref: group.ref,
        message,
      });
      echo`⚠️  Skipping ${group.repo} @ ${group.ref}: ${message}`;
      continue;
    }

    for (const entry of group.entries) {
      const sourceDir = join(repoDir, entry.repoPath);
      const targetDir = join(OUTPUT_ROOT, entry.slug);

      if (!existsSync(sourceDir)) {
        throw new Error(`Missing source path in repo checkout: ${entry.repoPath}`);
      }

      copySkillDir(sourceDir, targetDir, entry.slug);

      const requestedVersion = (entry.version || '').trim();
      const resolvedVersion = !requestedVersion || requestedVersion === 'main'
        ? commit
        : requestedVersion;
      lock.skills.push({
        slug: entry.slug,
        version: resolvedVersion,
        repo: entry.repo,
        repoPath: entry.repoPath,
        ref: group.ref,
        commit,
        source: 'github',
      });

      echo`   OK ${entry.slug}`;
    }
  }
}

for (const entry of localSkills) {
  const targetDir = join(OUTPUT_ROOT, entry.slug);
  copySkillDir(entry.sourceDir, targetDir, entry.slug);
  lock.skills.push({
    slug: entry.slug,
    version: normalizeVersion(entry.version, 'local'),
    source: 'local',
    localPath: entry.localPath,
  });
  generatedManifest.skills.push({
    slug: entry.slug,
    version: normalizeVersion(entry.version, 'local'),
    autoEnable: entry.autoEnable !== false,
  });
  echo`Local OK ${entry.slug}`;
}

writeFileSync(join(OUTPUT_ROOT, '.preinstalled-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
writeFileSync(join(OUTPUT_ROOT, GENERATED_MANIFEST_NAME), `${JSON.stringify(generatedManifest, null, 2)}\n`, 'utf8');
rmSync(TMP_ROOT, { recursive: true, force: true });

if (remoteFailures.length > 0) {
  echo`Preinstalled skills completed with ${remoteFailures.length} remote source warning(s).`;
}

echo`Preinstalled skills ready: ${OUTPUT_ROOT}`;
