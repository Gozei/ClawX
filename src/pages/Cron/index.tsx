import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  History,
  Loader2,
  HelpCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Trash2,
  Webhook,
  X,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { modalCardClasses, modalOverlayClasses } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { hostApiFetch } from '@/lib/host-api';
import { useBranding } from '@/lib/branding';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useCronStore } from '@/stores/cron';
import { isCronSessionKey } from '@/stores/chat/cron-session-utils';
import { useGatewayStore } from '@/stores/gateway';
import type {
  CronFailureAlert,
  CronJob,
  CronJobCreateInput,
  CronJobDelivery,
  CronPayload,
  CronSchedule,
} from '@/types/cron';
import { CHANNEL_NAMES, type ChannelType } from '@/types/channel';

type TabValue = 'jobs' | 'runs';
type ScheduleKind = CronSchedule['kind'];
type PayloadKind = CronPayload['kind'];
type DeliveryMode = CronJobDelivery['mode'];
type FailureAlertMode = 'inherit' | 'disabled' | 'custom';
type CalendarMode = 'daily' | 'weekly' | 'monthly' | 'weekdays' | 'custom';

interface DeliveryChannelAccount {
  accountId: string;
  name: string;
  isDefault: boolean;
}

interface DeliveryChannelGroup {
  channelType: string;
  defaultAccountId: string;
  accounts: DeliveryChannelAccount[];
}

interface ChannelTargetOption {
  value: string;
  label: string;
  kind: 'user' | 'group' | 'channel';
}

interface CronFormState {
  name: string;
  description: string;
  enabled: boolean;
  scheduleKind: ScheduleKind;
  scheduleAt: string;
  everyAmount: string;
  everyUnit: 'minutes' | 'hours' | 'days';
  calendarMode: CalendarMode;
  calendarTime: string;
  calendarWeekday: string;
  calendarMonthDay: string;
  cronExpr: string;
  cronTz: string;
  scheduleExact: boolean;
  staggerAmount: string;
  staggerUnit: 'seconds' | 'minutes';
  agentId: string;
  sessionKey: string;
  sessionTarget: 'isolated' | 'main';
  wakeMode: 'next-heartbeat' | 'now';
  deleteAfterRun: boolean;
  payloadKind: PayloadKind;
  payloadText: string;
  payloadModel: string;
  payloadThinking: string;
  timeoutSeconds: string;
  payloadLightContext: boolean;
  deliveryMode: DeliveryMode;
  deliveryChannel: string;
  deliveryTo: string;
  deliveryAccountId: string;
  deliveryBestEffort: boolean;
  failureAlertMode: FailureAlertMode;
  failureAlertAfter: string;
  failureAlertCooldownSeconds: string;
  failureAlertChannel: string;
  failureAlertTo: string;
  failureAlertAccountId: string;
}

const TESTED_CRON_DELIVERY_CHANNELS = new Set<string>(['feishu', 'telegram', 'qqbot', 'wecom', 'wechat']);

const defaultForm: CronFormState = {
  name: '',
  description: '',
  enabled: true,
  scheduleKind: 'every',
  scheduleAt: '',
  everyAmount: '30',
  everyUnit: 'minutes',
  calendarMode: 'daily',
  calendarTime: '09:00',
  calendarWeekday: '1',
  calendarMonthDay: '1',
  cronExpr: '0 9 * * *',
  cronTz: '',
  scheduleExact: false,
  staggerAmount: '',
  staggerUnit: 'seconds',
  agentId: '',
  sessionKey: '',
  sessionTarget: 'isolated',
  wakeMode: 'next-heartbeat',
  deleteAfterRun: false,
  payloadKind: 'agentTurn',
  payloadText: '',
  payloadModel: '',
  payloadThinking: '',
  timeoutSeconds: '',
  payloadLightContext: false,
  deliveryMode: 'none',
  deliveryChannel: '',
  deliveryTo: '',
  deliveryAccountId: '',
  deliveryBestEffort: false,
  failureAlertMode: 'inherit',
  failureAlertAfter: '2',
  failureAlertCooldownSeconds: '3600',
  failureAlertChannel: '',
  failureAlertTo: '',
  failureAlertAccountId: '',
};

function isKnownChannelType(value: string): value is ChannelType {
  return value in CHANNEL_NAMES;
}

function getChannelDisplayName(value: string): string {
  return isKnownChannelType(value) ? CHANNEL_NAMES[value] : value;
}

function getDeliveryAccountDisplayName(account: DeliveryChannelAccount, fallback: string): string {
  return account.accountId === 'default' && account.name === account.accountId ? fallback : account.name;
}

