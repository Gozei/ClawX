import { basename, dirname, join } from 'path';
import { access, readFile, rm } from 'fs/promises';
import { constants } from 'fs';
import type { GatewayManager } from '../gateway/manager';
import { getAllSkillConfigs, updateSkillConfig } from './skill-config';
import { inferSkillSourceFromBaseDir, listSkillSources } from './skill-sources';

type GatewaySkillStatus = {
  skillKey: string;
  slug?: string;
  name?: string;
  description?: string;
  disabled?: boolean;
  emoji?: string;
  version?: string;
  author?: string;
  bundled?: boolean;
  always?: boolean;
  source?: string;
  baseDir?: string;
  filePath?: string;
  eligible?: boolean;
  missing?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
    os?: string[];
  };
  homepage?: string;
};

type GatewaySkillsStatusResult = {
  skills?: GatewaySkillStatus[];
};

type SkillConfigEntry = {
  apiKey?: string;
  env?: Record<string, string>;
};

type SkillInstallMetadata = {
  slug?: string;
};

export type SkillListItem = {
  id: string;
  slug?: string;
  name: string;
  description: string;
  enabled: boolean;
  icon?: string;
  version?: string;
  author?: string;
  isCore?: boolean;
  isBundled?: boolean;
  source?: string;
  baseDir?: string;
  filePath?: string;
  missing?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
    os?: string[];
  };
  ready?: boolean;
  homepage?: string;
  sourceId?: string;
  sourceLabel?: string;
};

export type SkillDetail = {
  identity: {
    id: string;
    slug?: string;
    name: string;
    description: string;
    icon?: string;
    version?: string;
    author?: string;
    homepage?: string;
    source?: string;
    isCore?: boolean;
    isBundled?: boolean;
    baseDir?: string;
    filePath?: string;
  };
  status: {
    enabled: boolean;
    ready?: boolean;
    missing?: {
      bins?: string[];
      anyBins?: string[];
      env?: string[];
      config?: string[];
      os?: string[];
    };
  };
  config: SkillConfigEntry;
  requirements: {
    primaryEnv?: string;
    requires?: {
      env?: string[];
      config?: string[];
      bins?: string[];
      anyBins?: string[];
    };
    rawMarkdown?: string;
    parseError?: string;
  };
};

type ParsedSkillSpec = {
  name?: string;
  description?: string;
  homepage?: string;
  primaryEnv?: string;
  requires?: SkillDetail['requirements']['requires'];
  rawMarkdown?: string;
  parseError?: string;
};

function mapSkillStatus(skill: GatewaySkillStatus): SkillListItem {
  return {
    id: skill.skillKey,
    slug: skill.slug || skill.skillKey,
    name: skill.name || skill.skillKey,
    description: skill.description || '',
    enabled: !skill.disabled,
    icon: skill.emoji || '📦',
    version: skill.version || '1.0.0',
    author: skill.author,
    isCore: skill.bundled && skill.always,
    isBundled: skill.bundled,
    source: skill.source,
    baseDir: skill.baseDir,
    filePath: skill.filePath,
    missing: skill.missing,
    ready: skill.eligible,
    homepage: skill.homepage,
  };
}

async function getRuntimeSkills(gatewayManager: GatewayManager): Promise<GatewaySkillStatus[]> {
  const result = await gatewayManager.rpc<GatewaySkillsStatusResult>('skills.status');
  return Array.isArray(result?.skills) ? result.skills : [];
}

function dedentBlock(input: string): string {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  const indent = nonEmpty.reduce((min, line) => {
    const match = line.match(/^(\s+)/);
    const width = match ? match[1].length : 0;
    return min === null ? width : Math.min(min, width);
  }, null as number | null);

  if (!indent || indent <= 0) {
    return lines.join('\n');
  }

  return lines.map((line) => line.startsWith(' '.repeat(indent)) ? line.slice(indent) : line).join('\n');
}

