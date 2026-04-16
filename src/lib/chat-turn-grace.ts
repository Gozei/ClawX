export const COMPLETED_TURN_PROCESS_LAYOUT_GRACE_MS = 15_000;

export function isWithinCompletedTurnProcessGrace(lastUserTimestampMs: number): boolean {
  if (!Number.isFinite(lastUserTimestampMs) || lastUserTimestampMs <= 0) return false;
  const elapsedMs = Date.now() - lastUserTimestampMs;
  return elapsedMs >= 0 && elapsedMs <= COMPLETED_TURN_PROCESS_LAYOUT_GRACE_MS;
}
