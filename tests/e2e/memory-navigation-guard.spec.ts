import { execFileSync } from 'node:child_process';
import { closeElectronApp, expect, getStableWindow, openChannelsFromSettings, openModelsFromSettings, openSettingsHub, test } from './fixtures/electron';

type ProcessSample = {
  rssMb: number;
  processCount: number;
};

type MemoryCheckpoint = {
  cycle: number;
  route: string;
  sample: ProcessSample;
};

const NAVIGATION_CYCLES = 12;
const SETTLE_DELAY_MS = 350;
const WARMUP_DELAY_MS = 800;
const MAX_RSS_GROWTH_MB = 180;
const MAX_PEAK_OVER_BASELINE_MB = 240;

const routes = [
  { route: '/models', pageTestId: 'models-page', navigate: openModelsFromSettings },
  { route: '/agents', pageTestId: 'agents-page', navigate: async (page: Awaited<ReturnType<typeof getStableWindow>>) => { await page.getByTestId('sidebar-nav-agents').click(); } },
  { route: '/channels', pageTestId: 'channels-page', navigate: openChannelsFromSettings },
  { route: '/settings', pageTestId: 'settings-page', navigate: openSettingsHub },
] as const;

function collectDescendantPids(rootPid: number): number[] {
  const output = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  const childrenByParent = new Map<number, number[]>();

  for (const line of output.split('\n')) {
    const [pidRaw, ppidRaw] = line.trim().split(/\s+/);
    const pid = Number(pidRaw);
    const ppid = Number(ppidRaw);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    const siblings = childrenByParent.get(ppid) ?? [];
    siblings.push(pid);
    childrenByParent.set(ppid, siblings);
  }

  const queue = [rootPid];
  const seen = new Set<number>(queue);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenByParent.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }

  return Array.from(seen);
}

function collectProcessSample(rootPid: number): ProcessSample {
  const pids = collectDescendantPids(rootPid);
  const pidSet = new Set(pids);
  const output = execFileSync('ps', ['-axo', 'pid=,rss='], { encoding: 'utf8' });

  let rssKb = 0;
  let processCount = 0;

  for (const line of output.split('\n')) {
    const [pidRaw, rssRaw] = line.trim().split(/\s+/);
    const pid = Number(pidRaw);
    if (!pidSet.has(pid)) continue;

    const rss = Number(rssRaw);
    if (Number.isFinite(rss)) rssKb += rss;
    processCount += 1;
  }

  return {
    rssMb: Number((rssKb / 1024).toFixed(2)),
    processCount,
  };
}

test.describe('Deep AI Worker navigation memory guard', () => {
  test('does not keep accumulating substantial memory across repeated navigation', async ({ launchElectronApp }) => {
    const electronApp = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(electronApp);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const rootPid = electronApp.process().pid ?? 0;
      expect(rootPid).toBeGreaterThan(0);

      await page.waitForTimeout(WARMUP_DELAY_MS);
      const baseline = collectProcessSample(rootPid);
      const checkpoints: MemoryCheckpoint[] = [];

      for (let cycle = 1; cycle <= NAVIGATION_CYCLES; cycle += 1) {
        for (const routeConfig of routes) {
          await routeConfig.navigate(page);
          await expect(page.getByTestId(routeConfig.pageTestId)).toBeVisible();
          await page.waitForTimeout(SETTLE_DELAY_MS);

          checkpoints.push({
            cycle,
            route: routeConfig.route,
            sample: collectProcessSample(rootPid),
          });
        }
      }

      const peakRssMb = Math.max(...checkpoints.map((checkpoint) => checkpoint.sample.rssMb));
      const finalSample = checkpoints.at(-1)?.sample;

      expect(finalSample).toBeDefined();
      const finalRssMb = finalSample?.rssMb ?? baseline.rssMb;
      const rssGrowthMb = Number((finalRssMb - baseline.rssMb).toFixed(2));
      const peakGrowthMb = Number((peakRssMb - baseline.rssMb).toFixed(2));

      console.log('\n[memory-navigation-guard]');
      console.log(JSON.stringify({
        baseline,
        finalSample,
        rssGrowthMb,
        peakRssMb,
        peakGrowthMb,
        checkpoints,
      }, null, 2));

      expect(
        rssGrowthMb,
        `Repeated navigation ended ${rssGrowthMb} MB above baseline ${baseline.rssMb} MB`,
      ).toBeLessThanOrEqual(MAX_RSS_GROWTH_MB);

      expect(
        peakGrowthMb,
        `Repeated navigation peaked ${peakGrowthMb} MB above baseline ${baseline.rssMb} MB`,
      ).toBeLessThanOrEqual(MAX_PEAK_OVER_BASELINE_MB);
    } finally {
      await closeElectronApp(electronApp);
    }
  });
});
