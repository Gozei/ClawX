/**
 * Cron State Store
 * Manages scheduled task state and run history.
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type {
  CronJob,
  CronJobCreateInput,
  CronJobFilters,
  CronJobUpdateInput,
  CronJobsResponse,
  CronRunEntry,
  CronRunFilters,
  CronRunsResponse,
  CronStatus,
} from '../types/cron';
import { guardGatewayTransitioning } from './gateway';

const DEFAULT_JOBS_LIMIT = 50;
const DEFAULT_RUNS_LIMIT = 50;

const defaultJobFilters: CronJobFilters = {
  query: '',
  enabled: 'all',
  scheduleKind: 'all',
  lastStatus: 'all',
  sortBy: 'nextRunAtMs',
  sortDir: 'asc',
};

const defaultRunFilters: CronRunFilters = {
  scope: 'all',
  jobId: null,
  statuses: [],
  deliveryStatuses: [],
  query: '',
  sortDir: 'desc',
};

interface CronState {
  status: CronStatus | null;
  jobs: CronJob[];
  jobsTotal: number;
  jobsHasMore: boolean;
  jobsNextOffset: number | null;
  jobsGatewayAvailable: boolean | null;
  jobsFilters: CronJobFilters;
  runs: CronRunEntry[];
  runsTotal: number;
  runsHasMore: boolean;
  runsNextOffset: number | null;
  runsGatewayAvailable: boolean | null;
  runsFilters: CronRunFilters;
  selectedJobId: string | null;
  loading: boolean;
  statusLoading: boolean;
  jobsLoadingMore: boolean;
  runsLoading: boolean;
  runsLoadingMore: boolean;
  busy: boolean;
  error: string | null;
  statusError: string | null;
  jobsError: string | null;
  runsError: string | null;

  fetchStatus: () => Promise<void>;
  fetchJobs: () => Promise<void>;
  loadMoreJobs: () => Promise<void>;
  setJobFilters: (filters: Partial<CronJobFilters>) => void;
  fetchRuns: () => Promise<void>;
  loadMoreRuns: () => Promise<void>;
  setRunFilters: (filters: Partial<CronRunFilters>) => void;
  selectJob: (id: string | null) => void;
  refreshAll: () => Promise<void>;
  createJob: (input: CronJobCreateInput) => Promise<CronJob>;
  updateJob: (id: string, input: CronJobUpdateInput) => Promise<void>;
  deleteJob: (id: string) => Promise<void>;
  toggleJob: (id: string, enabled: boolean) => Promise<void>;
  triggerJob: (id: string) => Promise<void>;
  setJobs: (jobs: CronJob[]) => void;
}

function normalizeJobsResponse(value: unknown): CronJobsResponse {
  if (Array.isArray(value)) {
    return {
      jobs: value as CronJob[],
      total: value.length,
      offset: 0,
      nextOffset: null,
      hasMore: false,
    };
  }
  const response = value as Partial<CronJobsResponse>;
  const jobs = Array.isArray(response.jobs) ? response.jobs : [];
  return {
    jobs,
    total: typeof response.total === 'number' ? response.total : jobs.length,
    offset: typeof response.offset === 'number' ? response.offset : 0,
    nextOffset: typeof response.nextOffset === 'number' ? response.nextOffset : null,
    hasMore: response.hasMore === true,
    gatewayAvailable: response.gatewayAvailable,
  };
}

function normalizeRunsResponse(value: unknown): CronRunsResponse {
  const response = value as Partial<CronRunsResponse>;
  const entries = Array.isArray(response.entries) ? response.entries : [];
  return {
    entries,
    total: typeof response.total === 'number' ? response.total : entries.length,
    offset: typeof response.offset === 'number' ? response.offset : 0,
    nextOffset: typeof response.nextOffset === 'number' ? response.nextOffset : null,
    hasMore: response.hasMore === true,
    gatewayAvailable: response.gatewayAvailable,
  };
}

function buildJobsPath(_filters: CronJobFilters, offset = 0): string {
  const params = new URLSearchParams({
    limit: String(DEFAULT_JOBS_LIMIT),
    offset: String(offset),
    includeDisabled: 'true',
    enabled: 'all',
    sortBy: 'nextRunAtMs',
    sortDir: 'asc',
  });
  return `/api/cron/jobs?${params.toString()}`;
}

function buildRunsPath(_filters: CronRunFilters, offset = 0): string {
  const params = new URLSearchParams({
    scope: 'all',
    limit: String(DEFAULT_RUNS_LIMIT),
    offset: String(offset),
    sortDir: 'desc',
  });
  return `/api/cron/runs?${params.toString()}`;
}

export const useCronStore = create<CronState>((set, get) => ({
  status: null,
  jobs: [],
  jobsTotal: 0,
  jobsHasMore: false,
  jobsNextOffset: null,
  jobsGatewayAvailable: null,
  jobsFilters: defaultJobFilters,
  runs: [],
  runsTotal: 0,
  runsHasMore: false,
  runsNextOffset: null,
  runsGatewayAvailable: null,
  runsFilters: defaultRunFilters,
  selectedJobId: null,
  loading: false,
  statusLoading: false,
  jobsLoadingMore: false,
  runsLoading: false,
  runsLoadingMore: false,
  busy: false,
  error: null,
  statusError: null,
  jobsError: null,
  runsError: null,

  fetchStatus: async () => {
    set({ statusLoading: true, statusError: null, error: null });
    try {
      const status = await hostApiFetch<CronStatus>('/api/cron/status');
      set({ status, statusLoading: false, statusError: null });
    } catch (error) {
      const message = String(error);
      set({ error: message, statusError: message, statusLoading: false });
    }
  },

  fetchJobs: async () => {
    set({ loading: true, jobsError: null, error: null });
    try {
      const response = normalizeJobsResponse(await hostApiFetch(buildJobsPath(get().jobsFilters)));
      set({
        jobs: response.jobs,
        jobsTotal: response.total,
        jobsHasMore: response.hasMore,
        jobsNextOffset: response.nextOffset,
        jobsGatewayAvailable: response.gatewayAvailable ?? null,
        loading: false,
        jobsError: null,
      });
    } catch (error) {
      const message = String(error);
      set({ error: message, jobsError: message, loading: false });
    }
  },

  loadMoreJobs: async () => {
    const { jobsHasMore, jobsNextOffset, jobsLoadingMore, jobsFilters } = get();
    if (!jobsHasMore || jobsNextOffset == null || jobsLoadingMore) return;
    set({ jobsLoadingMore: true, jobsError: null, error: null });
    try {
      const response = normalizeJobsResponse(await hostApiFetch(buildJobsPath(jobsFilters, jobsNextOffset)));
      set((state) => ({
        jobs: [...state.jobs, ...response.jobs],
        jobsTotal: Math.max(response.total, state.jobs.length + response.jobs.length),
        jobsHasMore: response.hasMore,
        jobsNextOffset: response.nextOffset,
        jobsGatewayAvailable: response.gatewayAvailable ?? state.jobsGatewayAvailable,
        jobsLoadingMore: false,
        jobsError: null,
      }));
    } catch (error) {
      const message = String(error);
      set({ error: message, jobsError: message, jobsLoadingMore: false });
    }
  },

  setJobFilters: (filters) => {
    set((state) => ({
      jobsFilters: { ...state.jobsFilters, ...filters },
      jobsNextOffset: null,
      jobsHasMore: false,
    }));
  },

  fetchRuns: async () => {
    set({ runsLoading: true, runsError: null, error: null });
    try {
      const response = normalizeRunsResponse(await hostApiFetch(buildRunsPath(get().runsFilters)));
      set({
        runs: response.entries,
        runsTotal: response.total,
        runsHasMore: response.hasMore,
        runsNextOffset: response.nextOffset,
        runsGatewayAvailable: response.gatewayAvailable ?? null,
        runsLoading: false,
        runsError: null,
      });
    } catch (error) {
      const message = String(error);
      set({ error: message, runsError: message, runsLoading: false });
    }
  },

  loadMoreRuns: async () => {
    const { runsHasMore, runsNextOffset, runsLoadingMore, runsFilters } = get();
    if (!runsHasMore || runsNextOffset == null || runsLoadingMore) return;
    set({ runsLoadingMore: true, runsError: null, error: null });
    try {
      const response = normalizeRunsResponse(await hostApiFetch(buildRunsPath(runsFilters, runsNextOffset)));
      set((state) => ({
        runs: [...state.runs, ...response.entries],
        runsTotal: Math.max(response.total, state.runs.length + response.entries.length),
        runsHasMore: response.hasMore,
        runsNextOffset: response.nextOffset,
        runsGatewayAvailable: response.gatewayAvailable ?? state.runsGatewayAvailable,
        runsLoadingMore: false,
        runsError: null,
      }));
    } catch (error) {
      const message = String(error);
      set({ error: message, runsError: message, runsLoadingMore: false });
    }
  },

  setRunFilters: (filters) => {
    set((state) => ({
      runsFilters: { ...state.runsFilters, ...filters },
      runsNextOffset: null,
      runsHasMore: false,
    }));
  },

  selectJob: (id) => set({ selectedJobId: id }),

  refreshAll: async () => {
    await Promise.all([
      get().fetchStatus(),
      get().fetchJobs(),
      get().fetchRuns(),
    ]);
  },

  createJob: async (input) => {
    if (guardGatewayTransitioning()) throw new Error('Gateway is restarting, please try again later');
    set({ busy: true, error: null });
    try {
      const job = await hostApiFetch<CronJob>('/api/cron/jobs', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      set((state) => ({
        jobs: [job, ...state.jobs],
        jobsTotal: state.jobsTotal + 1,
        busy: false,
      }));
      void get().fetchStatus();
      return job;
    } catch (error) {
      set({ busy: false, error: String(error) });
      throw error;
    }
  },

  updateJob: async (id, input) => {
    if (guardGatewayTransitioning()) return;
    set({ busy: true, error: null });
    try {
      const updatedJob = await hostApiFetch<CronJob>(`/api/cron/jobs/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
      set((state) => ({
        jobs: state.jobs.map((job) => (job.id === id ? updatedJob : job)),
        busy: false,
      }));
      void get().fetchStatus();
    } catch (error) {
      set({ busy: false, error: String(error) });
      throw error;
    }
  },

  deleteJob: async (id) => {
    if (guardGatewayTransitioning()) return;
    set({ busy: true, error: null });
    try {
      await hostApiFetch(`/api/cron/jobs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      set((state) => ({
        jobs: state.jobs.filter((job) => job.id !== id),
        jobsTotal: Math.max(0, state.jobsTotal - 1),
        selectedJobId: state.selectedJobId === id ? null : state.selectedJobId,
        busy: false,
      }));
      void get().fetchStatus();
    } catch (error) {
      set({ busy: false, error: String(error) });
      throw error;
    }
  },

  toggleJob: async (id, enabled) => {
    if (guardGatewayTransitioning()) return;
    set({ busy: true, error: null });
    try {
      await hostApiFetch('/api/cron/toggle', {
        method: 'POST',
        body: JSON.stringify({ id, enabled }),
      });
      set((state) => ({
        jobs: state.jobs.map((job) => (job.id === id ? { ...job, enabled } : job)),
        busy: false,
      }));
      void get().fetchStatus();
    } catch (error) {
      set({ busy: false, error: String(error) });
      throw error;
    }
  },

  triggerJob: async (id) => {
    if (guardGatewayTransitioning()) return;
    set({ busy: true, error: null });
    try {
      await hostApiFetch('/api/cron/trigger', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      set({ busy: false });
      await Promise.all([get().fetchJobs(), get().fetchRuns()]);
    } catch (error) {
      set({ busy: false, error: String(error) });
      throw error;
    }
  },

  setJobs: (jobs) => set({
    jobs: Array.isArray(jobs) ? jobs : [],
    jobsTotal: Array.isArray(jobs) ? jobs.length : 0,
    jobsHasMore: false,
    jobsNextOffset: null,
  }),
}));
