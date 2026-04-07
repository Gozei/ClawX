import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type ProcessSample = {
  cpuPercent: number;
  rssMb: number;
  processCount: number;
};

type NavigationMetric = {
  route: string;
  pageTestId: string;
  durationMs: number;
  processSample: ProcessSample;
};

type PerfReport = {
  startupMs: number;
  startupSample: ProcessSample;
  coldNavigations: NavigationMetric[];
  warmNavigations: NavigationMetric[];
};

const REPORT_PATH = join(process.cwd(), 'test-results', 'perf-navigation.json');
const SAMPLE_INTERVAL_MS = 250;
const SAMPLE_COUNT = 3;

const routes = [
  { route: '/models', navTestId: 'sidebar-nav-models', pageTestId: 'models-page' },
  { route: '/agents', navTestId: 'sidebar-nav-agents', pageTestId: 'agents-page' },
  { route: '/channels', navTestId: 'sidebar-nav-channels', pageTestId: 'channels-page' },
  { route: '/settings', navTestId: 'sidebar-nav-settings', pageTestId: 'settings-page' },
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const output = execFileSync('ps', ['-axo', 'pid=,%cpu=,rss='], { encoding: 'utf8' });

  let cpuPercent = 0;
  let rssKb = 0;
  let processCount = 0;

  for (const line of output.split('\n')) {
    const [pidRaw, cpuRaw, rssRaw] = line.trim().split(/\s+/);
    const pid = Number(pidRaw);
    if (!pidSet.has(pid)) continue;

    const cpu = Number(cpuRaw);
    const rss = Number(rssRaw);
    if (Number.isFinite(cpu)) cpuPercent += cpu;
    if (Number.isFinite(rss)) rssKb += rss;
    processCount += 1;
  }

  return {
    cpuPercent: Number(cpuPercent.toFixed(2)),
    rssMb: Number((rssKb / 1024).toFixed(2)),
    processCount,
  };
}

async function averageProcessSample(rootPid: number): Promise<ProcessSample> {
  const samples: ProcessSample[] = [];

  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    samples.push(collectProcessSample(rootPid));
    if (i < SAMPLE_COUNT - 1) {
      await sleep(SAMPLE_INTERVAL_MS);
    }
  }

  const totals = samples.reduce(
    (acc, sample) => ({
      cpuPercent: acc.cpuPercent + sample.cpuPercent,
      rssMb: acc.rssMb + sample.rssMb,
      processCount: acc.processCount + sample.processCount,
    }),
    { cpuPercent: 0, rssMb: 0, processCount: 0 },
  );

  return {
    cpuPercent: Number((totals.cpuPercent / samples.length).toFixed(2)),
    rssMb: Number((totals.rssMb / samples.length).toFixed(2)),
    processCount: Math.round(totals.processCount / samples.length),
  };
}

async function navigateAndMeasure(
  page: Awaited<ReturnType<typeof getStableWindow>>,
  rootPid: number,
  navTestId: string,
  pageTestId: string,
  route: string,
): Promise<NavigationMetric> {
  const start = performance.now();
  await page.getByTestId(navTestId).click();
  await expect(page.getByTestId(pageTestId)).toBeVisible();
  const durationMs = Number((performance.now() - start).toFixed(2));
  await page.waitForTimeout(200);

  return {
    route,
    pageTestId,
    durationMs,
    processSample: await averageProcessSample(rootPid),
  };
}

test.describe('Deep AI Worker navigation performance', () => {
  test('measures startup, page navigation latency, and process load', async ({ launchElectronApp }) => {
    const startupStart = performance.now();
    const electronApp = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(electronApp);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      const startupMs = Number((performance.now() - startupStart).toFixed(2));
      const rootPid = electronApp.process().pid ?? 0;
      expect(rootPid).toBeGreaterThan(0);

      const startupSample = await averageProcessSample(rootPid);
      const coldNavigations: NavigationMetric[] = [];
      const warmNavigations: NavigationMetric[] = [];

      for (const routeConfig of routes) {
        coldNavigations.push(
          await navigateAndMeasure(
            page,
            rootPid,
            routeConfig.navTestId,
            routeConfig.pageTestId,
            routeConfig.route,
          ),
        );
      }

      for (const routeConfig of routes) {
        warmNavigations.push(
          await navigateAndMeasure(
            page,
            rootPid,
            routeConfig.navTestId,
            routeConfig.pageTestId,
            routeConfig.route,
          ),
        );
      }

      const report: PerfReport = {
        startupMs,
        startupSample,
        coldNavigations,
        warmNavigations,
      };

      await mkdir(join(process.cwd(), 'test-results'), { recursive: true });
      await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

      console.log('\n[perf-navigation]');
      console.log(JSON.stringify(report, null, 2));
    } finally {
      await closeElectronApp(electronApp);
    }
  });
});
