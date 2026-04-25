import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SkillMarketplaceDetailContent } from '../../src/pages/Skills/components/SkillMarketplaceDetailContent';
import type { MarketplaceInstalledSkill, MarketplaceSkillDetail, SkillSnapshot, SkillSource } from '../../src/types/skill';

const translations: Record<string, string> = {
  'detail.docsTab': 'Documentation',
  'detail.author': 'Author',
  'detail.backToList': 'Back to skills',
  'marketplace.unknownSkill': 'Unknown skill',
  'marketplace.noDescription': 'No description provided.',
  'marketplace.unknownAuthor': 'Unknown author',
  'marketplace.licenseUnknown': 'Unknown',
  'marketplace.occupiedAction': 'Provided by another source',
  'marketplace.updateAvailableState': 'Update available',
  'marketplace.installedState': 'Installed',
  'marketplace.notInstalledState': 'Not installed',
  'marketplace.downloads': 'Downloads',
  'marketplace.stars': 'Stars',
  'marketplace.versions': 'Versions',
  'marketplace.installSuccessDescription': 'Installed',
  'marketplace.installAction': 'Install',
  'marketplace.updateAction': 'Update skill',
  'marketplace.staticScanClean': 'Security scan clean',
  'marketplace.staticScanUnknown': 'Security scan unknown',
  'marketplace.staticScanReview': 'Review recommended',
  'marketplace.suspiciousInstallTitle': 'Review skill before installing',
  'marketplace.suspiciousInstallMessage': 'This skill was flagged by security moderation.',
  'marketplace.suspiciousInstallMessageWithReason': 'This skill was flagged by security moderation: {{reason}}',
  'marketplace.suspiciousInstallConfirm': 'Install anyway',
  'marketplace.suspiciousInstallCancel': 'Cancel',
  'marketplace.pendingReview': 'Pending review',
  'marketplace.detailInfoTab': 'Marketplace details',
  'marketplace.changelogTitle': 'Changelog',
  'marketplace.noChangelog': 'No changelog provided.',
  'marketplace.securityTitle': 'Security',
  'marketplace.staticScanSummary': 'No scan summary available.',
  'marketplace.licenseLabel': 'License',
  'marketplace.identityLabel': 'Identity',
  'marketplace.filesTitle': 'Files',
  'marketplace.noFiles': 'No file metadata provided.',
};

const store = {
  installSkill: vi.fn(),
  enableSkill: vi.fn(),
  skills: [] as SkillSnapshot[],
};

const sources: SkillSource[] = [
  {
    id: 'deepaiworker',
    label: 'DeepSkillHub',
    enabled: true,
    site: 'https://example.com',
    workdir: 'C:/Users/test/.openclaw/skill-sources/deepaiworker',
  },
];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; reason?: string }) => {
      const template = translations[key] ?? options?.defaultValue ?? key;
      return options?.reason ? template.replace('{{reason}}', options.reason) : template;
    },
  }),
}));

