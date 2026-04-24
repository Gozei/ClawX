import { basename, dirname, join } from 'path';
import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
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
  config?: Record<string, unknown>;
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

type SkillConfigStorageTarget = {
  kind: 'managed-apiKey' | 'managed-env' | 'managed-config' | 'file-env' | 'file-json';
  path?: string;
  key?: string;
};

type SkillConfigItem = {
  key: string;
  label: string;
  description?: string;
  type: 'secret' | 'env' | 'url' | 'string' | 'number' | 'boolean';
  required: boolean;
  configured: boolean;
  value?: string | number | boolean;
  source: 'apiKey' | 'env' | 'config';
  storageTargets: SkillConfigStorageTarget[];
};

type SkillRuntimeRequirement = {
  key: string;
  label: string;
  category: 'bin' | 'anyBin' | 'env' | 'config' | 'os' | 'package' | 'runtime';
  status: 'ok' | 'missing' | 'unknown';
  detail?: string;
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
  config: {
    apiKey?: string;
    env?: Record<string, string>;
    config?: Record<string, unknown>;
    envFilePath?: string;
    configFilePath?: string;
  };
  requirements: {
    primaryEnv?: string;
    requires?: {
      env?: string[];
      optionalEnv?: string[];
      config?: string[];
      bins?: string[];
      anyBins?: string[];
      packages?: string[];
      runtime?: string[];
      os?: string[];
    };
    rawMarkdown?: string;
    parseError?: string;
  };
  configuration: {
    credentials: SkillConfigItem[];
    optional: SkillConfigItem[];
    config: SkillConfigItem[];
    runtime: SkillRuntimeRequirement[];
    mirrors?: {
      envFilePath?: string;
      configFilePath?: string;
    };
  };
};

type ParsedSkillSpec = {
  name?: string;
  description?: string;
  homepage?: string;
  icon?: string;
  primaryEnv?: string;
  requires?: SkillDetail['requirements']['requires'];
  rawMarkdown?: string;
  parseError?: string;
};

