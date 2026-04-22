/**
 * Skill Type Definitions
 * Types for skills/plugins
 */

/**
 * Skill data structure
 */
export interface SkillSnapshot {
  id: string;
  slug?: string;
  name: string;
  description: string;
  enabled: boolean;
  icon?: string;
  version?: string;
  author?: string;
  configurable?: boolean;
  isCore?: boolean;
  isBundled?: boolean;
  dependencies?: string[];
  source?: string;
  baseDir?: string;
  filePath?: string;
  missing?: SkillMissingStatus;
  ready?: boolean;
  requirementsSummary?: string;
  homepage?: string;
  installed?: boolean;
  sourceId?: string;
  sourceLabel?: string;
}

/**
 * Combined Skill type used in the UI
 */
export type Skill = SkillSnapshot & {
  config?: {
    apiKey?: string;
    env?: Record<string, string>;
    [key: string]: unknown;
  };
};

export interface SkillSpecRequires {
  env?: string[];
  optionalEnv?: string[];
  config?: string[];
  bins?: string[];
  anyBins?: string[];
  packages?: string[];
  runtime?: string[];
  os?: string[];
}

export interface SkillMissingStatus {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
  os?: string[];
}

export interface SkillIdentity {
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
}

export interface SkillStatus {
  enabled: boolean;
  ready?: boolean;
  missing?: SkillMissingStatus;
}

export interface SkillDefinition {
  primaryEnv?: string;
  requires?: SkillSpecRequires;
  rawMarkdown?: string;
  parseError?: string;
}

export interface SkillConfigStorageTarget {
  kind: 'managed-apiKey' | 'managed-env' | 'managed-config' | 'file-env' | 'file-json';
  path?: string;
  key?: string;
}

export interface SkillConfigItem {
  key: string;
  label: string;
  description?: string;
  type: 'secret' | 'env' | 'url' | 'string' | 'number' | 'boolean';
  required: boolean;
  configured: boolean;
  value?: string | number | boolean;
  source: 'apiKey' | 'env' | 'config';
  storageTargets: SkillConfigStorageTarget[];
}

export interface SkillRuntimeRequirement {
  key: string;
  label: string;
  category: 'bin' | 'anyBin' | 'env' | 'config' | 'os' | 'package' | 'runtime';
  status: 'ok' | 'missing' | 'unknown';
  detail?: string;
}

export interface SkillResolvedConfiguration {
  credentials: SkillConfigItem[];
  optional: SkillConfigItem[];
  config: SkillConfigItem[];
  runtime: SkillRuntimeRequirement[];
  mirrors?: {
    envFilePath?: string;
    configFilePath?: string;
  };
}

export interface SkillDetail {
  identity: SkillIdentity;
  status: SkillStatus;
  config: {
    apiKey?: string;
    env?: Record<string, string>;
    config?: Record<string, unknown>;
    envFilePath?: string;
    configFilePath?: string;
  };
  requirements: SkillDefinition;
  configuration: SkillResolvedConfiguration;
}


export interface SkillConfigDetail {
  id: string;
  config?: Record<string, unknown>;
  apiKey?: string;
  env?: Record<string, string>;
}

/**
 * Skill bundle (preset skill collection)
 */
export interface SkillBundle {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  icon: string;
  skills: string[];
  recommended?: boolean;
}


/**
 * Marketplace skill data
 */
export interface MarketplaceSkill {
  slug: string;
  name: string;
  description: string;
  version: string;
  icon?: string;
  author?: string;
  downloads?: number;
  stars?: number;
  sourceId?: string;
  sourceLabel?: string;
}

export interface MarketplaceSkillFile {
  contentType?: string;
  path: string;
  sha256?: string;
  size?: number;
}

export interface MarketplaceSkillLatestVersion {
  _creationTime?: number;
  _id?: string;
  changelog?: string;
  changelogSource?: string;
  createdAt?: number;
  createdBy?: string;
  files?: MarketplaceSkillFile[];
  fingerprint?: string;
  rawMarkdown?: string;
  parsed?: {
    license?: string | null;
    [key: string]: unknown;
  };
  skillId?: string;
  staticScan?: {
    checkedAt?: number;
    engineVersion?: string;
    findings?: unknown[];
    reasonCodes?: unknown[];
    status?: string;
    summary?: string;
    [key: string]: unknown;
  };
  version?: string;
}

export interface MarketplaceSkillOwner {
  _creationTime?: number;
  _id?: string;
  displayName?: string;
  handle?: string;
  image?: string;
  kind?: string;
  linkedUserId?: string;
}

export interface MarketplaceSkillIdentity {
  canonical?: string | null;
  forkOf?: string | null;
  requestedSlug?: string;
  resolvedSlug?: string;
  pendingReview?: boolean;
}

export interface MarketplaceSkillDetail {
  canonical?: string | null;
  forkOf?: string | null;
  latestVersion?: MarketplaceSkillLatestVersion | null;
  moderationInfo?: unknown;
  owner?: MarketplaceSkillOwner | null;
  pendingReview?: boolean;
  requestedSlug?: string;
  resolvedSlug?: string;
  skill?: {
    _creationTime?: number;
    _id?: string;
    badges?: Record<string, unknown>;
    capabilityTags?: string[];
    createdAt?: number;
    displayName?: string;
    latestVersionId?: string;
    ownerPublisherId?: string;
    ownerUserId?: string;
    slug?: string;
    stats?: {
      comments?: number;
      downloads?: number;
      installsAllTime?: number;
      installsCurrent?: number;
      stars?: number;
      versions?: number;
    };
    description?: string;
    summary?: string;
    tags?: Record<string, string | undefined>;
    updatedAt?: number;
  } | null;
}

export interface MarketplaceSearchResponse {
  results: MarketplaceSkill[];
  nextCursor?: string;
}

export interface MarketplaceSourceCount {
  sourceId: string;
  sourceLabel?: string;
  total: number | null;
}

export interface MarketplaceInstalledSkill {
  slug: string;
  version?: string;
  baseDir?: string;
  sourceId?: string;
  sourceLabel?: string;
}

export interface SkillSource {
  id: string;
  label: string;
  enabled: boolean;
  site: string;
  apiQueryEndpoint?: string;
  registry?: string;
  workdir: string;
}

/**
 * Skill configuration schema
 */
export interface SkillConfigSchema {
  type: 'object';
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array';
    title?: string;
    description?: string;
    default?: unknown;
    enum?: unknown[];
  }>;
  required?: string[];
}