vi.mock('@/stores/skills', () => ({
  useSkillsStore: (selector?: (state: typeof store) => unknown) => (typeof selector === 'function' ? selector(store) : store),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SkillMarketplaceDetailContent', () => {
  beforeEach(() => {
    store.installSkill.mockReset();
    store.enableSkill.mockReset();
    store.installSkill.mockResolvedValue(undefined);
    store.enableSkill.mockResolvedValue(undefined);
    store.skills = [];
  });

  it('renders the shared tabs shell and marketplace summary fields', () => {
    const detail: MarketplaceSkillDetail = {
      requestedSlug: 'self-improving-agent',
      resolvedSlug: 'self-improving-agent',
      owner: {
        displayName: 'From ClawHub',
      },
      skill: {
        slug: 'self-improving-agent',
        displayName: 'Self Improving Agent',
        description: 'Captures learnings and errors.',
        stats: {
          downloads: 10,
          stars: 5,
          versions: 1,
        },
      },
      latestVersion: {
        version: '3.0.13',
        rawMarkdown: '# Self Improving Agent',
        changelog: '- Initial release.',
        parsed: {
          license: 'MIT',
        },
        staticScan: {
          status: 'clean',
          summary: 'No suspicious patterns detected.',
        },
        files: [
          {
            path: 'SKILL.md',
            contentType: 'text/plain',
            size: 21606,
          },
        ],
      },
    };

    const installedSkills: MarketplaceInstalledSkill[] = [
      {
        slug: 'self-improving-agent',
        version: '3.0.13',
        sourceId: 'deepaiworker',
      },
    ];

    render(
      <SkillMarketplaceDetailContent
        detail={detail}
        installedSkills={installedSkills}
        skills={[]}
        sources={sources}
        sourceId="deepaiworker"
      />,
    );

    expect(screen.getByTestId('skills-marketplace-detail-docs')).toBeInTheDocument();
    expect(screen.getByTestId('skills-marketplace-detail-tab-docs')).toBeInTheDocument();
    expect(screen.getByTestId('skills-marketplace-detail-tab-details')).toBeInTheDocument();
    expect(screen.getByText('Security scan clean')).toBeInTheDocument();
    expect(screen.getByText('Marketplace details')).toBeInTheDocument();
  });

  it('strips SKILL.md frontmatter from marketplace documentation before rendering', () => {
    const detail: MarketplaceSkillDetail = {
      requestedSlug: 'self-improving-agent',
      resolvedSlug: 'self-improving-agent',
      owner: {
        displayName: 'From ClawHub',
      },
      skill: {
        slug: 'self-improving-agent',
        displayName: 'Self Improving Agent',
        description: 'Captures learnings and errors.',
      },
      latestVersion: {
        version: '3.0.13',
        rawMarkdown: `---
name: Self Improving Agent
description: Captures learnings and errors.
homepage: https://example.com
---

# Usage

This is the visible marketplace documentation.`,
      },
    };

    render(
      <SkillMarketplaceDetailContent
        detail={detail}
        installedSkills={[]}
        skills={[]}
        sources={sources}
        sourceId="deepaiworker"
      />,
    );

    expect(screen.getByText('Usage')).toBeInTheDocument();
    expect(screen.getByText('This is the visible marketplace documentation.')).toBeInTheDocument();
    expect(screen.queryByText('name: Self Improving Agent')).not.toBeInTheDocument();
    expect(screen.queryByText('description: Captures learnings and errors.')).not.toBeInTheDocument();
  });

  it('shows moderation review over clean static scan and confirms suspicious installs with force', async () => {
    const detail: MarketplaceSkillDetail = {
      requestedSlug: 'zentao-api',
      resolvedSlug: 'zentao-api',
      moderationInfo: {
        isSuspicious: true,
        isMalwareBlocked: false,
        summary: 'Detected suspicious patterns.',
        reasonCodes: ['suspicious.llm_suspicious'],
      },
      owner: {
        displayName: 'ClawHub',
      },
      skill: {
        slug: 'zentao-api',
        displayName: 'Zentao API',
        description: 'Integrates with Zentao.',
      },
      latestVersion: {
        version: '1.0.0',
        rawMarkdown: '# Zentao API',
        staticScan: {
          status: 'clean',
          summary: 'No suspicious patterns detected.',
        },
      },
    };

    render(
      <SkillMarketplaceDetailContent
        detail={detail}
        installedSkills={[]}
        skills={[]}
        sources={sources}
        sourceId="deepaiworker"
      />,
    );

    expect(screen.getByText('Review recommended')).toBeInTheDocument();
    expect(screen.queryByText('Security scan clean')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Install/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Review skill before installing');
    expect(screen.getByRole('dialog')).toHaveTextContent('Detected suspicious patterns.');
    expect(store.installSkill).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Install anyway' }));

    await waitFor(() => {
      expect(store.installSkill).toHaveBeenCalledWith('zentao-api', '1.0.0', 'deepaiworker', true);
    });
  });

  it('confirms suspicious updates before installing with force', async () => {
    const detail: MarketplaceSkillDetail = {
      requestedSlug: 'zentao-api',
      resolvedSlug: 'zentao-api',
      moderationInfo: {
        isSuspicious: true,
        isMalwareBlocked: false,
        summary: 'Detected suspicious update behavior.',
        reasonCodes: ['suspicious.llm_suspicious'],
      },
      skill: {
        slug: 'zentao-api',
        displayName: 'Zentao API',
        description: 'Integrates with Zentao.',
      },
      latestVersion: {
        version: '1.1.0',
        rawMarkdown: '# Zentao API',
      },
    };

    render(
      <SkillMarketplaceDetailContent
        detail={detail}
        installedSkills={[{ slug: 'zentao-api', version: '1.0.0', sourceId: 'deepaiworker' } as MarketplaceInstalledSkill]}
        skills={[]}
        sources={sources}
        sourceId="deepaiworker"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Update skill/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Detected suspicious update behavior.');
    expect(store.installSkill).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Install anyway' }));

    await waitFor(() => {
      expect(store.installSkill).toHaveBeenCalledWith('zentao-api', '1.1.0', 'deepaiworker', true);
    });
  });
});
