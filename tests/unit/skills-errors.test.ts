import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

describe('skills store error mapping', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('passes through fetchSkills errors', async () => {
    hostApiFetchMock.mockRejectedValueOnce(new Error('rate limit exceeded'));

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().fetchSkills(true);

    expect(useSkillsStore.getState().error).toBe('rate limit exceeded');
  });

  it('passes through searchSkills errors', async () => {
    hostApiFetchMock.mockRejectedValueOnce(new Error('request timeout'));

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().searchSkills('git');

    expect(useSkillsStore.getState().searchError).toBe('request timeout');
  });

  it('passes through installSkill errors', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ success: false, error: 'request timeout' });

    const { useSkillsStore } = await import('@/stores/skills');
    await expect(useSkillsStore.getState().installSkill('demo-skill')).rejects.toThrow('request timeout');
  });
});
