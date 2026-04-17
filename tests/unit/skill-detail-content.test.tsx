import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkillDetailContent } from '../../src/pages/Skills/components/SkillDetailContent';
import type { SkillDetail } from '../../src/types/skill';

const translations: Record<string, string> = {
  'detail.author': 'Author',
  'detail.baseDir': 'Skill directory',
  'detail.docsTab': 'Documentation',
  'detail.configTab': 'Configuration',
  'detail.runtimeStatus': 'Runtime status',
  'detail.enabled': 'Enabled',
  'detail.source': 'Source',
  'detail.skillId': 'Skill ID',
  'detail.requirementsTab': 'Runtime Requirements',
  'detail.runtimeRequirementsDescription': 'Localized runtime requirements copy',
  'detail.requiredBins': 'Localized required bins',
  'detail.requiredEnv': 'Localized required env',
  'detail.anyBins': 'Localized any bins',
  'detail.noSpecificRuntimeRequirements': 'Localized empty requirements',
  'detail.configuration': 'Configuration',
  'detail.setupSubtitle': 'Setup subtitle',
  'detail.primaryCredential': 'Primary credential',
  'detail.addVariable': 'Add variable',
  'detail.saveConfig': 'Save config',
  'detail.missingRuntimeRequirements': 'Missing runtime requirements',
  'detail.deleteConfirmTitle': 'Delete skill directory?',
  'detail.deleteConfirmMessage': 'This removes the local skill directory from disk.',
  'detail.deleteSkill': 'Delete Skill',
  'detail.saving': 'Saving...',
  'detail.openManual': 'Open Manual',
  'detail.parseFailed': 'Parse failed',
  'common:actions.cancel': 'Cancel',
  'list.ready': 'Ready',
  'source.badge.unknown': 'Unknown source',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; env?: string }) => {
      if (key === 'detail.primaryCredential' && options?.env) {
        return `${translations[key]} · ${options.env}`;
      }
      return translations[key] ?? options?.defaultValue ?? key;
    },
  }),
}));

vi.mock('@/stores/skills', () => ({
  useSkillsStore: () => ({
    fetchSkillDetail: vi.fn(),
    saveSkillConfig: vi.fn(),
    enableSkill: vi.fn(),
    disableSkill: vi.fn(),
    deleteSkill: vi.fn(),
    deleting: {},
  }),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SkillDetailContent', () => {
  it('renders localized runtime requirement labels instead of hard-coded English copy', async () => {
    const detail: SkillDetail = {
      identity: {
        id: 'weather',
        name: 'Weather',
        description: 'Fetches weather information.',
        icon: 'W',
        version: '1.2.3',
        author: 'OpenClaw',
        baseDir: 'C:/skills/weather',
      },
      status: {
        enabled: true,
        ready: false,
        missing: {
          env: ['WEATHER_API_KEY'],
        },
      },
      requirements: {
        rawMarkdown: '# Weather',
        requires: {
          bins: ['python'],
          env: ['WEATHER_API_KEY'],
          anyBins: ['uv', 'pip'],
        },
      },
      config: {
        apiKey: '',
        env: {},
      },
    };

    render(<SkillDetailContent detail={detail} initialTab="config" />);

    expect(await screen.findByText('Localized runtime requirements copy')).toBeInTheDocument();
    expect(await screen.findByText('Localized required bins')).toBeInTheDocument();
    expect(await screen.findByText('Localized required env')).toBeInTheDocument();
    expect(await screen.findByText('Localized any bins')).toBeInTheDocument();
    expect(screen.getByText('Skill directory:')).toBeInTheDocument();

    expect(screen.queryByText('Dependencies and environments required for this skill to operate.')).not.toBeInTheDocument();
    expect(screen.queryByText('Required Bins')).not.toBeInTheDocument();
    expect(screen.queryByText('Required Env')).not.toBeInTheDocument();
    expect(screen.queryByText('Any Bins')).not.toBeInTheDocument();
    expect(screen.queryByText('Path:')).not.toBeInTheDocument();
  });

  it('renders localized empty-state copy for runtime requirements', async () => {
    const detail: SkillDetail = {
      identity: {
        id: 'notes',
        name: 'Notes',
        description: 'Stores notes locally.',
      },
      status: {
        enabled: true,
        ready: true,
      },
      requirements: {
        rawMarkdown: '# Notes',
        requires: {},
      },
      config: {
        apiKey: '',
        env: {},
      },
    };

    render(<SkillDetailContent detail={detail} initialTab="config" />);

    expect(await screen.findByText('Localized empty requirements')).toBeInTheDocument();
    expect(screen.queryByText('No specific runtime requirements.')).not.toBeInTheDocument();
  });
});