type LocalSkillFiles = {
  envFilePath?: string;
  env?: Record<string, string>;
  configFilePath?: string;
  config?: Record<string, unknown>;
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

function parseJsonObject(input: string): Record<string, unknown> | undefined {
  const sanitized = sanitizeJsonLike(input);
  if (!sanitized) return undefined;

  try {
    const parsed = JSON.parse(sanitized) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function countLeadingIndent(line: string): number {
  const match = line.match(/^[ \t]*/);
  return match ? match[0].replace(/\t/g, '  ').length : 0;
}

function splitInlineCollection(input: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const previous = index > 0 ? input[index - 1] : '';

    if ((character === '"' || character === '\'') && previous !== '\\') {
      if (quote === character) {
        quote = null;
      } else if (quote === null) {
        quote = character;
      }
      current += character;
      continue;
    }

    if (character === ',' && quote === null) {
      items.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  if (current.trim().length > 0) {
    items.push(current.trim());
  }

  return items;
}

function parseYamlScalar(rawValue: string): unknown {
  const value = rawValue.trim();
  if (!value) return '';

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
    return value.slice(1, -1);
  }

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;

  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitInlineCollection(inner).map((item) => parseYamlScalar(item));
  }

  return value;
}

function parseYamlLikeObject(input: string): Record<string, unknown> | undefined {
  const lines = input
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\t/g, '  '));

  function parseBlockScalar(startIndex: number, indent: number): { value: string; nextIndex: number } {
    const blockLines: string[] = [];
    let index = startIndex;
    while (index < lines.length) {
      const rawLine = lines[index];
      const trimmed = rawLine.trim();
      if (!trimmed) {
        blockLines.push('');
        index += 1;
        continue;
      }
      const lineIndent = countLeadingIndent(rawLine);
      if (lineIndent < indent) break;
      blockLines.push(rawLine.slice(indent));
      index += 1;
    }
    return { value: blockLines.join('\n').trimEnd(), nextIndex: index };
  }

  function parseList(startIndex: number, indent: number): { value: unknown[]; nextIndex: number } {
    const result: unknown[] = [];
    let index = startIndex;

    while (index < lines.length) {
      const rawLine = lines[index];
      const trimmed = rawLine.trim();
      if (!trimmed) {
        index += 1;
        continue;
      }

      const lineIndent = countLeadingIndent(rawLine);
      if (lineIndent < indent) break;
      if (lineIndent !== indent || !trimmed.startsWith('- ')) break;

      const remainder = trimmed.slice(2).trim();
      if (!remainder) {
        result.push('');
        index += 1;
        continue;
      }

      result.push(parseYamlScalar(remainder));
      index += 1;
    }

    return { value: result, nextIndex: index };
  }

  function parseObject(startIndex: number, indent: number): { value: Record<string, unknown>; nextIndex: number } {
    const result: Record<string, unknown> = {};
    let index = startIndex;

    while (index < lines.length) {
      const rawLine = lines[index];
      const trimmed = rawLine.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        index += 1;
        continue;
      }

      const lineIndent = countLeadingIndent(rawLine);
      if (lineIndent < indent) break;
      if (lineIndent > indent) {
        throw new Error(`Unexpected indentation in metadata at line ${index + 1}`);
      }

      const line = rawLine.slice(indent);
      const separatorIndex = line.indexOf(':');
      if (separatorIndex <= 0) {
        throw new Error(`Invalid metadata line: ${line}`);
      }

      const key = line.slice(0, separatorIndex).trim();
      const remainder = line.slice(separatorIndex + 1).trim();

      if (remainder === '|' || remainder === '>') {
        const block = parseBlockScalar(index + 1, indent + 2);
        result[key] = block.value;
        index = block.nextIndex;
        continue;
      }

      if (!remainder) {
        let nextIndex = index + 1;
        while (nextIndex < lines.length && !lines[nextIndex].trim()) {
          nextIndex += 1;
        }

        if (nextIndex >= lines.length || countLeadingIndent(lines[nextIndex]) <= lineIndent) {
          result[key] = {};
          index = nextIndex;
          continue;
        }

        const nextTrimmed = lines[nextIndex].trim();
        if (nextTrimmed.startsWith('- ')) {
          const nestedList = parseList(nextIndex, countLeadingIndent(lines[nextIndex]));
          result[key] = nestedList.value;
          index = nestedList.nextIndex;
          continue;
        }

        const nested = parseObject(nextIndex, countLeadingIndent(lines[nextIndex]));
        result[key] = nested.value;
        index = nested.nextIndex;
        continue;
      }

      result[key] = parseYamlScalar(remainder);
      index += 1;
    }

    return { value: result, nextIndex: index };
  }

  const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLineIndex === -1) return undefined;

  return parseObject(firstContentLineIndex, countLeadingIndent(lines[firstContentLineIndex])).value;
}

function extractMetadataBlock(frontmatter: string): string | undefined {
  const lines = frontmatter.replace(/\r\n/g, '\n').split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^metadata:\s*(.*)$/);
    if (!match) continue;

    const inlineValue = match[1].trim();
    if (inlineValue) {
      return inlineValue;
    }

    const metadataIndent = countLeadingIndent(line);
    const blockLines: string[] = [];

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      const trimmed = candidate.trim();

      if (!trimmed) {
        blockLines.push(candidate);
        continue;
      }

      const candidateIndent = countLeadingIndent(candidate);
      if (candidateIndent <= metadataIndent) break;

      blockLines.push(candidate);
    }

    const block = dedentBlock(blockLines.join('\n')).trim();
    return block || undefined;
  }

  return undefined;
}

function parseMetadata(frontmatter: string): Record<string, unknown> | undefined {
  const metadataBlock = extractMetadataBlock(frontmatter);
  if (!metadataBlock) return undefined;
  return parseJsonObject(metadataBlock) ?? parseYamlLikeObject(metadataBlock);
}

function parseFrontmatterObject(frontmatter: string): Record<string, unknown> | undefined {
  try {
    return parseYamlLikeObject(frontmatter);
  } catch {
    return undefined;
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
  return items.length > 0 ? items : undefined;
}

function getMetadataNamespaceObject(
  source: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!source) return undefined;
  const namespace = ['openclaw', 'clawhub', 'clawdbot']
    .find((key) => source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]));
  return namespace ? source[namespace] as Record<string, unknown> : undefined;
}

function inferPrimaryEnv(explicitPrimaryEnv: string | undefined, requiredEnv: string[]): string | undefined {
  if (explicitPrimaryEnv) {
    return explicitPrimaryEnv;
  }

  if (requiredEnv.length !== 1) {
    return undefined;
  }

  const [candidate] = requiredEnv;
  return /(?:API_KEY|TOKEN|SECRET|PASSWORD)$/i.test(candidate) ? candidate : undefined;
}

