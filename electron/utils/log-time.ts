function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

function coerceDate(input?: Date | number | string | null): Date {
  const candidate = input instanceof Date
    ? input
    : typeof input === 'number' || typeof input === 'string'
      ? new Date(input)
      : new Date();
  if (Number.isNaN(candidate.getTime())) {
    return new Date();
  }
  return candidate;
}

function formatOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  return `${sign}${pad(hours)}:${pad(minutes)}`;
}

export function formatLocalDatePart(input?: Date | number | string | null): string {
  const date = coerceDate(input);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatLocalTimestamp(input?: Date | number | string | null): string {
  const date = coerceDate(input);
  return `${formatLocalDatePart(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${formatOffset(date)}`;
}

export function normalizeTimestamp(input?: string | number | Date | null): { ts: string; tsEpochMs: number } {
  const date = coerceDate(input);
  return {
    ts: formatLocalTimestamp(date),
    tsEpochMs: date.getTime(),
  };
}
