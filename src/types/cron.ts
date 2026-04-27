/**
 * Cron Job Type Definitions
 * Types for scheduled tasks
 */

import { ChannelType } from './channel';

export type CronJobDeliveryMode = 'none' | 'announce';
export type CronJobDeliveryStatus = 'delivered' | 'not-delivered' | 'unknown' | 'not-requested';
export type CronRunStatus = 'ok' | 'error' | 'skipped' | 'unknown';
export type CronWakeMode = 'now' | 'next-heartbeat';
export type CronSessionTarget = 'main' | 'isolated' | string;

export interface CronJobDelivery {
  mode: CronJobDeliveryMode | 'webhook';
  channel?: ChannelType | string;
  to?: string;
  accountId?: string;
  bestEffort?: boolean;
}

export interface CronFailureAlertConfig {
  after?: number;
  channel?: ChannelType | string;
  to?: string;
  mode?: CronJobDelivery['mode'];
  accountId?: string;
  cooldownMs?: number;
}

export type CronFailureAlert = boolean | CronFailureAlertConfig | undefined;

export type CronPayload =
  | {
    kind: 'systemEvent';
    text: string;
  }
  | {
    kind: 'agentTurn';
    message: string;
    model?: string;
    thinking?: string;
    timeoutSeconds?: number;
    lightContext?: boolean;
  };

export interface CronJobState {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: CronRunStatus | string;
  lastStatus?: CronRunStatus | string;
  lastError?: string;
  lastDurationMs?: number;
  lastDelivered?: boolean;
  lastDeliveryStatus?: CronJobDeliveryStatus | string;
  consecutiveErrors?: number;
}

/**
 * Cron job target (where to send the result)
 */
export interface CronJobTarget {
  channelType: ChannelType | string;
  channelId: string;
  channelName: string;
  recipient?: string;
}

/**
 * Cron job last run info
 */
export interface CronJobLastRun {
  time: string;
  success: boolean;
  error?: string;
  duration?: number;
}

/**
 * Gateway CronSchedule object format
 */
export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string; staggerMs?: number };

/**
 * Cron job data structure
 * schedule can be a plain cron string or a Gateway CronSchedule object
 */
export interface CronJob {
  id: string;
  name: string;
  description?: string;
  agentId?: string;
  sessionKey?: string;
  sessionTarget?: CronSessionTarget;
  wakeMode?: CronWakeMode | string;
  message: string;
  payload?: CronPayload;
  schedule: string | CronSchedule;
  delivery?: CronJobDelivery;
  failureAlert?: CronFailureAlert;
  deleteAfterRun?: boolean;
  target?: CronJobTarget;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRun?: CronJobLastRun;
  nextRun?: string;
  state?: CronJobState;
}

export interface CronStatus {
  enabled?: boolean;
  jobs?: number;
  nextWakeAtMs?: number;
  gatewayAvailable?: boolean;
  error?: string;
}

export interface CronJobsResponse {
  jobs: CronJob[];
  total: number;
  offset: number;
  nextOffset: number | null;
  hasMore: boolean;
  gatewayAvailable?: boolean;
}

export interface CronRunEntry {
  id?: string;
  jobId?: string;
  jobName?: string;
  action?: string;
  status?: CronRunStatus | string;
  error?: string;
  summary?: string;
  delivered?: boolean;
  deliveryStatus?: CronJobDeliveryStatus | string;
  sessionId?: string;
  sessionKey?: string;
  ts?: number;
  runAtMs?: number;
  nextRunAtMs?: number;
  durationMs?: number;
  model?: string;
  provider?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    [key: string]: unknown;
  };
}

export interface CronRunsResponse {
  entries: CronRunEntry[];
  total: number;
  offset: number;
  nextOffset: number | null;
  hasMore: boolean;
  gatewayAvailable?: boolean;
}

/**
 * Input for creating a cron job from the UI.
 */
export interface CronJobCreateInput {
  name: string;
  description?: string;
  agentId?: string | null;
  sessionKey?: string | null;
  sessionTarget?: CronSessionTarget;
  wakeMode?: CronWakeMode | string;
  message: string;
  payload?: CronPayload;
  schedule: string | CronSchedule;
  delivery?: CronJobDelivery;
  failureAlert?: CronFailureAlert;
  deleteAfterRun?: boolean;
  enabled?: boolean;
}

/**
 * Input for updating a cron job
 */
export interface CronJobUpdateInput {
  name?: string;
  description?: string;
  agentId?: string | null;
  sessionKey?: string | null;
  sessionTarget?: CronSessionTarget;
  wakeMode?: CronWakeMode | string;
  message?: string;
  payload?: CronPayload;
  schedule?: string | CronSchedule;
  delivery?: CronJobDelivery;
  failureAlert?: CronFailureAlert;
  deleteAfterRun?: boolean;
  enabled?: boolean;
}

/**
 * Schedule type for UI picker
 */
export type ScheduleType = 'daily' | 'weekly' | 'monthly' | 'interval' | 'custom';

export interface CronJobFilters {
  query: string;
  enabled: 'all' | 'enabled' | 'disabled';
  scheduleKind: 'all' | CronSchedule['kind'];
  lastStatus: 'all' | CronRunStatus;
  sortBy: 'nextRunAtMs' | 'updatedAtMs' | 'name';
  sortDir: 'asc' | 'desc';
}

export interface CronRunFilters {
  scope: 'all' | 'job';
  jobId: string | null;
  statuses: CronRunStatus[];
  deliveryStatuses: CronJobDeliveryStatus[];
  query: string;
  sortDir: 'asc' | 'desc';
}