function parseSkillSpec(raw: string): ParsedSkillSpec {
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
  if (!frontmatterMatch) {
    return {
      rawMarkdown: raw,
      parseError: 'SKILL.md frontmatter not found',
    };
  }

  const frontmatter = frontmatterMatch[1];
  const markdown = frontmatterMatch[2] || '';

  try {
    const frontmatterData = parseFrontmatterObject(frontmatter);
    const metadata = parseMetadata(frontmatter);
    const skillMetadata = getMetadataNamespaceObject(metadata)
      ?? getMetadataNamespaceObject(frontmatterData);
    const requires = (skillMetadata?.requires && typeof skillMetadata.requires === 'object' && !Array.isArray(skillMetadata.requires))
      ? skillMetadata.requires as Record<string, unknown>
      : undefined;
    const metadataEnvVars = toStringArray(skillMetadata?.env_vars);
    const metadataPackages = toStringArray(requires?.packages ?? requires?.python_packages);
    const metadataRuntime = [
      normalizeOptionalString(frontmatterData?.runtime),
    ].filter((value): value is string => Boolean(value));

    const requiredEnvVars = toStringArray(frontmatterData?.required_env_vars);
    const optionalEnvVars = toStringArray(frontmatterData?.optional_env_vars);
    const dependencyBins = toStringArray(frontmatterData?.dependencies);
    const primaryCredential = normalizeOptionalString(frontmatterData?.primary_credential);

    const combinedRequiredEnv = Array.from(new Set([
      ...(toStringArray(requires?.env) ?? []),
      ...(metadataEnvVars ?? []),
      ...(requiredEnvVars ?? []),
    ]));
    const combinedOptionalEnv = Array.from(new Set(optionalEnvVars ?? []));
    const combinedBins = Array.from(new Set([
      ...(toStringArray(requires?.bins) ?? []),
      ...(dependencyBins ?? []),
    ]));
    const explicitPrimaryEnv = typeof skillMetadata?.primaryEnv === 'string'
      ? skillMetadata.primaryEnv
      : primaryCredential;

    return {
      name: normalizeOptionalString(frontmatterData?.name),
      description: normalizeOptionalString(frontmatterData?.description),
      homepage: normalizeOptionalString(frontmatterData?.homepage)
        ?? normalizeOptionalString(skillMetadata?.homepage),
      icon: normalizeOptionalString(skillMetadata?.icon)
        ?? normalizeOptionalString(skillMetadata?.emoji),
      primaryEnv: inferPrimaryEnv(explicitPrimaryEnv, combinedRequiredEnv),
      requires: {
        env: combinedRequiredEnv.length > 0 ? combinedRequiredEnv : undefined,
        optionalEnv: combinedOptionalEnv.length > 0 ? combinedOptionalEnv : undefined,
        config: toStringArray(requires?.config),
        bins: combinedBins.length > 0 ? combinedBins : undefined,
        anyBins: toStringArray(requires?.anyBins),
        packages: metadataPackages,
        runtime: metadataRuntime.length > 0 ? metadataRuntime : undefined,
        os: toStringArray(skillMetadata?.os),
      },
      rawMarkdown: markdown.trim(),
    };
  } catch (error) {
    return {
      rawMarkdown: markdown.trim(),
      parseError: String(error),
      name: normalizeOptionalString(parseFrontmatterObject(frontmatter)?.name),
      description: normalizeOptionalString(parseFrontmatterObject(frontmatter)?.description),
      homepage: normalizeOptionalString(parseFrontmatterObject(frontmatter)?.homepage),
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseDotenv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of content.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    value = value.replace(/^["']|["']$/g, '');
    if (!key) continue;
    env[key] = value;
  }
  return env;
}

function stringifyDotenv(env: Record<string, string>): string {
  const lines = Object.keys(env)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${env[key]}`);
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

async function readJsonObjectFile(filePath: string | undefined): Promise<Record<string, unknown> | undefined> {
  if (!filePath || !(await pathExists(filePath))) return undefined;
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function detectEnvMirrorPath(baseDir: string | undefined, rawMarkdown: string | undefined): string | undefined {
  if (!baseDir) return undefined;
  const explicitMentions = [
    { marker: 'config/.env', path: join(baseDir, 'config', '.env') },
    { marker: '.secrets.env', path: join(baseDir, '.secrets.env') },
    { marker: '.env', path: join(baseDir, '.env') },
  ];

  const markdown = rawMarkdown ?? '';
  for (const item of explicitMentions) {
    if (markdown.includes(item.marker)) {
      return item.path;
    }
  }

  return undefined;
}

async function resolveLocalSkillFiles(baseDir: string | undefined, rawMarkdown: string | undefined): Promise<LocalSkillFiles> {
  if (!baseDir) return {};

  const configFilePath = join(baseDir, 'config.json');
  const config = await readJsonObjectFile(configFilePath);
  const envCandidates = [
    join(baseDir, 'config', '.env'),
    join(baseDir, '.secrets.env'),
    join(baseDir, '.env'),
  ];

  let envFilePath: string | undefined;
  for (const candidate of envCandidates) {
    if (await pathExists(candidate)) {
      envFilePath = candidate;
      break;
    }
  }

  if (!envFilePath) {
    envFilePath = detectEnvMirrorPath(baseDir, rawMarkdown);
  }

  let env: Record<string, string> | undefined;
  if (envFilePath && await pathExists(envFilePath)) {
    const rawEnv = await readFile(envFilePath, 'utf8');
    env = parseDotenv(rawEnv);
  }

  const hasConfigFile = config !== undefined || await pathExists(configFilePath);
  const resolvedConfigFilePath = hasConfigFile || rawMarkdown?.includes('config.json')
    ? configFilePath
    : undefined;

  return {
    envFilePath,
    env,
    configFilePath: resolvedConfigFilePath,
    config,
  };
}

function getPreferredConfigValue<T extends string | number | boolean>(
  values: Array<T | undefined>,
): T | undefined {
  return values.find((value) => value !== undefined);
}

function isConfiguredValue(value: unknown): boolean {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'string') return value.trim().length > 0;
  return false;
}

function inferConfigType(key: string, value: unknown, source: 'apiKey' | 'env' | 'config'): SkillConfigItem['type'] {
  if (source === 'apiKey') return 'secret';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (/url|uri|endpoint|host/i.test(key)) return 'url';
  return source === 'env' ? 'env' : 'string';
}

function buildConfigItem(params: {
  key: string;
  label?: string;
  required: boolean;
  source: 'apiKey' | 'env' | 'config';
  value?: string | number | boolean;
  storageTargets: SkillConfigStorageTarget[];
  description?: string;
}): SkillConfigItem {
  return {
    key: params.key,
    label: params.label ?? params.key,
    description: params.description,
    type: inferConfigType(params.key, params.value, params.source),
    required: params.required,
    configured: isConfiguredValue(params.value),
    value: params.value,
    source: params.source,
    storageTargets: params.storageTargets,
  };
}

function buildRuntimeRequirements(skill: GatewaySkillStatus, spec: ParsedSkillSpec): SkillRuntimeRequirement[] {
  const missing = skill.missing ?? {};
  const requirements: SkillRuntimeRequirement[] = [];

  const pushGroup = (
    category: SkillRuntimeRequirement['category'],
    declared: string[] | undefined,
    missingItems: string[] | undefined,
  ) => {
    const missingSet = new Set((missingItems ?? []).map((item) => item.trim()));
    const declaredItems = declared ?? [];
    for (const item of declaredItems) {
      requirements.push({
        key: `${category}:${item}`,
        label: item,
        category,
        status: missingSet.has(item) ? 'missing' : 'ok',
      });
      missingSet.delete(item);
    }
    for (const item of missingSet) {
      requirements.push({
        key: `${category}:${item}`,
        label: item,
        category,
        status: 'missing',
      });
    }
  };

  pushGroup('bin', spec.requires?.bins, missing.bins);
  pushGroup('anyBin', spec.requires?.anyBins, missing.anyBins);
  pushGroup('env', spec.requires?.env, missing.env);
  pushGroup('config', spec.requires?.config, missing.config);
  pushGroup('os', spec.requires?.os, missing.os);

  for (const item of spec.requires?.packages ?? []) {
    requirements.push({
      key: `package:${item}`,
      label: item,
      category: 'package',
      status: 'unknown',
    });
  }

  for (const item of spec.requires?.runtime ?? []) {
    requirements.push({
      key: `runtime:${item}`,
      label: item,
      category: 'runtime',
      status: 'unknown',
    });
  }

  return requirements;
}

function buildResolvedConfiguration(
  skill: GatewaySkillStatus,
  spec: ParsedSkillSpec,
  config: SkillConfigEntry,
  localFiles: LocalSkillFiles,
): SkillDetail['configuration'] {
  const managedEnv = config.env ?? {};
  const localEnv = localFiles.env ?? {};
  const managedConfig = config.config ?? {};
  const localConfig = localFiles.config ?? {};

  const requiredEnv = new Set(spec.requires?.env ?? []);
  const optionalEnv = new Set(spec.requires?.optionalEnv ?? []);
  const primaryEnv = spec.primaryEnv;

  const credentials: SkillConfigItem[] = [];
  if (primaryEnv) {
    const value = getPreferredConfigValue<string>([
      normalizeOptionalString(config.apiKey),
      normalizeOptionalString(managedEnv[primaryEnv]),
      normalizeOptionalString(localEnv[primaryEnv]),
    ]);
    credentials.push(buildConfigItem({
      key: primaryEnv,
      label: primaryEnv,
      required: requiredEnv.has(primaryEnv),
      source: 'apiKey',
      value,
      storageTargets: [
        { kind: 'managed-apiKey' },
        ...(localFiles.envFilePath ? [{ kind: 'file-env' as const, path: localFiles.envFilePath, key: primaryEnv }] : []),
      ],
    }));
  }

  const envKeys = new Set<string>();
  for (const key of requiredEnv) {
    if (key !== primaryEnv) envKeys.add(key);
  }
  for (const key of optionalEnv) {
    if (key !== primaryEnv) envKeys.add(key);
  }
  for (const key of Object.keys(managedEnv)) {
    if (key !== primaryEnv) envKeys.add(key);
  }
  for (const key of Object.keys(localEnv)) {
    if (key !== primaryEnv) envKeys.add(key);
  }

  const requiredEnvItems: SkillConfigItem[] = [];
  const optionalEnvItems: SkillConfigItem[] = [];
  for (const key of Array.from(envKeys).sort((a, b) => a.localeCompare(b))) {
    const value = getPreferredConfigValue<string>([
      normalizeOptionalString(managedEnv[key]),
      normalizeOptionalString(localEnv[key]),
    ]);
    const item = buildConfigItem({
      key,
      label: key,
      required: requiredEnv.has(key),
      source: 'env',
      value,
      storageTargets: [
        { kind: 'managed-env', key },
        ...(localFiles.envFilePath ? [{ kind: 'file-env' as const, path: localFiles.envFilePath, key }] : []),
      ],
    });
    if (item.required) {
      requiredEnvItems.push(item);
    } else {
      optionalEnvItems.push(item);
    }
  }

  const configKeys = new Set<string>([
    ...(spec.requires?.config ?? []),
    ...Object.keys(managedConfig),
    ...Object.keys(localConfig).filter((key) => {
      const value = localConfig[key];
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    }),
  ]);

  const configItems: SkillConfigItem[] = [];
  for (const key of Array.from(configKeys).sort((a, b) => a.localeCompare(b))) {
    const value = getPreferredConfigValue<string | number | boolean>([
      typeof managedConfig[key] === 'string' || typeof managedConfig[key] === 'number' || typeof managedConfig[key] === 'boolean'
        ? managedConfig[key] as string | number | boolean
        : undefined,
      typeof localConfig[key] === 'string' || typeof localConfig[key] === 'number' || typeof localConfig[key] === 'boolean'
        ? localConfig[key] as string | number | boolean
        : undefined,
    ]);

    configItems.push(buildConfigItem({
      key,
      label: key,
      required: (spec.requires?.config ?? []).includes(key),
      source: 'config',
      value,
      storageTargets: [
        { kind: 'managed-config', key },
        ...(localFiles.configFilePath ? [{ kind: 'file-json' as const, path: localFiles.configFilePath, key }] : []),
      ],
    }));
  }

  return {
    credentials: [...credentials, ...requiredEnvItems],
    optional: optionalEnvItems,
    config: configItems,
    runtime: buildRuntimeRequirements(skill, spec),
    mirrors: {
      envFilePath: localFiles.envFilePath,
      configFilePath: localFiles.configFilePath,
    },
  };
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

function resolveStoredConfig(
  configs: Record<string, SkillConfigEntry>,
  skill: GatewaySkillStatus,
  resolvedSlug: string,
): SkillConfigEntry {
  return configs[skill.skillKey]
    || (skill.slug ? configs[skill.slug] : undefined)
    || (resolvedSlug !== skill.slug ? configs[resolvedSlug] : undefined)
    || {};
}

export async function getSkillDetail(gatewayManager: GatewayManager, skillId: string): Promise<SkillDetail | null> {
  const skill = await findSkillById(gatewayManager, skillId);
  if (!skill) return null;

  const resolvedSlug = await resolveInstalledSkillSlug(skill);
  const configs = await getAllSkillConfigs();
  const config = resolveStoredConfig(configs, skill, resolvedSlug);
  const spec = await readSkillSpec(skill.filePath, skill.baseDir);
  const localFiles = await resolveLocalSkillFiles(skill.baseDir, spec.rawMarkdown);
  const configuration = buildResolvedConfiguration(skill, spec, config, localFiles);

  return {
    identity: {
      id: skill.skillKey,
      slug: resolvedSlug,
      name: skill.name || spec.name || skill.skillKey,
      description: skill.description || spec.description || '',
      icon: skill.emoji || spec.icon || '📦',
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
    config: {
      apiKey: config.apiKey,
      env: config.env,
      config: config.config,
      envFilePath: localFiles.envFilePath,
      configFilePath: localFiles.configFilePath,
    },
    requirements: {
      primaryEnv: spec.primaryEnv,
      requires: spec.requires,
      rawMarkdown: spec.rawMarkdown,
      parseError: spec.parseError,
    },
    configuration,
  };
}

async function writeEnvMirror(filePath: string, envUpdates: Record<string, string>): Promise<void> {
  let merged: Record<string, string> = {};
  if (await pathExists(filePath)) {
    const raw = await readFile(filePath, 'utf8');
    merged = parseDotenv(raw);
  }
  for (const [key, value] of Object.entries(envUpdates)) {
    if (!value.trim()) {
      delete merged[key];
      continue;
    }
    merged[key] = value.trim();
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, stringifyDotenv(merged), 'utf8');
}

async function writeConfigJson(filePath: string, configUpdates: Record<string, unknown>): Promise<void> {
  const current = await readJsonObjectFile(filePath) ?? {};
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(configUpdates)) {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0)) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
}

function normalizeEnvUpdates(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {};
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (!normalizedKey || !normalizedValue) continue;
    next[normalizedKey] = normalizedValue;
  }
  return next;
}

function normalizeConfigUpdates(config: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!config) return {};
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    if (typeof value === 'string') {
      next[normalizedKey] = value.trim();
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      next[normalizedKey] = value;
    }
  }
  return next;
}

export async function saveSkillConfig(
  gatewayManager: GatewayManager,
  skillId: string,
  updates: { apiKey?: string; env?: Record<string, string>; config?: Record<string, unknown> },
): Promise<{ success: boolean; error?: string }> {
  const skill = await findSkillById(gatewayManager, skillId);
  const skillKey = skill?.skillKey || skill?.slug || skillId;
  const spec = await readSkillSpec(skill?.filePath, skill?.baseDir);
  const localFiles = await resolveLocalSkillFiles(skill?.baseDir, spec.rawMarkdown);
  const normalizedEnv = normalizeEnvUpdates(updates.env);
  const normalizedConfig = normalizeConfigUpdates(updates.config);

  const result = await updateSkillConfig(skillKey, {
    apiKey: updates.apiKey,
    env: normalizedEnv,
    config: normalizedConfig,
  });
  if (!result.success) {
    return result;
  }

  const mirrorErrors: string[] = [];
  const envMirror: Record<string, string> = { ...(updates.env ?? {}) };
  if (spec.primaryEnv && typeof updates.apiKey === 'string') {
    envMirror[spec.primaryEnv] = updates.apiKey;
  }

  if (localFiles.envFilePath && Object.keys(envMirror).length > 0) {
    try {
      await writeEnvMirror(localFiles.envFilePath, envMirror);
    } catch (error) {
      mirrorErrors.push(`Failed to update ${localFiles.envFilePath}: ${String(error)}`);
    }
  }

  if (localFiles.configFilePath && updates.config !== undefined) {
    try {
      await writeConfigJson(localFiles.configFilePath, updates.config);
    } catch (error) {
      mirrorErrors.push(`Failed to update ${localFiles.configFilePath}: ${String(error)}`);
    }
  }

  if (mirrorErrors.length > 0) {
    return {
      success: true,
      error: `Managed skill config was saved, but local mirror files could not be updated. ${mirrorErrors.join(' ')}`,
    };
  }

  return { success: true };
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
