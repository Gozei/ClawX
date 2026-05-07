import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  'detail.requiredConfig': 'Localized required config',
  'detail.runtimeDeclared': 'Localized declared runtime',
  'detail.anyBins': 'Localized any bins',
  'detail.noSpecificRuntimeRequirements': 'Localized empty requirements',
  'detail.configuration': 'Configuration',
  'detail.setupSubtitle': 'Setup subtitle',
  'detail.configSubtitle': 'Config subtitle',
  'detail.credentialsTitle': 'Credentials',
  'detail.credentialsSubtitle': 'Credential subtitle',
  'detail.optionalEnvTitle': 'Optional env',
  'detail.optionalEnvSubtitle': 'Optional env subtitle',
  'detail.noCredentialFields': 'No credential fields',
  'detail.noOptionalFields': 'No optional fields',
  'detail.noSpecificConfig': 'No specific config',
  'detail.noSetupRequired': 'No configuration required.',
  'detail.primaryCredential': 'Primary credential',
  'detail.addVariable': 'Add variable',
  'detail.saveConfig': 'Save config',
  'detail.missingRuntimeRequirements': 'Missing runtime requirements',
  'detail.missingPrefix': 'Missing',
  'detail.runtimeHealthy': 'Runtime healthy',
  'detail.runtimeHealthyHint': 'Runtime healthy hint',
  'detail.runtimeFixHint': 'Runtime fix hint',
  'detail.readyHeadline': 'Ready headline',
  'detail.incompleteHeadline': 'Incomplete headline',
  'detail.deleteConfirmTitle': 'Delete skill directory?',
  'detail.deleteConfirmMessage': 'This removes the local skill directory from disk.',
  'detail.deleteSkill': 'Delete Skill',
  'detail.saving': 'Saving...',
  'detail.openManual': 'Open Manual',
  'detail.parseFailed': 'Parse failed',
  'detail.required': 'Required',
  'detail.optional': 'Optional',
  'detail.configured': 'Configured',
  'detail.missingValue': 'Missing',
  'detail.booleanLabel': 'Enabled',
  'detail.storage.runtime': 'Injected into runtime config',
  'detail.storage.envFile': 'Env file',
  'detail.storage.configFile': 'Config file',
  'detail.storageTitle': 'Storage title',
  'detail.storageSubtitle': 'Storage subtitle',
  'detail.showValue': 'Show value',
  'detail.hideValue': 'Hide value',
  'detail.runtimeBadge.ok': 'Detected',
  'detail.runtimeBadge.missing': 'Missing',
  'detail.runtimeBadge.unknown': 'Declared',
  'common:actions.cancel': 'Cancel',
  'list.ready': 'Ready',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; env?: string; path?: string }) => {
      if (key === 'detail.primaryCredential' && options?.env) {
        return `${translations[key]} · ${options.env}`;
      }
      if ((key === 'detail.storage.envFile' || key === 'detail.storage.configFile') && options?.path) {
        return `${translations[key]}: ${options.path}`;
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
  it('renders redesigned configuration layout and localized runtime sections', async () => {
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
        primaryEnv: 'WEATHER_API_KEY',
        requires: {
          bins: ['python'],
          env: ['WEATHER_API_KEY'],
          anyBins: ['uv', 'pip'],
          config: ['baseUrl'],
        },
      },
      config: {
        apiKey: '',
        env: {},
        config: {
          baseUrl: 'https://api.weather.test',
        },
      },
      configuration: {
        credentials: [
          {
            key: 'WEATHER_API_KEY',
            label: 'WEATHER_API_KEY',
            type: 'secret',
            required: true,
            configured: false,
            value: '',
            source: 'apiKey',
            storageTargets: [{ kind: 'managed-apiKey' }],
          },
        ],
        optional: [
          {
            key: 'WEATHER_REGION',
            label: 'WEATHER_REGION',
            type: 'env',
            required: false,
            configured: false,
            value: '',
            source: 'env',
            storageTargets: [{ kind: 'managed-env', key: 'WEATHER_REGION' }],
          },
        ],
        config: [
          {
            key: 'baseUrl',
            label: 'baseUrl',
            type: 'url',
            required: true,
            configured: true,
            value: 'https://api.weather.test',
            source: 'config',
            storageTargets: [{ kind: 'managed-config', key: 'baseUrl' }],
          },
        ],
        runtime: [
          { key: 'bin:python', label: 'python', category: 'bin', status: 'ok' },
          { key: 'env:WEATHER_API_KEY', label: 'WEATHER_API_KEY', category: 'env', status: 'missing' },
          { key: 'config:baseUrl', label: 'baseUrl', category: 'config', status: 'ok' },
        ],
        mirrors: {
          envFilePath: 'C:/skills/weather/.env',
          configFilePath: 'C:/skills/weather/config.json',
        },
      },
    };

    render(<SkillDetailContent detail={detail} initialTab="config" />);

    expect(await screen.findByTestId('skills-config-overview')).toBeInTheDocument();
    expect(screen.getByTestId('skills-config-card-settings')).toBeInTheDocument();
    expect(screen.getByTestId('skills-config-card-credentials')).toBeInTheDocument();
    expect(screen.getByTestId('skills-config-card-schema')).toBeInTheDocument();
    expect(screen.getByTestId('skills-config-card-runtime')).toBeInTheDocument();
    expect(screen.getByTestId('skills-config-card-storage')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://api.weather.test')).toBeInTheDocument();
    expect(screen.getByTestId('skills-runtime-missing-list')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-runtime-groups')).not.toBeInTheDocument();
    expect(screen.getByTestId('skills-runtime-missing-list')).toHaveTextContent('Missing');
    expect(screen.getByTestId('skills-runtime-missing-list')).toHaveTextContent('WEATHER_API_KEY');
  });

  it('renders safe empty states when no config groups are available', async () => {
    const detail = {
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
      config: {},
      configuration: {
        credentials: [],
        optional: [],
        config: [],
        runtime: [],
      },
    } as SkillDetail;

    render(<SkillDetailContent detail={detail} initialTab="config" />);

    expect(await screen.findByTestId('skills-config-card-settings')).toBeInTheDocument();
    expect(screen.getByTestId('skills-config-card-settings-empty')).toHaveTextContent('No configuration required.');
    expect(screen.queryByTestId('skills-config-card-credentials')).not.toBeInTheDocument();
    expect(screen.queryByTestId('skills-config-card-schema')).not.toBeInTheDocument();
    expect(screen.getByText('No missing requirements.')).toBeInTheDocument();
  });

  it('opens documentation links in the default browser instead of navigating inside the app', async () => {
    const openExternal = vi.mocked(window.electron.openExternal);
    openExternal.mockClear();

    const detail = {
      identity: {
        id: 'openai',
        name: 'OpenAI',
        description: 'Uses OpenAI API.',
      },
      status: {
        enabled: true,
        ready: true,
      },
      requirements: {
        rawMarkdown: '# OpenAI\n\nRead the [OpenAI docs](https://platform.openai.com/docs) or [local gateway](192.168.1.10:3000/health).',
      },
      config: {},
      configuration: {
        credentials: [],
        optional: [],
        config: [],
        runtime: [],
      },
    } as SkillDetail;

    render(<SkillDetailContent detail={detail} initialTab="docs" />);

    const docsLink = await screen.findByRole('link', { name: 'OpenAI docs' });
    fireEvent.click(docsLink);

    expect(openExternal).toHaveBeenCalledWith('https://platform.openai.com/docs');

    fireEvent.click(screen.getByRole('link', { name: 'local gateway' }));
    expect(openExternal).toHaveBeenCalledWith('http://192.168.1.10:3000/health');
  });

  it('allows revealing configured secret values', async () => {
    const detail: SkillDetail = {
      identity: {
        id: 'openai',
        name: 'OpenAI',
        description: 'Uses OpenAI API.',
      },
      status: {
        enabled: true,
        ready: true,
      },
      requirements: {
        rawMarkdown: '# OpenAI',
      },
      config: {},
      configuration: {
        credentials: [
          {
            key: 'OPENAI_API_KEY',
            label: 'OPENAI_API_KEY',
            type: 'secret',
            required: true,
            configured: true,
            value: 'sk-test-value',
            source: 'apiKey',
            storageTargets: [{ kind: 'managed-apiKey' }],
          },
        ],
        optional: [],
        config: [],
        runtime: [],
      },
    };

    render(<SkillDetailContent detail={detail} initialTab="config" />);

    const input = await screen.findByDisplayValue('sk-test-value');
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByLabelText('Show value'));
    expect(screen.getByDisplayValue('sk-test-value')).toHaveAttribute('type', 'text');
  });
});