function sanitizeJsonLike(input: string): string {
  return input
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

function parseMetadata(frontmatter: string): Record<string, unknown> | undefined {
  const match = frontmatter.match(/^metadata:\s*\n((?:^[ \t].*(?:\n|$))*)/m);
  if (!match) return undefined;
  const block = dedentBlock(match[1]);
  const sanitized = sanitizeJsonLike(block);
  if (!sanitized) return undefined;
  return JSON.parse(sanitized) as Record<string, unknown>;
}

function parseSimpleString(frontmatter: string, key: string): string | undefined {
  const regex = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const match = frontmatter.match(regex);
  if (!match) return undefined;
  const raw = match[1].trim();
  const unquoted = raw.replace(/^["']|["']$/g, '').trim();
  return unquoted || undefined;
}

function parseSkillSpec(raw: string): ParsedSkillSpec {
  const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    return {
      rawMarkdown: raw,
      parseError: 'SKILL.md frontmatter not found',
    };
  }

  const frontmatter = frontmatterMatch[1];
  const markdown = frontmatterMatch[2] || '';

  try {
    const metadata = parseMetadata(frontmatter);
    const openclaw = (metadata?.openclaw && typeof metadata.openclaw === 'object')
      ? metadata.openclaw as Record<string, unknown>
      : undefined;
    const requires = (openclaw?.requires && typeof openclaw.requires === 'object')
      ? openclaw.requires as Record<string, unknown>
      : undefined;
    const toStringArray = (value: unknown): string[] | undefined => {
      if (!Array.isArray(value)) return undefined;
      const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      return items.length > 0 ? items : undefined;
    };

    return {
      name: parseSimpleString(frontmatter, 'name'),
      description: parseSimpleString(frontmatter, 'description'),
      homepage: parseSimpleString(frontmatter, 'homepage'),
      primaryEnv: typeof openclaw?.primaryEnv === 'string' ? openclaw.primaryEnv : undefined,
      requires: {
        env: toStringArray(requires?.env),
        config: toStringArray(requires?.config),
        bins: toStringArray(requires?.bins),
        anyBins: toStringArray(requires?.anyBins),
      },
      rawMarkdown: markdown.trim(),
    };
  } catch (error) {
    return {
      rawMarkdown: markdown.trim(),
      parseError: String(error),
      name: parseSimpleString(frontmatter, 'name'),
      description: parseSimpleString(frontmatter, 'description'),
      homepage: parseSimpleString(frontmatter, 'homepage'),
    };
  }
}

async function readSkillSpec(filePath: string | undefined, baseDir: string | undefined): Promise<ParsedSkillSpec> {
  const skillFile = filePath || (baseDir ? join(baseDir, 'SKILL.md') : undefined);
  if (!skillFile) {
    return { parseError: 'Skill file path is unavailable' };
  }

  try {
    const raw = await readFile(skillFile, 'utf8');
    return parseSkillSpec(raw);
  } catch (error) {
    return { parseError: String(error) };
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function getSkillDirectoryLeaf(baseDir: string | undefined, filePath: string | undefined): string | undefined {
  const normalizedBaseDir = normalizeOptionalString(baseDir);
  if (normalizedBaseDir) {
    return normalizeOptionalString(basename(normalizedBaseDir.replace(/[\\/]+$/, '')));
  }

  const normalizedFilePath = normalizeOptionalString(filePath);
  if (!normalizedFilePath) return undefined;
  return normalizeOptionalString(basename(dirname(normalizedFilePath)));
}

async function readSkillInstallMetadata(baseDir: string | undefined): Promise<SkillInstallMetadata> {
  const normalizedBaseDir = normalizeOptionalString(baseDir);
  if (!normalizedBaseDir) return {};

  try {
    const raw = await readFile(join(normalizedBaseDir, '_meta.json'), 'utf8');
    const parsed = JSON.parse(raw) as { slug?: unknown };
    return {
      slug: normalizeOptionalString(parsed.slug),
    };
  } catch {
    return {};
  }
}

async function resolveInstalledSkillSlug(skill: GatewaySkillStatus): Promise<string> {
  const runtimeSlug = normalizeOptionalString(skill.slug);
  if (runtimeSlug) {
    return runtimeSlug;
  }

  const installMetadata = await readSkillInstallMetadata(skill.baseDir);
  if (installMetadata.slug) {
    return installMetadata.slug;
  }

  return getSkillDirectoryLeaf(skill.baseDir, skill.filePath) || skill.skillKey;
}

async function findSkillById(gatewayManager: GatewayManager, skillId: string): Promise<GatewaySkillStatus | null> {
  const skills = await getRuntimeSkills(gatewayManager);
  const match = skills.find((skill) => skill.skillKey === skillId || skill.slug === skillId);
  return match || null;
}

export async function listSkills(gatewayManager: GatewayManager): Promise<SkillListItem[]> {
  const skills = await getRuntimeSkills(gatewayManager);
  const sources = await listSkillSources();
  return await Promise.all(skills.map(async (skill) => {
    const resolvedSlug = await resolveInstalledSkillSlug(skill);
    const mapped = mapSkillStatus(skill);
    const inferredSource = inferSkillSourceFromBaseDir(skill.baseDir, sources);
    return {
      ...mapped,
      slug: resolvedSlug,
      sourceId: inferredSource?.id,
      sourceLabel: inferredSource?.label,
    };
  }));
}

export async function getSkillDetail(gatewayManager: GatewayManager, skillId: string): Promise<SkillDetail | null> {
  const skill = await findSkillById(gatewayManager, skillId);
  if (!skill) return null;

  const resolvedSlug = await resolveInstalledSkillSlug(skill);
  const configs = await getAllSkillConfigs();
  const config = configs[skill.skillKey]
    || (skill.slug ? configs[skill.slug] : undefined)
    || (resolvedSlug !== skill.slug ? configs[resolvedSlug] : undefined)
    || {};
  const spec = await readSkillSpec(skill.filePath, skill.baseDir);

  return {
    identity: {
      id: skill.skillKey,
      slug: resolvedSlug,
      name: skill.name || spec.name || skill.skillKey,
      description: skill.description || spec.description || '',
      icon: skill.emoji || '📦',
      version: skill.version || '1.0.0',
      author: skill.author,
      homepage: skill.homepage || spec.homepage,
      source: skill.source,
      isCore: skill.bundled && skill.always,
      isBundled: skill.bundled,
      baseDir: skill.baseDir,
      filePath: skill.filePath,
    },
    status: {
      enabled: !skill.disabled,
      ready: skill.eligible,
      missing: skill.missing,
    },
    config,
    requirements: {
      primaryEnv: spec.primaryEnv,
      requires: spec.requires,
      rawMarkdown: spec.rawMarkdown,
      parseError: spec.parseError,
    },
  };
}

export async function saveSkillConfig(
  gatewayManager: GatewayManager,
  skillId: string,
  updates: { apiKey?: string; env?: Record<string, string> },
): Promise<{ success: boolean; error?: string }> {
  const skill = await findSkillById(gatewayManager, skillId);
  const skillKey = skill?.skillKey || skill?.slug || skillId;
  return updateSkillConfig(skillKey, updates);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function deleteSkillDirectory(gatewayManager: GatewayManager, skillId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const skill = await findSkillById(gatewayManager, skillId);
    if (!skill) {
      return { success: false, error: 'Skill not found' };
    }

    const skillDir = skill.baseDir || (skill.filePath ? dirname(skill.filePath) : undefined);
    if (!skillDir) {
      return { success: false, error: 'Skill directory is unavailable' };
    }

    const skillManifest = skill.filePath || join(skillDir, 'SKILL.md');
    if (!(await pathExists(skillManifest))) {
      return { success: false, error: 'Skill manifest not found' };
    }

    await rm(skillDir, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
