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
  missing?: string[];
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
  author?: string;
  downloads?: number;
  stars?: number;
  sourceId?: string;
  sourceLabel?: string;
}

export interface SkillSource {
  id: string;
  label: string;
  enabled: boolean;
  site: string;
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