function formatDateTime(value: string | number | undefined, fallback = 'N/A'): string {
  if (value == null) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

function formatMs(value: number | undefined, fallback = 'N/A'): string {
  if (!value || !Number.isFinite(value)) return fallback;
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 10_000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value / 1000)}s`;
}

function getPayloadText(job: CronJob): string {
  if (job.payload?.kind === 'systemEvent') return job.payload.text;
  if (job.payload?.kind === 'agentTurn') return job.payload.message;
  return job.message;
}

function isCronAny(value: string): boolean {
  return value === '*' || value === '?';
}

function isCronNumber(value: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(value)) return false;
  const numberValue = Number(value);
  return numberValue >= min && numberValue <= max;
}

function formatCronTime(hour: string, minute: string): string {
  return `${String(Number(hour)).padStart(2, '0')}:${String(Number(minute)).padStart(2, '0')}`;
}

function splitCronTime(time: string): { hour: string; minute: string } | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour: String(hour), minute: String(minute) };
}

function formatCronExpression(expr: string, t: TFunction<'cron'>): string {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return t('schedule.customCron');
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (minute === '*' && isCronAny(hour) && isCronAny(dayOfMonth) && isCronAny(month) && isCronAny(dayOfWeek)) {
    return t('schedule.everyMinute');
  }
  const minuteStep = minute.match(/^\*\/(\d+)$/);
  if (minuteStep && isCronAny(hour) && isCronAny(dayOfMonth) && isCronAny(month) && isCronAny(dayOfWeek)) {
    return t('schedule.everyMinutes', { count: Number(minuteStep[1]) });
  }
  if (isCronNumber(minute, 0, 59) && isCronAny(hour) && isCronAny(dayOfMonth) && isCronAny(month) && isCronAny(dayOfWeek)) {
    return t('schedule.hourlyAtMinute', { minute: String(Number(minute)).padStart(2, '0') });
  }
  const hourStep = hour.match(/^\*\/(\d+)$/);
  if (isCronNumber(minute, 0, 59) && hourStep && isCronAny(dayOfMonth) && isCronAny(month) && isCronAny(dayOfWeek)) {
    return t('schedule.everyHoursAtMinute', { count: Number(hourStep[1]), minute: String(Number(minute)).padStart(2, '0') });
  }
  if (isCronNumber(minute, 0, 59) && isCronNumber(hour, 0, 23) && isCronAny(dayOfMonth) && isCronAny(month) && isCronAny(dayOfWeek)) {
    return t('schedule.dailyAt', { time: formatCronTime(hour, minute) });
  }
  if (isCronNumber(minute, 0, 59) && isCronNumber(hour, 0, 23) && isCronAny(dayOfMonth) && isCronAny(month) && isCronNumber(dayOfWeek, 0, 7)) {
    const weekdayIndex = Number(dayOfWeek) === 7 ? 0 : Number(dayOfWeek);
    return t('schedule.weeklyAt', { day: t(`weekdays.${weekdayIndex}`), time: formatCronTime(hour, minute) });
  }
  if (isCronNumber(minute, 0, 59) && isCronNumber(hour, 0, 23) && isCronAny(dayOfMonth) && isCronAny(month) && dayOfWeek === '1-5') {
    return t('schedule.weekdaysAt', { time: formatCronTime(hour, minute) });
  }
  if (isCronNumber(minute, 0, 59) && isCronNumber(hour, 0, 23) && isCronNumber(dayOfMonth, 1, 31) && isCronAny(month) && isCronAny(dayOfWeek)) {
    return t('schedule.monthlyAtDay', { day: Number(dayOfMonth), time: formatCronTime(hour, minute) });
  }

  return t('schedule.customCron');
}

function parseCalendarCron(expr: string): Pick<CronFormState, 'calendarMode' | 'calendarTime' | 'calendarWeekday' | 'calendarMonthDay'> {
  const defaults = {
    calendarMode: defaultForm.calendarMode,
    calendarTime: defaultForm.calendarTime,
    calendarWeekday: defaultForm.calendarWeekday,
    calendarMonthDay: defaultForm.calendarMonthDay,
  };
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return { ...defaults, calendarMode: 'custom' };
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const hasTime = isCronNumber(minute, 0, 59) && isCronNumber(hour, 0, 23);
  const calendarTime = hasTime ? formatCronTime(hour, minute) : defaults.calendarTime;
  if (hasTime && isCronAny(dayOfMonth) && isCronAny(month) && isCronAny(dayOfWeek)) {
    return { ...defaults, calendarMode: 'daily', calendarTime };
  }
  if (hasTime && isCronAny(dayOfMonth) && isCronAny(month) && dayOfWeek === '1-5') {
    return { ...defaults, calendarMode: 'weekdays', calendarTime };
  }
  if (hasTime && isCronAny(dayOfMonth) && isCronAny(month) && isCronNumber(dayOfWeek, 0, 7)) {
    return { ...defaults, calendarMode: 'weekly', calendarTime, calendarWeekday: String(Number(dayOfWeek) === 7 ? 0 : Number(dayOfWeek)) };
  }
  if (hasTime && isCronNumber(dayOfMonth, 1, 31) && isCronAny(month) && isCronAny(dayOfWeek)) {
    return { ...defaults, calendarMode: 'monthly', calendarTime, calendarMonthDay: String(Number(dayOfMonth)) };
  }
  return { ...defaults, calendarMode: 'custom', calendarTime };
}

function buildCalendarCronExpression(form: CronFormState, t: TFunction<'cron'>): string {
  if (form.calendarMode === 'custom') {
    if (!form.cronExpr.trim()) throw new Error(t('validation.cronRequired'));
    return form.cronExpr.trim();
  }
  const time = splitCronTime(form.calendarTime);
  if (!time) throw new Error(t('validation.calendarTimeInvalid'));
  const { hour, minute } = time;
  if (form.calendarMode === 'daily') return `${minute} ${hour} * * *`;
  if (form.calendarMode === 'weekdays') return `${minute} ${hour} * * 1-5`;
  if (form.calendarMode === 'weekly') {
    const weekday = Number(form.calendarWeekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error(t('validation.weekdayInvalid'));
    return `${minute} ${hour} * * ${weekday}`;
  }
  const day = Number(form.calendarMonthDay);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error(t('validation.monthDayInvalid'));
  return `${minute} ${hour} ${day} * *`;
}

function formatSchedule(schedule: CronJob['schedule'], t: TFunction<'cron'>): string {
  const value: CronSchedule = typeof schedule === 'string' ? { kind: 'cron', expr: schedule } : schedule;
  const fallback = t('values.notAvailable');
  if (!value || typeof value !== 'object') return fallback;
  if (value.kind === 'at') return t('schedule.onceAt', { time: formatDateTime(value.at, fallback) });
  if (value.kind === 'every') {
    const minutes = Math.round(value.everyMs / 60_000);
    if (minutes < 60) return t('schedule.everyMinutes', { count: minutes });
    if (minutes < 1440) return t('schedule.everyHours', { count: Math.round(minutes / 60) });
    return t('schedule.everyDays', { count: Math.round(minutes / 1440) });
  }
  const parts = [formatCronExpression(value.expr, t)];
  if (value.tz) parts.push(value.tz);
  if (typeof value.staggerMs === 'number') parts.push(value.staggerMs === 0 ? t('schedule.exact') : t('schedule.stagger', { value: formatMs(value.staggerMs, fallback) }));
  return parts.join(' · ');
}

function estimateNextRun(scheduleExpr: string): string | null {
  const now = new Date();
  const next = new Date(now.getTime());

  if (scheduleExpr === '* * * * *') {
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);
    return next.toLocaleString();
  }
  if (scheduleExpr === '*/5 * * * *') {
    const delta = 5 - (next.getMinutes() % 5 || 5);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + delta);
    return next.toLocaleString();
  }
  if (scheduleExpr === '*/15 * * * *') {
    const delta = 15 - (next.getMinutes() % 15 || 15);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + delta);
    return next.toLocaleString();
  }
  if (scheduleExpr === '0 * * * *') {
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.toLocaleString();
  }
  if (scheduleExpr === '0 9 * * *' || scheduleExpr === '0 18 * * *') {
    const targetHour = scheduleExpr === '0 9 * * *' ? 9 : 18;
    next.setSeconds(0, 0);
    next.setHours(targetHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toLocaleString();
  }
  return null;
}

function scheduleKindFromJob(job?: CronJob): ScheduleKind {
  if (!job) return 'every';
  const schedule = typeof job.schedule === 'string' ? { kind: 'cron' as const } : job.schedule;
  return schedule.kind;
}

function getDefaultScheduleAt(): string {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}T${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
}

function translateStatus(t: TFunction<'cron'>, status: string): string {
  return t(`status.${status}`, { defaultValue: status });
}

function getLastStatus(job: CronJob): string {
  return String(job.state?.lastStatus ?? job.state?.lastRunStatus ?? (job.lastRun ? (job.lastRun.success ? 'ok' : 'error') : 'unknown'));
}

function getDeliveryStatus(job: CronJob): string {
  return String(job.state?.lastDeliveryStatus ?? (job.state?.lastDelivered === true ? 'delivered' : job.state?.lastDelivered === false ? 'not-delivered' : 'not-requested'));
}

function statusVariant(status: string): 'success' | 'destructive' | 'warning' | 'outline' {
  if (status === 'ok' || status === 'delivered') return 'success';
  if (status === 'error' || status === 'not-delivered') return 'destructive';
  if (status === 'skipped' || status === 'unknown') return 'warning';
  return 'outline';
}

function deliveryIcon(mode: DeliveryMode | undefined) {
  if (mode === 'webhook') return <Webhook className="h-3.5 w-3.5" />;
  if (mode === 'announce') return <Send className="h-3.5 w-3.5" />;
  return <Clock className="h-3.5 w-3.5" />;
}

function toInputDateTime(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function normalizeEveryInput(everyMs: number | undefined): Pick<CronFormState, 'everyAmount' | 'everyUnit'> {
  if (!Number.isFinite(everyMs) || !everyMs || everyMs <= 0) {
    return { everyAmount: defaultForm.everyAmount, everyUnit: defaultForm.everyUnit };
  }

  if (everyMs % 86_400_000 === 0) {
    return { everyAmount: String(everyMs / 86_400_000), everyUnit: 'days' };
  }
  if (everyMs % 3_600_000 === 0) {
    return { everyAmount: String(everyMs / 3_600_000), everyUnit: 'hours' };
  }
  return { everyAmount: String(Math.max(1, Math.round(everyMs / 60_000))), everyUnit: 'minutes' };
}

function formFromJob(job?: CronJob): CronFormState {
  if (!job) return { ...defaultForm };
  const schedule = typeof job.schedule === 'string' ? { kind: 'cron' as const, expr: job.schedule } : job.schedule;
  const payload = job.payload ?? { kind: 'agentTurn' as const, message: job.message };
  const failureAlert = job.failureAlert;
  const customFailureAlert = failureAlert && typeof failureAlert === 'object' ? failureAlert : undefined;
  const everyInput = schedule.kind === 'every' ? normalizeEveryInput(schedule.everyMs) : normalizeEveryInput(undefined);
  const calendarInput = schedule.kind === 'cron' ? parseCalendarCron(schedule.expr) : parseCalendarCron(defaultForm.cronExpr);
  return {
    ...defaultForm,
    name: job.name,
    description: job.description ?? '',
    enabled: job.enabled,
    scheduleKind: schedule.kind,
    scheduleAt: schedule.kind === 'at' ? toInputDateTime(schedule.at) : '',
    everyAmount: everyInput.everyAmount,
    everyUnit: everyInput.everyUnit,
    calendarMode: calendarInput.calendarMode,
    calendarTime: calendarInput.calendarTime,
    calendarWeekday: calendarInput.calendarWeekday,
    calendarMonthDay: calendarInput.calendarMonthDay,
    cronExpr: schedule.kind === 'cron' ? schedule.expr : defaultForm.cronExpr,
    cronTz: schedule.kind === 'cron' ? schedule.tz ?? '' : '',
    scheduleExact: schedule.kind === 'cron' && schedule.staggerMs === 0,
    staggerAmount: schedule.kind === 'cron' && schedule.staggerMs && schedule.staggerMs > 0 ? String(Math.round(schedule.staggerMs / 1000)) : '',
    staggerUnit: 'seconds',
    agentId: job.agentId ?? '',
    sessionKey: job.sessionKey ?? '',
    sessionTarget: job.sessionTarget === 'main' ? 'main' : 'isolated',
    wakeMode: job.wakeMode === 'now' ? 'now' : 'next-heartbeat',
    deleteAfterRun: job.deleteAfterRun === true,
    payloadKind: payload.kind,
    payloadText: payload.kind === 'systemEvent' ? payload.text : payload.message,
    payloadModel: payload.kind === 'agentTurn' ? payload.model ?? '' : '',
    payloadThinking: payload.kind === 'agentTurn' ? payload.thinking ?? '' : '',
    timeoutSeconds: payload.kind === 'agentTurn' && payload.timeoutSeconds ? String(payload.timeoutSeconds) : '',
    payloadLightContext: payload.kind === 'agentTurn' && payload.lightContext === true,
    deliveryMode: job.delivery?.mode ?? 'none',
    deliveryChannel: typeof job.delivery?.channel === 'string' ? job.delivery.channel : '',
    deliveryTo: job.delivery?.to ?? '',
    deliveryAccountId: job.delivery?.accountId ?? '',
    deliveryBestEffort: job.delivery?.bestEffort === true,
    failureAlertMode: failureAlert === false ? 'disabled' : customFailureAlert ? 'custom' : 'inherit',
    failureAlertAfter: customFailureAlert?.after ? String(customFailureAlert.after) : defaultForm.failureAlertAfter,
    failureAlertCooldownSeconds: customFailureAlert?.cooldownMs ? String(Math.round(customFailureAlert.cooldownMs / 1000)) : defaultForm.failureAlertCooldownSeconds,
    failureAlertChannel: customFailureAlert?.channel ?? '',
    failureAlertTo: customFailureAlert?.to ?? '',
    failureAlertAccountId: customFailureAlert?.accountId ?? '',
  };
}

function buildSchedule(form: CronFormState, t: TFunction<'cron'>): CronSchedule {
  if (form.scheduleKind === 'at') {
    const timestamp = Date.parse(form.scheduleAt);
    if (!Number.isFinite(timestamp)) throw new Error(t('validation.runTimeInvalid'));
    return { kind: 'at', at: new Date(timestamp).toISOString() };
  }
  if (form.scheduleKind === 'every') {
    const amount = Number(form.everyAmount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(t('validation.intervalPositive'));
    const multiplier = form.everyUnit === 'days' ? 86_400_000 : form.everyUnit === 'hours' ? 3_600_000 : 60_000;
    return { kind: 'every', everyMs: Math.round(amount * multiplier) };
  }
  const schedule: CronSchedule = { kind: 'cron', expr: buildCalendarCronExpression(form, t) };
  if (form.cronTz.trim()) schedule.tz = form.cronTz.trim();
  if (form.scheduleExact) {
    schedule.staggerMs = 0;
  } else if (form.staggerAmount.trim()) {
    const amount = Number(form.staggerAmount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(t('validation.staggerPositive'));
    schedule.staggerMs = Math.round(amount * (form.staggerUnit === 'minutes' ? 60_000 : 1000));
  }
  return schedule;
}

function buildPayload(form: CronFormState, t: TFunction<'cron'>): CronPayload {
  const text = form.payloadText.trim();
  const isSystemEvent = form.sessionTarget === 'main' || form.payloadKind === 'systemEvent';
  if (!text) throw new Error(isSystemEvent ? t('validation.systemEventRequired') : t('validation.promptRequired'));
  if (isSystemEvent) return { kind: 'systemEvent', text };
  const payload: CronPayload = { kind: 'agentTurn', message: text };
  if (form.payloadModel.trim()) payload.model = form.payloadModel.trim();
  if (form.payloadThinking.trim()) payload.thinking = form.payloadThinking.trim();
  if (form.timeoutSeconds.trim()) {
    const timeoutSeconds = Number(form.timeoutSeconds);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error(t('validation.timeoutPositive'));
    payload.timeoutSeconds = Math.round(timeoutSeconds);
  }
  if (form.payloadLightContext) payload.lightContext = true;
  return payload;
}

function buildDelivery(form: CronFormState, t: TFunction<'cron'>): CronJobDelivery {
  if (form.deliveryMode === 'none') return { mode: 'none' };
  if (form.deliveryMode === 'webhook') {
    if (!/^https?:\/\//i.test(form.deliveryTo.trim())) throw new Error(t('validation.webhookUrl'));
    return { mode: 'webhook', to: form.deliveryTo.trim(), bestEffort: form.deliveryBestEffort };
  }
  if (!form.deliveryChannel.trim()) throw new Error(t('validation.deliveryChannelRequired'));
  if (!TESTED_CRON_DELIVERY_CHANNELS.has(form.deliveryChannel.trim())) {
    throw new Error(t('dialog.deliveryChannelUnsupported', { channel: getChannelDisplayName(form.deliveryChannel.trim()) }));
  }
  if (!form.deliveryTo.trim()) throw new Error(t('validation.deliveryTargetRequired'));
  return {
    mode: 'announce',
    channel: form.deliveryChannel.trim(),
    to: form.deliveryTo.trim(),
    ...(form.deliveryAccountId.trim() ? { accountId: form.deliveryAccountId.trim() } : {}),
    bestEffort: form.deliveryBestEffort,
  };
}

function buildFailureAlert(form: CronFormState, t: TFunction<'cron'>): CronFailureAlert {
  if (form.failureAlertMode === 'disabled') return false;
  if (form.failureAlertMode !== 'custom') return undefined;
  const after = Number(form.failureAlertAfter);
  if (!Number.isFinite(after) || after <= 0) throw new Error(t('validation.failureAfterPositive'));
  const cooldown = form.failureAlertCooldownSeconds.trim() ? Number(form.failureAlertCooldownSeconds) : 0;
  if (!Number.isFinite(cooldown) || cooldown < 0) throw new Error(t('validation.failureCooldownPositive'));
  return {
    after: Math.round(after),
    cooldownMs: Math.round(cooldown * 1000),
    ...(form.failureAlertChannel.trim() ? { channel: form.failureAlertChannel.trim() } : {}),
    ...(form.failureAlertTo.trim() ? { to: form.failureAlertTo.trim() } : {}),
    ...(form.failureAlertAccountId.trim() ? { accountId: form.failureAlertAccountId.trim() } : {}),
  };
}

function buildInput(form: CronFormState, t: TFunction<'cron'>): CronJobCreateInput {
  if (!form.name.trim()) throw new Error(t('validation.nameRequired'));
  const payload = buildPayload(form, t);
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    agentId: form.agentId.trim() || undefined,
    sessionKey: form.sessionKey.trim() || undefined,
    sessionTarget: form.sessionTarget,
    wakeMode: form.wakeMode,
    enabled: form.enabled,
    deleteAfterRun: form.deleteAfterRun,
    schedule: buildSchedule(form, t),
    payload,
    message: payload.kind === 'agentTurn' ? payload.message : payload.text,
    delivery: buildDelivery(form, t),
    failureAlert: buildFailureAlert(form, t),
  };
}

function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation('cron');
  return <Badge variant={statusVariant(status)}>{translateStatus(t, status)}</Badge>;
}

function SelectField(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <Select {...props} className={cn('h-10 rounded-lg bg-background pr-9 text-[13px]', props.className)} />
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

async function canOpenRunSession(sessionKey: string): Promise<boolean> {
  if (!sessionKey.trim()) return false;
  if (isCronSessionKey(sessionKey)) {
    const response = await hostApiFetch<{ success?: boolean; messages?: unknown[] }>(`/api/cron/session-history?${new URLSearchParams({ sessionKey, limit: '1' }).toString()}`);
    return response.success !== false && Array.isArray(response.messages) && response.messages.length > 0;
  }
  const response = await hostApiFetch<{ success?: boolean; history?: unknown[]; messages?: unknown[] }>('/api/sessions/history', {
    method: 'POST',
    body: JSON.stringify({ sessionKey, limit: 1 }),
  });
  const entries = Array.isArray(response.history) ? response.history : response.messages;
  return response.success !== false && Array.isArray(entries) && entries.length > 0;
}

function CronStatusStrip() {
  const { t } = useTranslation('cron');
  const status = useCronStore((state) => state.status);
  const statusLoading = useCronStore((state) => state.statusLoading);
  const statusError = useCronStore((state) => state.statusError);
  const jobs = useCronStore((state) => state.jobs);
  const failedJobs = jobs.filter((job) => getLastStatus(job) === 'error').length;
  const deliveryFailedJobs = jobs.filter((job) => getDeliveryStatus(job) === 'not-delivered').length;
  const items = [
    {
      label: t('summary.enabled', 'Cron status'),
      value: statusLoading ? '...' : statusError ? t('states.unavailable') : status?.enabled === false ? t('common:status.disabled', 'Disabled') : t('common:status.enabled', 'Enabled'),
      icon: status?.enabled === false ? Pause : Play,
      muted: status?.enabled === false,
    },
    { label: t('summary.jobs', 'Jobs'), value: String(status?.jobs ?? jobs.length), icon: Clock },
    { label: t('summary.nextWake', 'Next wake'), value: formatDateTime(status?.nextWakeAtMs, t('values.notAvailable')), icon: Calendar },
    { label: t('stats.failed', 'Failed'), value: String(failedJobs), icon: XCircle, danger: failedJobs > 0 },
    { label: t('runs.delivery', 'Delivery'), value: String(deliveryFailedJobs), icon: Send, danger: deliveryFailedJobs > 0 },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.label} className="rounded-xl border border-black/5 bg-black/[0.025] px-4 py-3 dark:border-white/10 dark:bg-white/[0.035]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-medium text-muted-foreground">{item.label}</span>
              <Icon className={cn('h-4 w-4 text-muted-foreground', item.danger && 'text-destructive', item.muted && 'opacity-60')} />
            </div>
            <div className={cn('mt-2 truncate text-[15px] font-semibold text-foreground', item.danger && 'text-destructive')}>{item.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function CronPageNotices({
  activeTab,
  error,
  channelsError,
}: {
  activeTab: TabValue;
  error: string | null;
  channelsError: string | null;
}) {
  const { t } = useTranslation('cron');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const {
    status,
    statusError,
    jobsGatewayAvailable,
    jobsError,
    runsGatewayAvailable,
    runsError,
  } = useCronStore();
  const isGatewayRunning = gatewayStatus.state === 'running';
  const notices: Array<{ key: string; tone: 'warning' | 'error'; message: string }> = [];

  if (!isGatewayRunning) {
    notices.push({ key: 'gateway', tone: 'warning', message: t('gatewayWarning') });
  } else if (error) {
    notices.push({ key: 'global-error', tone: 'error', message: error });
  } else if (status?.gatewayAvailable === false) {
    notices.push({ key: 'status-fallback', tone: 'warning', message: status.error || t('fallback.status') });
  } else if (statusError) {
    notices.push({ key: 'status-error', tone: 'error', message: `${t('errors.statusLoadFailed')}: ${statusError}` });
  }

  if (channelsError && isGatewayRunning) {
    notices.push({ key: 'channels', tone: 'warning', message: `${t('errors.channelsLoadFailed')}: ${channelsError}` });
  }

  if (activeTab === 'jobs') {
    if (jobsGatewayAvailable === false && isGatewayRunning) {
      notices.push({ key: 'jobs-fallback', tone: 'warning', message: t('fallback.jobs') });
    }
    if (jobsError && isGatewayRunning) {
      notices.push({ key: 'jobs-error', tone: 'error', message: `${t('errors.jobsLoadFailed')}: ${jobsError}` });
    }
  }

  if (activeTab === 'runs') {
    if (runsGatewayAvailable === false && isGatewayRunning) {
      notices.push({ key: 'runs-fallback', tone: 'warning', message: t('fallback.runs') });
    }
    if (runsError && isGatewayRunning) {
      notices.push({ key: 'runs-error', tone: 'error', message: `${t('errors.runsLoadFailed')}: ${runsError}` });
    }
  }

  if (notices.length === 0) return null;

  return (
    <div className="mt-4 space-y-2">
      {notices.map((notice) => (
        <div
          key={notice.key}
          className={cn(
            'rounded-xl border px-4 py-3 text-sm',
            notice.tone === 'warning'
              ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300'
              : 'border-destructive/30 bg-destructive/10 text-destructive',
          )}
        >
          <AlertCircle className="mr-2 inline h-4 w-4" />
          {notice.message}
        </div>
      ))}
    </div>
  );
}

function CronJobsTab({
  onEdit,
  onDetails,
  onDelete,
  onRuns,
}: {
  onEdit: (job: CronJob) => void;
  onDetails: (job: CronJob) => void;
  onDelete: (job: CronJob) => void;
  onRuns: (job: CronJob) => void;
}) {
  const { t } = useTranslation('cron');
  const {
    jobs,
    jobsHasMore,
    jobsLoadingMore,
    loading,
    fetchJobs,
    loadMoreJobs,
    toggleJob,
    triggerJob,
  } = useCronStore();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchJobs();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [fetchJobs]);

  const visibleJobs = jobs;

  if (loading && jobs.length === 0) {
    return <div className="py-16"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-black/8 dark:border-white/10">
        <div className="grid grid-cols-[minmax(260px,1.5fr)_minmax(170px,1fr)_120px_130px_120px] gap-4 border-b border-black/8 px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground dark:border-white/10 max-lg:hidden">
          <div>{t('dialog.taskName', 'Task')}</div>
          <div>{t('dialog.schedule', 'Schedule')}</div>
          <div>{t('card.next', 'Next')}</div>
          <div>{t('card.last', 'Last')}</div>
          <div className="text-right">{t('common:actions.actions', 'Actions')}</div>
        </div>
        {visibleJobs.length === 0 ? (
          <div className="px-4 py-14 text-center text-sm text-muted-foreground">
            <Clock className="mx-auto mb-3 h-8 w-8 opacity-50" />
            {t('empty.title', 'No scheduled tasks')}
          </div>
        ) : visibleJobs.map((job) => {
          const lastStatus = getLastStatus(job);
          const deliveryStatus = getDeliveryStatus(job);
          const channel = typeof job.delivery?.channel === 'string' ? job.delivery.channel : '';
          return (
            <div
              key={job.id}
              className="grid cursor-pointer grid-cols-1 gap-3 border-b border-black/5 px-4 py-4 transition-colors last:border-b-0 hover:bg-black/[0.025] dark:border-white/8 dark:hover:bg-white/[0.035] lg:grid-cols-[minmax(260px,1.5fr)_minmax(170px,1fr)_120px_130px_120px] lg:items-center"
              onClick={() => onDetails(job)}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={job.enabled}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={(enabled) => {
                      void toggleJob(job.id, enabled).then(() => toast.success(enabled ? t('toast.enabled') : t('toast.paused'))).catch(() => toast.error(t('toast.failedUpdate')));
                    }}
                  />
                  <div className="truncate font-semibold text-foreground">{job.name}</div>
                  {job.state?.consecutiveErrors ? <Badge variant="destructive">{t('jobs.consecutiveErrors', { count: job.state.consecutiveErrors })}</Badge> : null}
                </div>
                <div className="mt-1 line-clamp-1 text-[13px] text-muted-foreground">{job.description || getPayloadText(job)}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5" />{job.agentId || t('values.mainAgent')}</span>
                  <span className="inline-flex items-center gap-1">{deliveryIcon(job.delivery?.mode)}{t(`deliveryModes.${job.delivery?.mode ?? 'none'}`)}</span>
                  {channel ? <span>{getChannelDisplayName(channel)}</span> : null}
                </div>
              </div>
              <div className="text-[13px] text-foreground/80">{formatSchedule(job.schedule, t)}</div>
              <div className="text-[13px] text-muted-foreground">{job.nextRun ? formatRelativeTime(job.nextRun) : t('values.notAvailable')}</div>
              <div className="flex flex-wrap gap-2">
                <StatusPill status={lastStatus} />
                <StatusPill status={deliveryStatus} />
              </div>
              <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                <Button size="icon" variant="ghost" title={t('card.runNow')} onClick={() => void triggerJob(job.id).then(() => toast.success(t('toast.triggered'))).catch((error) => toast.error(t('toast.failedTrigger', { error: error instanceof Error ? error.message : String(error) })))}>
                  <Play className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" title={t('card.last', 'History')} onClick={() => onRuns(job)}>
                  <History className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" title={t('common:actions.edit', 'Edit')} onClick={() => onEdit(job)}>
                  <Settings2 className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" title={t('common:actions.delete', 'Delete')} className="text-destructive" onClick={() => onDelete(job)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end text-[13px] text-muted-foreground">
        {jobsHasMore && (
          <Button variant="outline" onClick={() => void loadMoreJobs()} disabled={jobsLoadingMore}>
            {jobsLoadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('jobs.loadMore', 'Load more')}
          </Button>
        )}
      </div>
    </div>
  );
}

function CronRunsTab() {
  const { t } = useTranslation('cron');
  const {
    jobs,
    runs,
    runsHasMore,
    runsLoading,
    runsLoadingMore,
    fetchRuns,
    loadMoreRuns,
  } = useCronStore();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchRuns();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [fetchRuns]);

  const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const [openingSessionKey, setOpeningSessionKey] = useState<string | null>(null);
  const openRunChat = async (sessionKey: string) => {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) {
      toast.error(t('errors.sessionKeyMissing'));
      return;
    }
    setOpeningSessionKey(normalizedSessionKey);
    try {
      const canOpen = await canOpenRunSession(normalizedSessionKey);
      if (!canOpen) {
        toast.error(t('errors.sessionNotFound'));
        return;
      }
      window.location.hash = `/?session=${encodeURIComponent(normalizedSessionKey)}`;
    } catch (error) {
      toast.error(t('errors.sessionOpenFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setOpeningSessionKey(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-black/8 dark:border-white/10">
        {runsLoading && runs.length === 0 ? (
          <div className="py-16"><LoadingSpinner size="lg" /></div>
        ) : runs.length === 0 ? (
          <div className="px-4 py-14 text-center text-sm text-muted-foreground">
            <History className="mx-auto mb-3 h-8 w-8 opacity-50" />
            {t('runs.noMatching', 'No matching runs')}
          </div>
        ) : runs.map((run) => {
          const job = run.jobId ? jobsById.get(run.jobId) : undefined;
          const status = String(run.status ?? 'unknown');
          const deliveryStatus = String(run.deliveryStatus ?? (run.delivered === true ? 'delivered' : run.delivered === false ? 'not-delivered' : 'not-requested'));
          const tokens = typeof run.usage?.total_tokens === 'number'
            ? t('runEntry.totalTokens', { count: run.usage.total_tokens })
            : typeof run.usage?.input_tokens === 'number' || typeof run.usage?.output_tokens === 'number'
              ? t('runEntry.inputOutputTokens', { input: run.usage.input_tokens ?? 0, output: run.usage.output_tokens ?? 0 })
              : null;
          return (
            <div key={run.id ?? `${run.jobId}-${run.ts}-${run.runAtMs}`} className="border-b border-black/5 px-4 py-4 last:border-b-0 dark:border-white/8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-foreground">{run.jobName || job?.name || run.jobId || t('runs.unknownJob')}</div>
                    <StatusPill status={status} />
                    <StatusPill status={deliveryStatus} />
                  </div>
                  <p className={cn('mt-2 line-clamp-3 text-[13px] leading-6 text-muted-foreground', status === 'error' && 'text-destructive')}>
                    {run.summary || run.error || t('runEntry.noSummary', 'No summary')}
                  </p>
                </div>
                {run.sessionKey && (
                  <Button variant="outline" size="sm" disabled={openingSessionKey === run.sessionKey} onClick={() => void openRunChat(run.sessionKey ?? '')}>
                    {openingSessionKey === run.sessionKey ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {t('runEntry.openRunChat', 'Open chat')}
                  </Button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-muted-foreground">
                <span>{t('runEntry.runAt', 'Run at')} {formatDateTime(run.runAtMs ?? run.ts, t('values.notAvailable'))}</span>
                <span>{formatMs(run.durationMs, t('values.notAvailable'))}</span>
                {run.provider || run.model ? <span>{[run.provider, run.model].filter(Boolean).join('/')}</span> : null}
                {tokens ? <span>{tokens}</span> : null}
                {run.nextRunAtMs ? <span>{t('card.next', 'Next')}: {formatDateTime(run.nextRunAtMs, t('values.notAvailable'))}</span> : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end text-[13px] text-muted-foreground">
        {runsHasMore && (
          <Button variant="outline" onClick={() => void loadMoreRuns()} disabled={runsLoadingMore}>
            {runsLoadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('runs.loadMore', 'Load more')}
          </Button>
        )}
      </div>
    </div>
  );
}

function CronJobEditorDrawer({
  open,
  job,
  configuredChannels,
  onClose,
  onSave,
}: {
  open: boolean;
  job?: CronJob;
  configuredChannels: DeliveryChannelGroup[];
  onClose: () => void;
  onSave: (input: CronJobCreateInput) => Promise<void>;
}) {
  const { t } = useTranslation('cron');
  const branding = useBranding();
  const [form, setFormState] = useState<CronFormState>(() => formFromJob(job));
  const [dialogScheduleKind, setDialogScheduleKind] = useState<ScheduleKind>(() => scheduleKindFromJob(job));
  const [saving, setSaving] = useState(false);
  const [channelTargetOptions, setChannelTargetOptions] = useState<ChannelTargetOption[]>([]);
  const [channelTargetsError, setChannelTargetsError] = useState<string | null>(null);
  const selectableChannels = configuredChannels.filter((group) => TESTED_CRON_DELIVERY_CHANNELS.has(group.channelType));
  const selectedChannel = selectableChannels.find((group) => group.channelType === form.deliveryChannel);
  const accountId = form.deliveryAccountId || selectedChannel?.defaultAccountId || '';
  const accountOptions = selectedChannel?.accounts ?? [];
  const availableTargetOptions = form.deliveryTo
    ? [
      { value: form.deliveryTo, label: `${t('dialog.currentTarget')} (${form.deliveryTo})`, kind: 'user' as const },
      ...channelTargetOptions.filter((option) => option.value !== form.deliveryTo),
    ]
    : channelTargetOptions;
  const setForm = (patch: Partial<CronFormState>) => setFormState((current) => ({ ...current, ...patch }));

  useEffect(() => {
    if (!open) return;
    const nextForm = formFromJob(job);
    setFormState(nextForm);
    setDialogScheduleKind(scheduleKindFromJob(job));
  }, [job, open]);

  useEffect(() => {
    if (!open || form.deliveryMode !== 'announce' || !form.deliveryChannel) {
      setChannelTargetOptions([]);
      setChannelTargetsError(null);
      return;
    }
    let cancelled = false;
    setChannelTargetsError(null);
    const params = new URLSearchParams({ channelType: form.deliveryChannel });
    if (accountId) params.set('accountId', accountId);
    void hostApiFetch<{ success: boolean; targets?: ChannelTargetOption[] }>(`/api/channels/targets?${params.toString()}`)
      .then((result) => {
        if (!cancelled) setChannelTargetOptions(result.targets ?? []);
      })
      .catch((error) => {
        if (!cancelled) {
          setChannelTargetOptions([]);
          setChannelTargetsError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, form.deliveryChannel, form.deliveryMode, open]);

  useEffect(() => {
    if (!open || form.deliveryMode !== 'announce' || form.deliveryTo || channelTargetOptions.length === 0) {
      return;
    }
    setForm({ deliveryTo: channelTargetOptions[0].value });
  }, [channelTargetOptions, form.deliveryMode, form.deliveryTo, open]);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(buildInput({
        ...form,
        scheduleKind: dialogScheduleKind,
        scheduleAt: dialogScheduleKind === 'at' && !form.scheduleAt ? getDefaultScheduleAt() : form.scheduleAt,
        failureAlertMode: 'inherit',
        deliveryChannel: form.deliveryMode === 'announce' ? form.deliveryChannel : '',
        deliveryTo: form.deliveryMode === 'announce' ? form.deliveryTo : '',
        deliveryAccountId: form.deliveryMode === 'announce' ? form.deliveryAccountId : '',
      }, t));
      toast.success(job ? t('toast.updated') : t('toast.created'));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div data-testid="cron-task-dialog-overlay" className={modalOverlayClasses}>
      <Card
        data-testid="cron-task-dialog"
        role="dialog"
        aria-modal="true"
        className={cn(modalCardClasses, 'max-w-[min(32rem,calc(100vw-2rem))] rounded-3xl border-0 bg-background shadow-2xl dark:bg-card')}
      >
        <CardHeader className="flex shrink-0 flex-row items-start justify-between gap-4 pb-2">
          <div>
            <CardTitle className="text-2xl font-semibold">{job ? t('dialog.editTitle') : t('dialog.createTitle')}</CardTitle>
            <CardDescription className="mt-1 text-[15px] text-foreground/70">{t('dialog.description')}</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="-mr-2 -mt-2 h-8 w-8 rounded-full text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="flex-1 space-y-5 overflow-y-auto p-5 pt-4 sm:space-y-6 sm:p-6 sm:pt-4">
          <div className="space-y-2.5">
            <Label htmlFor="name" className="text-[14px] font-bold text-foreground/80">{t('dialog.taskName')}</Label>
            <Input id="name" value={form.name} onChange={(event) => setForm({ name: event.target.value })} placeholder={t('dialog.taskNamePlaceholder')} className="h-[44px] rounded-xl" />
          </div>

          <div className="space-y-2.5">
            <Label htmlFor="message" className="text-[14px] font-bold text-foreground/80">{t('dialog.message')}</Label>
            <Textarea id="message" value={form.payloadText} onChange={(event) => setForm({ payloadText: event.target.value })} rows={3} placeholder={t('dialog.messagePlaceholder')} className="resize-none rounded-xl" />
          </div>

          <div className="space-y-2.5">
            <Label className="text-[14px] font-bold text-foreground/80">{t('dialog.schedule')}</Label>
            <div className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-3">
              {(['every', 'at', 'cron'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setDialogScheduleKind(kind)}
                  className={cn(
                    'flex h-9 items-center justify-center rounded-lg border px-2 text-[12.5px] font-semibold transition-colors',
                    dialogScheduleKind === kind
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-black/10 bg-background text-foreground/78 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5',
                  )}
                >
                  {kind === 'cron' ? t('scheduleKinds.cron') : kind === 'every' ? t('scheduleKinds.every') : t('scheduleKinds.at')}
                </button>
              ))}
            </div>

            {dialogScheduleKind === 'cron' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-1.5 min-[420px]:grid-cols-5">
                  {(['daily', 'weekly', 'monthly', 'weekdays', 'custom'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setForm({ calendarMode: mode })}
                      className={cn(
                        'flex h-9 items-center justify-center rounded-lg border px-2 text-[12px] font-semibold transition-colors',
                        form.calendarMode === mode
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-black/10 bg-background text-foreground/78 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5',
                      )}
                    >
                      {t(`calendarModes.${mode}`)}
                    </button>
                  ))}
                </div>

                {form.calendarMode === 'custom' ? (
                  <div className="space-y-2">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="cron-expr" className="text-[13px] font-bold text-foreground/80">{t('fields.cronExpression')}</Label>
                        <HelpCircle className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="rounded-xl border border-black/10 bg-black/[0.025] p-3 text-[12px] leading-5 text-foreground dark:border-white/10 dark:bg-white/[0.035]">
                        <div className="font-semibold">{t('cronHelp.title')}</div>
                        <div className="mt-1 font-mono">* * * * *</div>
                        <div className="mt-1 text-muted-foreground">{t('cronHelp.fields')}</div>
                        <div className="mt-2 text-muted-foreground">{t('cronHelp.examples')}</div>
                      </div>
                    </div>
                    <Input id="cron-expr" value={form.cronExpr} onChange={(event) => setForm({ cronExpr: event.target.value })} placeholder="0 9 * * *" className="h-10 rounded-lg font-mono text-[13px]" />
                    <p className="text-[12px] font-medium text-muted-foreground/80">
                      {estimateNextRun(form.cronExpr) ? `${t('card.next')}: ${estimateNextRun(form.cronExpr)}` : t('dialog.cronPlaceholder')}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="calendar-time" className="text-[13px] font-bold text-foreground/80">{t('fields.runTime')}</Label>
                      <Input id="calendar-time" type="time" value={form.calendarTime} onChange={(event) => setForm({ calendarTime: event.target.value })} className="h-10 rounded-lg" />
                    </div>
                    {form.calendarMode === 'weekly' && (
                      <div className="space-y-1.5">
                        <Label htmlFor="calendar-weekday" className="text-[13px] font-bold text-foreground/80">{t('fields.weekday')}</Label>
                        <SelectField id="calendar-weekday" value={form.calendarWeekday} onChange={(event) => setForm({ calendarWeekday: event.target.value })}>
                          {(['1', '2', '3', '4', '5', '6', '0'] as const).map((weekday) => (
                            <option key={weekday} value={weekday}>{t(`weekdays.${weekday}`)}</option>
                          ))}
                        </SelectField>
                      </div>
                    )}
                    {form.calendarMode === 'monthly' && (
                      <div className="space-y-1.5">
                        <Label htmlFor="calendar-month-day" className="text-[13px] font-bold text-foreground/80">{t('fields.monthDay')}</Label>
                        <Input id="calendar-month-day" type="number" min={1} max={31} value={form.calendarMonthDay} onChange={(event) => setForm({ calendarMonthDay: event.target.value })} className="h-10 rounded-lg" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : dialogScheduleKind === 'every' ? (
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-[1fr_132px]">
                <div className="space-y-1.5">
                  <Label htmlFor="every-amount" className="text-[13px] font-bold text-foreground/80">{t('fields.every')}</Label>
                  <Input id="every-amount" value={form.everyAmount} onChange={(event) => setForm({ everyAmount: event.target.value })} className="h-10 rounded-lg" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="every-unit" className="text-[13px] font-bold text-foreground/80">{t('fields.unit')}</Label>
                  <SelectField id="every-unit" value={form.everyUnit} onChange={(event) => setForm({ everyUnit: event.target.value as CronFormState['everyUnit'] })}>
                    <option value="minutes">{t('units.minutes')}</option>
                    <option value="hours">{t('units.hours')}</option>
                    <option value="days">{t('units.days')}</option>
                  </SelectField>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="schedule-at" className="text-[13px] font-bold text-foreground/80">{t('fields.runAt')}</Label>
                <Input id="schedule-at" type="datetime-local" value={form.scheduleAt || getDefaultScheduleAt()} onChange={(event) => setForm({ scheduleAt: event.target.value })} className="h-10 rounded-lg" />
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-[14px] font-bold text-foreground/80">{t('dialog.deliveryTitle')}</Label>
              <p className="text-[12px] text-muted-foreground">{t('dialog.deliveryDescription', { appName: branding.productName })}</p>
            </div>
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              <Button type="button" variant={form.deliveryMode === 'none' ? 'default' : 'outline'} size="sm" onClick={() => setForm({ deliveryMode: 'none' })} className="h-auto min-h-12 justify-start whitespace-normal rounded-xl px-4 py-3 text-left">
                <div>
                  <div className="text-[13px] font-semibold">{t('dialog.deliveryModeNone', { appName: branding.productName })}</div>
                  <div className="text-[11px] opacity-80">{t('dialog.deliveryModeNoneDesc')}</div>
                </div>
              </Button>
              <Button type="button" variant={form.deliveryMode === 'announce' ? 'default' : 'outline'} size="sm" onClick={() => setForm({ deliveryMode: 'announce', deliveryChannel: form.deliveryChannel || selectableChannels[0]?.channelType || '' })} className="h-auto min-h-12 justify-start whitespace-normal rounded-xl px-4 py-3 text-left">
                <div>
                  <div className="text-[13px] font-semibold">{t('dialog.deliveryModeAnnounce')}</div>
                  <div className="text-[11px] opacity-80">{t('dialog.deliveryModeAnnounceDesc')}</div>
                </div>
              </Button>
            </div>

            {form.deliveryMode === 'announce' && (
              <div className="space-y-3 rounded-2xl border border-black/5 bg-background p-4 shadow-sm dark:border-white/5 dark:bg-muted">
                <div className="space-y-2">
                  <Label htmlFor="delivery-channel" className="text-[13px] font-bold text-foreground/80">{t('dialog.deliveryChannel')}</Label>
                  <SelectField
                    id="delivery-channel"
                    value={form.deliveryChannel}
                    onChange={(event) => setForm({ deliveryChannel: event.target.value, deliveryAccountId: '', deliveryTo: '' })}
                  >
                    <option value="">{t('dialog.selectChannel')}</option>
                    {selectableChannels.map((group) => (
                      <option key={group.channelType} value={group.channelType}>{getChannelDisplayName(group.channelType)}</option>
                    ))}
                  </SelectField>
                  {selectableChannels.length === 0 && <p className="text-[12px] text-muted-foreground">{t('dialog.noChannels')}</p>}
                </div>

                {accountOptions.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="delivery-account" className="text-[13px] font-bold text-foreground/80">{t('dialog.deliveryAccount')}</Label>
                    <SelectField id="delivery-account" value={accountId} onChange={(event) => setForm({ deliveryAccountId: event.target.value, deliveryTo: '' })}>
                      <option value="">{t('dialog.selectDeliveryAccount')}</option>
                      {accountOptions.map((account) => (
                        <option key={account.accountId} value={account.accountId}>{getDeliveryAccountDisplayName(account, t('channels:account.mainAccount', 'Main account'))}</option>
                      ))}
                    </SelectField>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="delivery-target-select" className="text-[13px] font-bold text-foreground/80">{t('dialog.deliveryTarget')}</Label>
                  <SelectField id="delivery-target-select" value={form.deliveryTo} onChange={(event) => setForm({ deliveryTo: event.target.value })} disabled={availableTargetOptions.length === 0}>
                    <option value="">{t('dialog.selectDeliveryTarget')}</option>
                    {availableTargetOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </SelectField>
                  <p className="text-[12px] text-muted-foreground">
                    {availableTargetOptions.length > 0 ? t('dialog.deliveryTargetDescAuto') : t('dialog.noDeliveryTargets', { channel: getChannelDisplayName(form.deliveryChannel) })}
                  </p>
                </div>

                {channelTargetsError && (
                  <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-[13px] text-yellow-700 dark:text-yellow-300">
                    {t('errors.targetsLoadFailed')}: {channelTargetsError}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-background p-4 shadow-sm dark:border-white/5 dark:bg-muted min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
            <div>
              <Label className="text-[14px] font-bold text-foreground/80">{t('dialog.enableImmediately')}</Label>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{t('dialog.enableImmediatelyDesc')}</p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(checked) => setForm({ enabled: checked })} />
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 min-[420px]:flex-row min-[420px]:justify-end sm:pt-4">
            <Button variant="outline" onClick={onClose} className="h-[42px] rounded-full px-6 text-[13px] font-semibold">
              {t('common:actions.cancel', 'Cancel')}
            </Button>
            <Button onClick={submit} disabled={saving} className="h-[42px] rounded-full px-6 text-[13px] font-semibold">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              {job ? t('dialog.saveChanges') : t('dialog.createTitle')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CronJobDetailsDrawer({ job, open, onClose, onEdit, onRuns }: { job?: CronJob; open: boolean; onClose: () => void; onEdit: (job: CronJob) => void; onRuns: (job: CronJob) => void }) {
  const { t } = useTranslation('cron');
  if (!job) return null;
  const notAvailable = t('values.notAvailable');
  const rows = [
    ['ID', job.id],
    [t('fields.agentId'), job.agentId || t('values.mainAgent')],
    [t('fields.sessionTarget'), job.sessionTarget || notAvailable],
    [t('fields.wakeMode'), job.wakeMode || notAvailable],
    [t('details.created'), formatDateTime(job.createdAt, notAvailable)],
    [t('details.updated'), formatDateTime(job.updatedAt, notAvailable)],
    [t('details.duration'), formatMs(job.state?.lastDurationMs ?? job.lastRun?.duration, notAvailable)],
    [t('details.consecutiveErrors'), String(job.state?.consecutiveErrors ?? 0)],
  ];
  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <SheetContent className="flex w-full flex-col overflow-hidden p-0 sm:max-w-[560px]">
        <SheetHeader className="border-b border-black/8 px-6 py-5 dark:border-white/10">
          <SheetTitle>{job.name}</SheetTitle>
          <SheetDescription>{job.description || getPayloadText(job)}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="flex flex-wrap gap-2">
            <StatusPill status={getLastStatus(job)} />
            <StatusPill status={getDeliveryStatus(job)} />
            <Badge variant={job.enabled ? 'success' : 'outline'}>{job.enabled ? t('common:status.enabled', 'Enabled') : t('common:status.paused', 'Paused')}</Badge>
          </div>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('dialog.schedule')}</h3>
            <div className="rounded-xl border border-black/8 px-4 py-3 text-sm dark:border-white/10">{formatSchedule(job.schedule, t)}</div>
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('details.prompt')}</h3>
            <div className="whitespace-pre-wrap rounded-xl border border-black/8 px-4 py-3 text-sm text-muted-foreground dark:border-white/10">{getPayloadText(job)}</div>
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('details.metadata')}</h3>
            <div className="rounded-xl border border-black/8 dark:border-white/10">
              {rows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-black/5 px-4 py-2 text-sm last:border-b-0 dark:border-white/8">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="max-w-[280px] truncate text-right text-foreground">{value}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <SheetFooter className="border-t border-black/8 px-6 py-4 dark:border-white/10">
          <Button variant="outline" onClick={() => onRuns(job)}><History className="mr-2 h-4 w-4" />{t('runs.title')}</Button>
          <Button onClick={() => onEdit(job)}><Settings2 className="mr-2 h-4 w-4" />{t('common:actions.edit', 'Edit')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function Cron() {
  const { t } = useTranslation('cron');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const {
    jobs,
    error,
    loading,
    refreshAll,
    createJob,
    updateJob,
    deleteJob,
  } = useCronStore();
  const [activeTab, setActiveTab] = useState<TabValue>('jobs');
  const [editingJob, setEditingJob] = useState<CronJob | undefined>();
  const [showEditor, setShowEditor] = useState(false);
  const [detailsJob, setDetailsJob] = useState<CronJob | undefined>();
  const [jobToDelete, setJobToDelete] = useState<CronJob | null>(null);
  const [configuredChannels, setConfiguredChannels] = useState<DeliveryChannelGroup[]>([]);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const hasFetchedRef = useRef(false);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const fetchConfiguredChannels = useCallback(async () => {
    try {
      const response = await hostApiFetch<{ success: boolean; channels?: DeliveryChannelGroup[]; error?: string }>('/api/channels/accounts');
      setConfiguredChannels(response.success ? response.channels ?? [] : []);
      setChannelsError(response.success ? null : response.error || t('errors.channelsLoadFailed'));
    } catch (error) {
      setConfiguredChannels([]);
      setChannelsError(error instanceof Error ? error.message : String(error));
    }
  }, [t]);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    void refreshAll();
    void fetchConfiguredChannels();
  }, [fetchConfiguredChannels, refreshAll]);

  const failedJobs = jobs.filter((job) => getLastStatus(job) === 'error');

  const openEditor = (job?: CronJob) => {
    setEditingJob(job);
    setShowEditor(true);
  };

  const handleSave = async (input: CronJobCreateInput) => {
    if (editingJob) {
      await updateJob(editingJob.id, input);
    } else {
      await createJob(input);
    }
    await refreshAll();
  };

  const showRunsForJob = (_job: CronJob) => {
    setActiveTab('runs');
    setDetailsJob(undefined);
  };

  return (
    <div data-testid="cron-page" className="flex h-[calc(100vh-2.5rem)] flex-col overflow-hidden -m-6 bg-[#f5f7fb] dark:bg-background">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col p-10 pt-16">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <>
              <Button
                data-testid="cron-refresh-button"
                variant="outline"
                onClick={() => {
                  void refreshAll();
                  void fetchConfiguredChannels();
                }}
                disabled={!isGatewayRunning && loading}
                className="h-10 rounded-lg px-4 text-[13px] font-medium"
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                {t('refresh')}
              </Button>
              <Button
                onClick={() => openEditor()}
                className="h-10 rounded-lg px-4 text-[13px] font-medium"
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                {t('newTask')}
              </Button>
            </>
          )}
        />

        <div className="mb-6">
          <CronStatusStrip />
          <CronPageNotices activeTab={activeTab} error={error} channelsError={channelsError} />
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabValue)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-black/8 dark:border-white/10">
            <TabsList variant="page">
              <TabsTrigger variant="page" value="jobs">{t('jobs.title', 'Jobs')}</TabsTrigger>
              <TabsTrigger variant="page" value="runs">{t('runs.title', 'Run history')}</TabsTrigger>
            </TabsList>
            <div className="text-[13px] text-muted-foreground">
              {failedJobs.length > 0 ? t('jobs.failedCount', { count: failedJobs.length }) : t('jobs.jobCount', { count: jobs.length })}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-5 pr-2">
            <TabsContent value="jobs" className="m-0">
              <CronJobsTab
                onEdit={openEditor}
                onDetails={setDetailsJob}
                onDelete={setJobToDelete}
                onRuns={showRunsForJob}
              />
            </TabsContent>
            <TabsContent value="runs" className="m-0">
              <CronRunsTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <CronJobEditorDrawer
        open={showEditor}
        job={editingJob}
        configuredChannels={configuredChannels}
        onClose={() => {
          setShowEditor(false);
          setEditingJob(undefined);
        }}
        onSave={handleSave}
      />
      <CronJobDetailsDrawer
        open={!!detailsJob}
        job={detailsJob}
        onClose={() => setDetailsJob(undefined)}
        onEdit={(job) => {
          setDetailsJob(undefined);
          openEditor(job);
        }}
        onRuns={showRunsForJob}
      />
      <ConfirmDialog
        open={!!jobToDelete}
        title={t('common:actions.confirm', 'Confirm')}
        message={t('card.deleteConfirm')}
        confirmLabel={t('common:actions.delete', 'Delete')}
        cancelLabel={t('common:actions.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!jobToDelete) return;
          try {
            await deleteJob(jobToDelete.id);
            toast.success(t('toast.deleted'));
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
          } finally {
            setJobToDelete(null);
          }
        }}
        onCancel={() => setJobToDelete(null)}
      />
    </div>
  );
}

export default Cron;
